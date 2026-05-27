/**
 * Yield Basis YB-tBTC Yield Bearing vault — on-chain reads.
 *
 * Replaces the Browserbase scraper with direct calls on Yield Basis's LT
 * ("Leveraged Token") contract.
 *
 * Per-market addresses (from Yield Basis docs):
 *   LT (yb-tBTC) : 0xaC0a340C1644321D0BBc6404946d828c1EBfAC92
 *   Underlying   : 0x18084fbA666a33d37592fA2633fD49a74DD93a88 (tBTC, 18 decimals)
 *
 * APR comes from a 30-day on-chain window via `readShareGrowth` — accurate
 * from day 1 with no warmup cycle. See `adapters/yb-wbtc-yieldbearing` for
 * full commentary on the pattern.
 *
 * Limitations: BASE yield only. Companion `yb-tbtc-token` adapter adds
 * $YB emissions on top.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const LT = "0xaC0a340C1644321D0BBc6404946d828c1EBfAC92";
const ASSET_ADDRESS = "0x18084fbA666a33d37592fA2633fD49a74DD93a88"; // tBTC mainnet
const ASSET_DECIMALS = 18;

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
    const [balancesCall, growth] = await Promise.all([
      ethereum.readContract<readonly [bigint, bigint]>({
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "updated_balances",
      }),
      readShareGrowth({
        client: ethereum.getClient(),
        address: LT,
        abi: yieldBasisLtAbi,
        functionName: "pricePerShare",
        blocksBack: BLOCKS_PER_30D.ethereum,
        decimals: 18,
      }),
    ]);

    const [supplyRaw, stakedRaw] = balancesCall;

    const totalSupply = math.fromUnits(supplyRaw, 18);
    const stakedSupply = math.fromUnits(stakedRaw, 18);
    const yieldBearingShares = math.fromUnits(supplyRaw - stakedRaw, 18);
    requirePositive(yieldBearingShares, "yieldBearingShares");

    const tvlBtc = math.mul(yieldBearingShares, growth.sharePriceNow);
    requirePositive(tvlBtc, "tvlBtc");

    return [
      {
        symbol: "yb-tBTC",
        tvlBtc,
        apr: growth.apr,
        metadata: {
          ltAddress: LT,
          assetAddress: ASSET_ADDRESS,
          assetDecimals: ASSET_DECIMALS,
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          apy30d: growth.apy,
          windowDays: growth.elapsedDays,
          totalSupply,
          stakedSupply,
          yieldBearingShares,
        },
      },
    ];
  },
});
