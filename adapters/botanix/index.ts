/**
 * Botanix adapter — stBTC vault on Botanix L2 (chain id 3637).
 *
 * Same ERC-4626 pattern as the Acre adapter — only difference is we set up
 * a viem client inline because Botanix isn't on the framework's `ethereum.*`
 * helper (which is mainnet-only). If a second non-mainnet EVM adapter
 * appears, factor a `chains/evm.ts` helper.
 *
 * What the adapter exposes:
 *   - `tvlBtc`                    ← totalAssets / 10^decimals
 *                                   (pBTC pegs 1:1 with BTC)
 *   - `apr`                       ← 30-day annualized share-price growth on
 *                                   Botanix's own block timeline. Accurate
 *                                   from cycle 1; no warmup.
 *   - `metadata.sharePrice`       ← convertToAssets(10^18) at "latest" block.
 *   - `metadata.sharePrice30dAgo` ← convertToAssets(10^18) at latest - 30d.
 *   - `metadata.apy30d`           ← compounded APY over the same window.
 *   - `metadata.maxDepositBtc`    ← capacity remaining (this vault IS capped,
 *                                   unlike Acre which is uncapped).
 *   - `metadata.paused`           ← live "is the vault open?" signal.
 *   - `metadata.assetAddress`     ← runtime check on the underlying token.
 *
 * The 30d window is computed from Botanix's block time (~5s), giving us
 * ~518,400 blocks. `readShareGrowth` uses the actual block timestamps to
 * compute exact elapsed days regardless of block-time drift.
 *
 * Migration note: the previous version of this adapter scraped APR from
 * blend.money's `safe/yield` API. That returned `theoreticalYield`, which is
 * a forward-looking estimate of current Morpho market rates — useful, but a
 * different number from realized yield (which is what the share-price delta
 * captures). We use the realized number now to match how every other vault
 * adapter (Acre, Yield Basis variants) reports yield. The blend.money
 * dependency is gone.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";
import {
  createPublicClient,
  defineChain,
  fallback,
  http as viemHttp,
} from "viem";

const VAULT = "0xF4586028FFdA7Eca636864F80f8a3f2589E33795";
const CHAIN_ID = 3637;

// Underlying. `asset()` is asserted against this at runtime so a wrong
// constant fails loudly on first run.
const ASSET_ADDRESS = "0x0D2437F93Fed6EA64Ef01cCde385FB1263910C56"; // pBTC
const ASSET_DECIMALS = 18;

// `convertToAssets` takes shares in the vault token's decimals. stBTC uses 18.
const ONE_SHARE_18_DECIMALS = 10n ** 18n;

const BOTANIX_RPCS = [
  "https://rpc.ankr.com/botanix_mainnet",
  "https://3637.rpc.thirdweb.com",
  "https://node.botanixlabs.dev",
];

const botanix = defineChain({
  id: CHAIN_ID,
  name: "Botanix",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: BOTANIX_RPCS } },
  contracts: {
    // Canonical multicall3 deployment, also live on Botanix. Required for
    // viem's client.multicall() — without it viem refuses to batch reads.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export default defineAdapter({
  slug: "botanix",
  name: "Botanix",
  url: "https://botanixlabs.com",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const client = createPublicClient({
      chain: botanix,
      transport: fallback(
        BOTANIX_RPCS.map((url) =>
          viemHttp(url, { retryCount: 1, timeout: 10_000 }),
        ),
      ),
    });

    // Parallelize:
    //   1. One multicall for everything at "latest" block.
    //   2. readShareGrowth — reads sharePrice at "latest" AND at
    //      ~30 days ago (518,400 Botanix blocks). Returns the helper's own
    //      pair of reads in one promise.
    const [calls, growth] = await Promise.all([
      client.multicall({
        contracts: [
          {
            address: VAULT as `0x${string}`,
            abi: ethereum.erc4626VaultAbi,
            functionName: "totalAssets",
          },
          {
            address: VAULT as `0x${string}`,
            abi: ethereum.erc4626VaultAbi,
            functionName: "decimals",
          },
          {
            address: VAULT as `0x${string}`,
            abi: ethereum.erc4626VaultAbi,
            functionName: "asset",
          },
          {
            address: VAULT as `0x${string}`,
            abi: ethereum.erc4626VaultAbi,
            functionName: "maxDeposit",
            args: ["0x0000000000000000000000000000000000000000"],
          },
          {
            address: VAULT as `0x${string}`,
            abi: ethereum.pausableAbi,
            functionName: "paused",
          },
        ],
      }),
      readShareGrowth({
        client,
        address: VAULT as `0x${string}`,
        abi: ethereum.erc4626VaultAbi,
        functionName: "convertToAssets",
        args: [ONE_SHARE_18_DECIMALS],
        blocksBack: BLOCKS_PER_30D.botanix,
        decimals: ASSET_DECIMALS,
      }),
    ]);

    const [totalAssetsCall, decimalsCall, assetCall, maxDepositCall, pausedCall] =
      calls;

    if (
      totalAssetsCall?.status !== "success" ||
      decimalsCall?.status !== "success"
    ) {
      throw new Error(
        `Botanix vault multicall failed: totalAssets=${totalAssetsCall?.status} decimals=${decimalsCall?.status}`,
      );
    }

    const decimals = decimalsCall.result as number;
    const tvlBtc = math.fromUnits(totalAssetsCall.result as bigint, decimals);
    requirePositive(tvlBtc, "tvlBtc");

    // Assert the underlying is what we hardcoded. If asset() drifts, our
    // ASSET_DECIMALS assumption is wrong and downstream math would be off.
    const assetAddress =
      assetCall?.status === "success"
        ? (assetCall.result as string)
        : undefined;
    if (
      assetAddress &&
      assetAddress.toLowerCase() !== ASSET_ADDRESS.toLowerCase()
    ) {
      throw new Error(
        `Botanix vault asset() returned ${assetAddress}, expected ${ASSET_ADDRESS}. ` +
          `Update ASSET_ADDRESS + ASSET_DECIMALS if the underlying changed.`,
      );
    }

    // stBTC has a real deposit cap (unlike Acre's uncapped vault). Surface
    // remaining capacity as a number; clamp to null only if the contract
    // ever starts returning uint256.max.
    const maxDepositRaw =
      maxDepositCall?.status === "success"
        ? (maxDepositCall.result as bigint)
        : undefined;
    const maxDepositBtc =
      maxDepositRaw !== undefined && maxDepositRaw < 2n ** 200n
        ? math.fromUnits(maxDepositRaw, decimals)
        : null;

    const paused =
      pausedCall?.status === "success"
        ? (pausedCall.result as boolean)
        : undefined;

    return [
      {
        // `symbol` is the BTC-variant this yield product is denominated in —
        // i.e., the user-facing receipt token (matches the LBTC / sBTC
        // convention elsewhere in the framework). Users hold stBTC; the
        // underlying pBTC address lives in `metadata.assetAddress`.
        symbol: "stBTC",
        tvlBtc,
        apr: growth.apr,
        metadata: {
          vaultAddress: VAULT,
          chainId: CHAIN_ID,
          assetAddress, // expected: 0x0D2437F93Fed6EA64Ef01cCde385FB1263910C56 (pBTC)
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30d: growth.apy,
          windowDays: growth.elapsedDays,
          maxDepositBtc, // remaining capacity in BTC; null = uncapped
          paused, // true = deposits/withdrawals disabled
        },
      },
    ];
  },
});
