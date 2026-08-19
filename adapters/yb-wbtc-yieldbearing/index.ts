/**
 * Yield Basis YB-WBTC Yield Bearing vault — on-chain reads.
 *
 * LT contract behavior we rely on:
 *   - `pricePerShare()` — assets per 1 share, normalized to 18 decimals
 *     regardless of the underlying token's decimals. Starts at exactly 1.0
 *     when the market is created.
 *   - `updated_balances()` returns `(totalSupply, stakedSupply)`.
 *
 * TVL math for the yield-bearing variant:
 *   yieldBearingShares = (totalSupply - stakedSupply) / 1e18
 *   tvlBtc             = yieldBearingShares × sharePrice
 *
 * APR is the all-time annualized PPS growth since market creation —
 * the same "FT APY" figure the yieldbasis.com dashboard shows:
 *   apr = (pricePerShare - 1) × secondsPerYear / secondsSinceLaunch
 * Verified against their indexer's tradingApyAllTime to 4 decimal places
 * (data.yieldbasis.com/api/v1/graphql, market idx 7). Because genesis PPS
 * is exactly 1.0, no historical/archive read is needed.
 *
 * Limitations: BASE yield only (LP trading fees). The companion
 * `yb-wbtc-token` adapter adds $YB emissions on top.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const LT = "0x651D4b8168488FA163D85304662E8278d4c55BAa";
const ASSET_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"; // WBTC mainnet
const ASSET_DECIMALS = 8; // WBTC has 8 decimals; pricePerShare normalizes to 18 so this is metadata-only.
// Market creation timestamp (tx that deployed LT idx 7, 2026-05-25).
const LAUNCH_TIMESTAMP = 1_779_693_803n;
const SECONDS_PER_YEAR = 31_536_000;
const FORMULA_VERSION = "yieldbasis-alltime-pps-v1";

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

export default defineAdapter({
  slug: "yb-wbtc-yieldbearing",
  name: "Yield Basis YB-WBTC (Yield Bearing)",
  url: "https://yieldbasis.com",
  category: "lp",
  custody: "multisig",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    const client = ethereum.getClient();
    const block = await client.getBlock({ blockTag: "latest" });

    const [balances, pricePerShareRaw] = await Promise.all([
      client.readContract({
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "updated_balances",
        blockNumber: block.number,
      }),
      client.readContract({
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "pricePerShare",
        blockNumber: block.number,
      }),
    ]);

    const [supplyRaw, stakedRaw] = balances;

    const totalSupply = math.fromUnits(supplyRaw, 18);
    const stakedSupply = math.fromUnits(stakedRaw, 18);
    const yieldBearingShares = math.fromUnits(supplyRaw - stakedRaw, 18);
    requirePositive(yieldBearingShares, "yieldBearingShares");

    const sharePrice = math.fromUnits(pricePerShareRaw, 18);
    requirePositive(sharePrice, "sharePrice");

    const tvlBtc = math.mul(yieldBearingShares, sharePrice);
    requirePositive(tvlBtc, "tvlBtc");

    const elapsedSeconds = Number(block.timestamp - LAUNCH_TIMESTAMP);
    requirePositive(elapsedSeconds, "elapsedSeconds");
    const aprAllTime = math.mul(
      math.div(
        math.mul(math.sub(sharePrice, 1), SECONDS_PER_YEAR),
        elapsedSeconds,
      ),
      100,
    );

    return [
      {
        symbol: "yb-WBTC",
        tvlBtc,
        apr: Math.max(aprAllTime, 0),
        metadata: {
          ...(aprAllTime < 0 && { allowZeroApr: true }),
          rawAprAllTime: aprAllTime,
          ltAddress: LT,
          assetAddress: ASSET_ADDRESS,
          assetDecimals: ASSET_DECIMALS,
          sharePrice,
          launchTimestamp: LAUNCH_TIMESTAMP.toString(),
          elapsedDays: elapsedSeconds / 86_400,
          totalSupply,
          stakedSupply,
          yieldBearingShares,
          sourceBlockNumber: block.number.toString(),
          formulaVersion: FORMULA_VERSION,
        },
      },
    ];
  },
});
