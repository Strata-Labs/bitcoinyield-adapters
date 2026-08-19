/**
 * Yield Basis YB-cbBTC Yield Bearing vault — on-chain reads.
 *
 * APR is the all-time annualized PPS growth since market creation (the
 * dashboard's "FT APY"; genesis PPS is exactly 1.0, so no archive read).
 * See `adapters/yb-cbbtc-yieldbearing` for full commentary on the pattern.
 *
 * Limitations: BASE yield only. Companion `yb-cbbtc-token` adapter adds
 * $YB emissions on top.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const LT = "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9";
const ASSET_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // cbBTC mainnet
const ASSET_DECIMALS = 8;
// Market creation timestamp (tx that deployed LT idx 8, 2026-05-25).
const LAUNCH_TIMESTAMP = 1_779_693_827n;
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
  slug: "yb-cbbtc-yieldbearing",
  name: "Yield Basis YB-cbBTC (Yield Bearing)",
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
        symbol: "yb-cbBTC",
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
