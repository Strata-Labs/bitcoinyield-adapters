/**
 * Yield Basis YB-tBTC Yield Bearing vault — on-chain reads.
 *
 * APR is the all-time annualized PPS growth since market creation (the
 * dashboard's "FT APY"; genesis PPS is exactly 1.0, so no archive read).
 * See `adapters/yb-tbtc-yieldbearing` for full commentary on the pattern.
 *
 * Limitations: BASE yield only. Companion `yb-tbtc-token` adapter adds
 * $YB emissions on top.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const LT = "0x771F7290428d830ECd41E980745c327e507823Ec";
const ASSET_ADDRESS = "0x18084fbA666a33d37592fA2633fD49a74DD93a88"; // tBTC mainnet
const ASSET_DECIMALS = 8;
// Market creation timestamp (tx that deployed LT idx 9, 2026-05-25).
const LAUNCH_TIMESTAMP = 1_779_693_839n;
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
  slug: "yb-tbtc-yieldbearing",
  name: "Yield Basis YB-tBTC (Yield Bearing)",
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
        symbol: "yb-tBTC",
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
