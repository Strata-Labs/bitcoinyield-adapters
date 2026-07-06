/**
 * Yield Basis YB-WBTC Yield Bearing vault — on-chain reads.
 *
 * Replaces the Browserbase scraper with direct calls on Yield Basis's LT
 * ("Leveraged Token") contract.
 *
 * LT contract behavior we rely on:
 *   - `pricePerShare()` — assets per 1 share, normalized to 18 decimals
 *     regardless of the underlying token's decimals.
 *   - `updated_balances()` returns `(totalSupply, stakedSupply)`.
 *
 * TVL math for the yield-bearing variant:
 *   yieldBearingShares = (totalSupply - stakedSupply) / 1e18
 *   tvlBtc             = yieldBearingShares × sharePrice
 *
 * APR comes from a 30-day on-chain window via `readShareGrowth` — accurate
 * from day 1 with no warmup cycle, because the blockchain itself is the
 * history. See `src/core/utils/yield.ts` for the helper.
 *
 * Limitations: BASE yield only (LP trading fees). The companion
 * `yb-wbtc-token` adapter adds $YB emissions on top of this same delta.
 */

import {
  defineAdapter,
  ethereum,
  math,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const LT = "0x651D4b8168488FA163D85304662E8278d4c55BAa";
const ASSET_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"; // WBTC mainnet
const ASSET_DECIMALS = 8; // WBTC has 8 decimals; pricePerShare normalizes to 18 so this is metadata-only.

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
    // Two concurrent reads: balances at "latest", and share-price growth
    // over the trailing 30 days (which itself does its own multi-block read
    // internally). They're independent, so Promise.all parallelizes.
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
        symbol: "yb-WBTC",
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
