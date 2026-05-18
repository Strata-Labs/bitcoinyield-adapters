/**
 * Acre BTC adapter — reference implementation for ERC-4626 vault adapters.
 *
 * If you're adding a new ERC-4626 vault adapter (Lombard Earn, Morpho-style
 * vault, Solv vault, etc.) copy this file as a starting point. The shape it
 * produces is the same across every vault adapter:
 *
 *   - `tvlBtc`                    ← totalAssets / 10^decimals
 *   - `symbol`                    ← the underlying deposit token
 *   - `apr`                       ← 30-day annualized share-price growth.
 *                                   Accurate from cycle 1; no warmup.
 *   - `metadata.sharePrice`       ← convertToAssets(10^18) at "latest" block
 *   - `metadata.sharePrice30dAgo` ← convertToAssets(10^18) at latest - 30d.
 *   - `metadata.apy30d`           ← compounded APY over the same window.
 *   - `metadata.maxDepositBtc`    ← capacity remaining; null = uncapped.
 *   - `metadata.paused`           ← live "is the vault open?" signal.
 *   - `metadata.assetAddress`     ← runtime check on the underlying token.
 *
 * On-chain APY (the "no scraper" pattern):
 *   We read `convertToAssets(10^18)` at the latest block AND at
 *   `latest - 216_000` blocks (~30 days on Ethereum, exact elapsed time
 *   computed from block timestamps). The annualized delta is the APR.
 *   See `src/core/utils/yield.ts` — `readShareGrowth` does the work.
 *
 *   The blockchain itself is our 30-day history, so no warmup cycle is
 *   needed. The helper fails soft: if the historical read errors (non-
 *   archive RPC, chain too young), the adapter still writes a useful row
 *   with `apr: 0` and the next cycle tries again.
 *
 * Acre architecture context (May 2026):
 *   - acreBTC vault (this contract) is the user-facing ERC-4626.
 *   - Funds route through `MidasAllocator` → Midas Capital yield strategies.
 *     (Slug is `acre-mezo` for historical reasons — V1 used Mezo. Renaming
 *     requires a main-app migration; deferred.)
 *   - `BitcoinDepositorV2` and `WithdrawalQueue` are worth wiring later for
 *     bridge status + live withdrawalDelayDays.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const ACRE_VAULT = "0x19531C886339dd28b9923d903F6B235C45396ded";

// Acre's underlying is tBTC (Threshold). The decimals of the asset are NOT
// always the same as the vault token's decimals — `convertToAssets` returns
// a value in the asset's decimals, so we use these for sharePrice math.
//
// If you copy this file for another vault, update both:
//   ASSET_ADDRESS to the asset that vault.asset() returns
//   ASSET_DECIMALS to that token's `decimals()` (look it up once, hardcode)
// The runtime assertion below ensures the on-chain `asset()` matches the
// hardcoded address, so a wrong constant fails loudly on first run.
const ASSET_ADDRESS = "0x18084fba666a33d37592fa2633fd49a74dd93a88"; // tBTC mainnet
const ASSET_DECIMALS = 18;

// `convertToAssets` takes "shares" denominated in the vault token's decimals.
// We hardcode 10^18 because all BTC ERC-4626 vault tokens we've seen are
// 18-decimal. If you copy this for a non-18-decimal vault, change this too.
const ONE_SHARE_18_DECIMALS = 10n ** 18n;

export default defineAdapter({
  slug: "acre-mezo",
  name: "Acre",
  url: "https://bitcoin.acre.fi",
  category: "yield-bearing",
  custody: "multisig",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    // Parallelize:
    //   1. One multicall for everything that lives at "latest" block.
    //   2. readShareGrowth — itself reads sharePrice at "latest" AND at
    //      ~30 days ago. Two block tags = two RPC roundtrips inside the
    //      helper. Independent from the multicall, so Promise.all overlaps
    //      them.
    const [calls, growth] = await Promise.all([
      ethereum.multicall([
        {
          address: ACRE_VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "totalAssets",
        },
        {
          address: ACRE_VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "decimals",
        },
        {
          address: ACRE_VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "asset",
        },
        {
          address: ACRE_VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "maxDeposit",
          // Convention: zero address asks for the "max for any depositor."
          // Uncapped vaults return uint256.max here; we treat that as null.
          args: ["0x0000000000000000000000000000000000000000"],
        },
        {
          address: ACRE_VAULT,
          abi: ethereum.pausableAbi,
          functionName: "paused",
        },
      ]),
      readShareGrowth({
        client: ethereum.getClient(),
        address: ACRE_VAULT,
        abi: ethereum.erc4626VaultAbi,
        functionName: "convertToAssets",
        args: [ONE_SHARE_18_DECIMALS],
        blocksBack: BLOCKS_PER_30D.ethereum,
        decimals: ASSET_DECIMALS,
      }),
    ]);

    const [totalAssetsCall, decimalsCall, assetCall, maxDepositCall, pausedCall] =
      calls;

    // `totalAssets` and `decimals` are mandatory (TVL math needs them);
    // the rest degrade gracefully into `undefined` metadata fields.
    if (
      totalAssetsCall?.status !== "success" ||
      decimalsCall?.status !== "success"
    ) {
      throw new Error(
        `Acre vault multicall failed: totalAssets=${totalAssetsCall?.status} decimals=${decimalsCall?.status}`,
      );
    }

    const decimals = decimalsCall.result as number;
    const tvlBtc = math.fromUnits(totalAssetsCall.result as bigint, decimals);
    requirePositive(tvlBtc, "tvlBtc");

    // Sanity-check the underlying matches what we hardcoded. If `asset()`
    // returns something other than tBTC, our ASSET_DECIMALS assumption is
    // wrong and every downstream number would be silently off — fail loud.
    const assetAddress =
      assetCall?.status === "success"
        ? (assetCall.result as string)
        : undefined;
    if (
      assetAddress &&
      assetAddress.toLowerCase() !== ASSET_ADDRESS.toLowerCase()
    ) {
      throw new Error(
        `Acre vault asset() returned ${assetAddress}, expected ${ASSET_ADDRESS}. ` +
          `Update ASSET_ADDRESS + ASSET_DECIMALS if the underlying changed.`,
      );
    }

    // uint256.max ≈ 1.16e77 — sanity check is "above any realistic TVL."
    const maxDepositRaw =
      maxDepositCall?.status === "success"
        ? (maxDepositCall.result as bigint)
        : undefined;
    const maxDepositBtc =
      maxDepositRaw !== undefined && maxDepositRaw < 2n ** 200n
        ? math.fromUnits(maxDepositRaw, decimals)
        : null; // null = no deposit cap

    const paused =
      pausedCall?.status === "success"
        ? (pausedCall.result as boolean)
        : undefined;

    return [
      {
        // Use the actual deposit token, not "BTC". For Acre this is tBTC;
        // other vaults will be cbBTC, wBTC, LBTC, etc. Users see this as-is.
        symbol: "tBTC",
        tvlBtc,
        apr: growth.apr,
        metadata: {
          vaultAddress: ACRE_VAULT,
          assetAddress, // expected: 0x18084fba666a33d37592fa2633fd49a74dd93a88 (tBTC mainnet)
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30d: growth.apy,
          windowDays: growth.elapsedDays,
          maxDepositBtc, // null = uncapped; number = remaining capacity in BTC
          paused, // true = deposits/withdrawals disabled
        },
      },
    ];
  },
});
