/**
 * Botanix adapter — stBTC ERC-4626 vault on Botanix L2 (chain id 3637).
 *
 * Sets up a viem client inline because Botanix isn't on the framework's
 * `ethereum.*` helper (mainnet-only). If a second non-mainnet EVM adapter
 * appears, factor a `chains/evm.ts` helper.
 *
 * APR is realized 30-day share-price growth (not the forward-looking
 * theoretical yield the previous blend.money-scraping version reported),
 * matching how the other vault adapters report yield.
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

// Underlying. asset() is asserted against this at runtime (see fetch).
const ASSET_ADDRESS = "0x0D2437F93Fed6EA64Ef01cCde385FB1263910C56"; // pBTC
const ASSET_DECIMALS = 18;

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
    // Required for client.multicall(); canonical multicall3, also live on Botanix.
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

    const [
      totalAssetsCall,
      decimalsCall,
      assetCall,
      maxDepositCall,
      pausedCall,
    ] = calls;

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
        `Botanix vault asset() returned ${assetAddress}, expected ${ASSET_ADDRESS}. ` +
          `Update ASSET_ADDRESS + ASSET_DECIMALS if the underlying changed.`,
      );
    }

    // stBTC is capped; surface remaining capacity, but treat uint256.max as uncapped (null).
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
        symbol: "stBTC",
        tvlBtc,
        apr: growth.apr,
        metadata: {
          vaultAddress: VAULT,
          chainId: CHAIN_ID,
          assetAddress,
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30d: growth.apy,
          windowDays: growth.elapsedDays,
          maxDepositBtc,
          paused,
        },
      },
    ];
  },
});
