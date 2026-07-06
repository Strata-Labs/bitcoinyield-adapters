/**
 * Morpho Gauntlet WBTC Core vault adapter — hybrid (TVL on-chain, APR from API).
 *
 * For a lending vault, realized 30d share-price growth and the forward Net
 * APY diverge (idle liquidity + shifting utilization), and the forward rate
 * is what depositors act on. So: on-chain `totalAssets()` for TVL, Morpho
 * GraphQL `netApy` for the headline APR (matches Morpho's UI), and the
 * realized delta kept in `metadata.apy30dRealized` for drift auditing.
 *
 * If we onboard 3+ MetaMorpho vaults, reconstruct Net APY on-chain via a
 * shared helper (supplyQueue → per-market IRM rates → weight − fee) and
 * drop the API dependency.
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

    // If asset() drifts from our constant, ASSET_DECIMALS is wrong and the math breaks.
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

    // Uncapped MetaMorpho vaults return a huge (but sub-uint256.max) maxDeposit;
    // above 1M BTC (> total WBTC supply) treat as uncapped.
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
          assetAddress,
          assetDecimals: ASSET_DECIMALS,
          vaultDecimals: vaultDecimalsCall.result as number,
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30dRealized: growth.apr, // audit: realized vs forward drift
          apy30dRealizedCompounded: growth.apy,
          windowDays: growth.elapsedDays,
          grossApy:
            apiGrossApy !== undefined ? math.toPercent(apiGrossApy) : undefined,
          netApy:
            apiNetApy !== undefined ? math.toPercent(apiNetApy) : undefined,
          maxDepositBtc, // null = uncapped
          curator: "Gauntlet",
          yieldMechanism: "lending-vault",
          aprSource: "morpho-api-net-apy",
        },
      },
    ];
  },
});
