/**
 * Yield Basis YB-cbBTC Yield Bearing vault — on-chain reads.
 *
 * Replaces the Browserbase scraper with direct calls on Yield Basis's LT
 * ("Leveraged Token") contract.
 *
 * APR comes from a 30-day on-chain window via `readShareGrowth` — accurate
 * from day 1 with no warmup cycle. See `adapters/yb-wbtc-yieldbearing` for
 * full commentary on the pattern.
 *
 * Limitations: BASE yield only. Companion `yb-cbbtc-token` adapter adds
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

const LT = "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9";
const ASSET_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // cbBTC mainnet
const ASSET_DECIMALS = 8;

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

    if (!growth.hasBaseline) {
      throw new Error(
        "yb-cbbtc-yieldbearing: 30d share-price baseline unavailable " +
          "(archive read failed) — refusing to report apr=0",
      );
    }

    return [
      {
        symbol: "yb-cbBTC",
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
