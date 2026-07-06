/**
 * Yield Basis YB-tBTC Token (Staked) vault — on-chain reads.
 *
 * Staked variant of `yb-tbtc-yieldbearing` — adds $YB emissions on top of
 * the LP trading-fee yield. See `adapters/yb-wbtc-token` for the full
 * commentary on the pattern.
 */

import {
  defineAdapter,
  ethereum,
  math,
  prices,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const LT = "0x771F7290428d830ECd41E980745c327e507823Ec";
const GAUGE = "0xe83D888FE3213DD3471DE0bC1957E0f94F038483";
const GAUGE_CONTROLLER = "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21";
const ASSET_ADDRESS = "0x18084fbA666a33d37592fA2633fD49a74DD93a88"; // tBTC mainnet
const ASSET_DECIMALS = 18;

const EMISSIONS_WINDOW_SECONDS = 3600;
const SECONDS_PER_YEAR = 31_536_000;

const yieldBasisLtAbi = [
  {
    inputs: [],
    name: "pricePerShare",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "updated_balances",
    outputs: [
      { name: "supply", type: "uint256" },
      { name: "staked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const gaugeControllerAbi = [
  {
    inputs: [
      { name: "gauge", type: "address" },
      { name: "at_time", type: "uint256" },
    ],
    name: "preview_emissions",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export default defineAdapter({
  slug: "yb-tbtc-token",
  name: "Yield Basis YB-tBTC (Staked)",
  url: "https://yieldbasis.com",
  category: "lp",
  custody: "multisig",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    const client = ethereum.getClient();

    const latestBlock = await client.getBlock({ blockTag: "latest" });
    const nowTs = latestBlock.timestamp;
    const futureTs = nowTs + BigInt(EMISSIONS_WINDOW_SECONDS);

    const [
      balancesCall,
      growth,
      emissionsNow,
      emissionsFuture,
      ybPriceUsd,
      btcPriceUsd,
    ] = await Promise.all([
      ethereum.readContract<readonly [bigint, bigint]>({
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "updated_balances",
      }),
      readShareGrowth({
        client,
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "pricePerShare",
        blocksBack: BLOCKS_PER_30D.ethereum,
        decimals: 18,
      }),
      ethereum.readContract<bigint>({
        address: GAUGE_CONTROLLER,
        abi: gaugeControllerAbi,
        functionName: "preview_emissions",
        args: [GAUGE, nowTs],
      }),
      ethereum.readContract<bigint>({
        address: GAUGE_CONTROLLER,
        abi: gaugeControllerAbi,
        functionName: "preview_emissions",
        args: [GAUGE, futureTs],
      }),
      prices.getToken("yield-basis"),
      prices.getBtc(),
    ]);

    const [, stakedRaw] = balancesCall;
    const stakedShares = math.fromUnits(stakedRaw, 18);
    requirePositive(stakedShares, "stakedShares");

    const tvlBtc = math.mul(stakedShares, growth.sharePriceNow);
    requirePositive(tvlBtc, "tvlBtc");

    if (!growth.hasBaseline) {
      throw new Error(
        "yb-tbtc-token: 30d share-price baseline unavailable (archive read " +
          "failed) — refusing to report emissions-only APR",
      );
    }

    const ybDelta = math.fromUnits(emissionsFuture - emissionsNow, 18);
    const ybPerYear = math.div(
      math.mul(ybDelta, SECONDS_PER_YEAR),
      EMISSIONS_WINDOW_SECONDS,
    );
    const stakedTvlUsd = math.mul(tvlBtc, btcPriceUsd);
    const emissionsUsdPerYear = math.mul(ybPerYear, ybPriceUsd);
    const emissionsApr = math.mul(
      math.div(emissionsUsdPerYear, stakedTvlUsd),
      100,
    );

    const baseApr = growth.apr;
    const apr = math.add(baseApr, emissionsApr);

    return [
      {
        symbol: "yb-tBTC-staked",
        tvlBtc,
        apr,
        metadata: {
          ltAddress: LT,
          gaugeAddress: GAUGE,
          gaugeController: GAUGE_CONTROLLER,
          assetAddress: ASSET_ADDRESS,
          assetDecimals: ASSET_DECIMALS,
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          stakedShares,
          baseApr,
          emissionsApr,
          apy30dBase: growth.apy,
          ybPerYear,
          ybPriceUsd,
          btcPriceUsd,
          emissionsWindowSeconds: EMISSIONS_WINDOW_SECONDS,
        },
      },
    ];
  },
});
