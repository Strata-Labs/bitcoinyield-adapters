/**
 * Morpho Gauntlet WBTC Core vault adapter — hybrid (TVL on-chain, APR from API).
 *
 * Why hybrid: this is a Morpho Blue lending vault with variable utilization.
 * The vault holds idle liquidity + active loans, and the mix shifts over
 * time as borrowers come and go. Two consequences:
 *
 *   - The on-chain share-price delta gives us **realized** 30d yield —
 *     accurate but measures historical performance, not what new depositors
 *     will earn going forward.
 *
 *   - Morpho's UI shows the **forward** Net APY (current weighted supply
 *     rate across the vault's markets, net of curator fee). For lending
 *     vaults, that's the more useful number for users deciding whether to
 *     deposit now.
 *
 * For pure-strategy vaults (Acre, Botanix, Yield Basis) the two converge
 * because there's no idle cash. For lending vaults they diverge. So we use:
 *
 *   - On-chain `totalAssets()` for **TVL** (verifiable, no API dependency)
 *   - Morpho GraphQL `netApy` for **APR** (matches Morpho's own UI exactly)
 *   - On-chain `convertToAssets` delta exposed as `metadata.apy30dRealized`
 *     so users can compare forward vs realized
 *
 * FUTURE: on-chain Net APY reconstruction is possible — read the vault's
 * supplyQueue + position(marketId) per market, look up each Morpho Blue
 * market's borrowRate via its IRM contract, weight by supplied amount, and
 * subtract vault.fee(). It's ~150 LOC + three contract ABIs (MetaMorpho,
 * Morpho Blue singleton, IRM). Not worth it for one vault, but if we onboard
 * 3+ MetaMorpho-curated products, build a shared `morphoVaultSupplyRate()`
 * helper and switch all of them off the API.
 */

import {
  defineAdapter,
  ethereum,
  http,
  math,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const VAULT = "0x443df5eEE3196e9b2Dd77CaBd3eA76C3dee8f9b2";
const ASSET_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"; // WBTC mainnet
const ASSET_DECIMALS = 8; // WBTC has 8 decimals; vault token is 18-decimal.
const CHAIN_ID = 1;

const ONE_SHARE_18_DECIMALS = 10n ** 18n;

const MORPHO_API = "https://api.morpho.org/graphql";
const MORPHO_QUERY = `
  query GetVaultData($address: String!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      state { apy netApy }
    }
  }
`;

interface MorphoData {
  vaultByAddress?: {
    state?: { apy?: number; netApy?: number };
  };
}

export default defineAdapter({
  slug: "morpho-gauntlet",
  name: "Morpho Gauntlet WBTC Core",
  url: "https://app.morpho.org",
  category: "lending",
  custody: "self",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    // Three parallel concerns:
    //  1. On-chain reads for TVL + asset sanity check + capacity
    //  2. On-chain share-price delta — kept as `metadata.apy30dRealized`
    //     so users (and we) can spot drift from Morpho's forward rate
    //  3. Morpho GraphQL — the forward Net APY that becomes our headline
    const [calls, growth, morphoData] = await Promise.all([
      ethereum.multicall([
        {
          address: VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "totalAssets",
        },
        {
          address: VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "decimals",
        },
        {
          address: VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "asset",
        },
        {
          address: VAULT,
          abi: ethereum.erc4626VaultAbi,
          functionName: "maxDeposit",
          args: ["0x0000000000000000000000000000000000000000"],
        },
      ]),
      readShareGrowth({
        client: ethereum.getClient(),
        address: VAULT,
        abi: ethereum.erc4626VaultAbi,
        functionName: "convertToAssets",
        args: [ONE_SHARE_18_DECIMALS],
        blocksBack: BLOCKS_PER_30D.ethereum,
        decimals: ASSET_DECIMALS,
      }),
      http.graphql<MorphoData>(MORPHO_API, MORPHO_QUERY, {
        address: VAULT,
        chainId: CHAIN_ID,
      }),
    ]);

    const [totalAssetsCall, vaultDecimalsCall, assetCall, maxDepositCall] =
      calls;

    if (
      totalAssetsCall?.status !== "success" ||
      vaultDecimalsCall?.status !== "success"
    ) {
      throw new Error(
        `Morpho Gauntlet vault multicall failed: ` +
          `totalAssets=${totalAssetsCall?.status} decimals=${vaultDecimalsCall?.status}`,
      );
    }

    // TVL math uses ASSET decimals (WBTC = 8), NOT vault decimals (18).
    // `totalAssets()` returns the underlying's raw units.
    const tvlBtc = math.fromUnits(
      totalAssetsCall.result as bigint,
      ASSET_DECIMALS,
    );
    requirePositive(tvlBtc, "tvlBtc");

    // Assert the underlying matches what we hardcoded. Same defensive
    // pattern as Acre / Botanix.
    const assetAddress =
      assetCall?.status === "success"
        ? (assetCall.result as string)
        : undefined;
    if (
      assetAddress &&
      assetAddress.toLowerCase() !== ASSET_ADDRESS.toLowerCase()
    ) {
      throw new Error(
        `Morpho Gauntlet vault asset() returned ${assetAddress}, expected ${ASSET_ADDRESS}. ` +
          `Update ASSET_ADDRESS + ASSET_DECIMALS if the underlying changed.`,
      );
    }

    // MetaMorpho's `maxDeposit` returns a value much larger than realistic
    // BTC TVL when uncapped, but smaller than `uint256.max`. Treat anything
    // above 1M BTC as effectively uncapped (more than the total wBTC supply
    // on Ethereum).
    const maxDepositRaw =
      maxDepositCall?.status === "success"
        ? (maxDepositCall.result as bigint)
        : undefined;
    const maxDepositAsNumber =
      maxDepositRaw !== undefined
        ? math.fromUnits(maxDepositRaw, ASSET_DECIMALS)
        : undefined;
    const maxDepositBtc =
      maxDepositAsNumber !== undefined && maxDepositAsNumber < 1_000_000
        ? maxDepositAsNumber
        : null; // null = effectively uncapped

    // Headline APR from Morpho's API (matches their UI exactly).
    const apiNetApy = morphoData.vaultByAddress?.state?.netApy;
    const apiGrossApy = morphoData.vaultByAddress?.state?.apy;
    if (apiNetApy === undefined && apiGrossApy === undefined) {
      throw new Error("Morpho API returned no APY data for vault");
    }
    const apr = math.toPercent(apiNetApy ?? apiGrossApy ?? 0);

    return [
      {
        symbol: "WBTC",
        tvlBtc,
        apr,
        metadata: {
          vaultAddress: VAULT,
          assetAddress, // expected: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 (WBTC)
          assetDecimals: ASSET_DECIMALS,
          vaultDecimals: vaultDecimalsCall.result as number,
          // On-chain audit fields. These let us (and consumers) verify
          // Morpho's reported netApy against realized 30d performance.
          // For a lending vault, drift is expected: forward vs realized.
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30dRealized: growth.apr,
          apy30dRealizedCompounded: growth.apy,
          windowDays: growth.elapsedDays,
          // API-reported numbers for transparency.
          grossApy:
            apiGrossApy !== undefined ? math.toPercent(apiGrossApy) : undefined,
          netApy:
            apiNetApy !== undefined ? math.toPercent(apiNetApy) : undefined,
          maxDepositBtc, // null = effectively uncapped (> 1M BTC)
          curator: "Gauntlet",
          yieldMechanism: "lending-vault",
          aprSource: "morpho-api-net-apy",
        },
      },
    ];
  },
});
