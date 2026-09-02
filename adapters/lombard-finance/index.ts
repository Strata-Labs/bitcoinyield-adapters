/**
 * Lombard Finance adapter — fully on-chain.
 *
 * TVL: LBTC ERC-20 totalSupply on Ethereum mainnet, valued at the LBTC/BTC
 *      exchange rate from the token's own getRate() (BTC per LBTC, 18
 *      decimals) — i.e. the BTC backing of Ethereum-circulating LBTC only,
 *      NOT protocol-wide backing. LBTC is natively issued cross-chain
 *      (Base, BNB, Sonic, Sui, ...) via CCIP burn-and-mint, so this
 *      undercounts the protocol-wide figure; getting that means paging
 *      Lombard's `/api/v1/addresses` custody list and summing each BTC
 *      balance. Left Ethereum-only intentionally.
 * APY: 30-day compounded growth of getRate(), measured ourselves via
 *      archive reads. Lombard retired Babylon staking in August 2026 and
 *      moved LBTC yield to a Bitwise-managed covered-call strategy (target
 *      2.5% net) that accrues through this exchange rate. The rate is
 *      posted by Lombard's consortium oracle, but reading it on-chain
 *      survives API restructurings (their old `estimated-apy` endpoint was
 *      gutted in the transition, which broke this adapter's previous
 *      version) and lets us measure holder-experienced yield directly
 *      instead of trusting their reported figure.
 *
 * During the strategy's deployment ramp the measured figure can be ~0 or
 * slightly negative (re-marks against near-zero accrual). Those observations
 * remain negative rather than being floored. The 7-day window is
 * recorded in metadata to observe whether it stabilizes enough to become
 * the headline once the strategy is fully deployed.
 */

import {
  defineAdapter,
  createRate,
  ethereum,
  math,
  readShareGrowth,
  requirePositive,
  BLOCKS_PER_30D,
} from "@bitcoinyield/adapters";

const LBTC_ADDRESS = "0x8236a87084f8B84306f72007F36F2618A5634494" as const;
const RATE_DECIMALS = 18;
const BLOCKS_PER_7D_ETHEREUM = 50_400n;
// Lombard's published target at full strategy deployment. Informational
// Metadata only — never the headline rate.
const TARGET_APY_PCT = 2.5;

const rateAbi = [
  {
    inputs: [],
    name: "getRate",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export default defineAdapter({
  slug: "lombard-finance",
  name: "Lombard",
  url: "https://www.lombard.finance/app/stake/",
  category: "yield-bearing",
  custody: "multisig",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    const client = ethereum.getClient();

    const [calls, growth7d, growth30d] = await Promise.all([
      ethereum.multicall([
        {
          address: LBTC_ADDRESS,
          abi: ethereum.erc20Abi,
          functionName: "totalSupply",
        },
        {
          address: LBTC_ADDRESS,
          abi: ethereum.erc20Abi,
          functionName: "decimals",
        },
        {
          address: LBTC_ADDRESS,
          abi: rateAbi,
          functionName: "getRate",
        },
      ]),
      readShareGrowth({
        client,
        address: LBTC_ADDRESS,
        abi: rateAbi,
        functionName: "getRate",
        blocksBack: BLOCKS_PER_7D_ETHEREUM,
        decimals: RATE_DECIMALS,
      }),
      readShareGrowth({
        client,
        address: LBTC_ADDRESS,
        abi: rateAbi,
        functionName: "getRate",
        blocksBack: BLOCKS_PER_30D.ethereum,
        decimals: RATE_DECIMALS,
      }),
    ]);

    const [supplyCall, decimalsCall, rateCall] = calls;
    if (
      supplyCall?.status !== "success" ||
      decimalsCall?.status !== "success" ||
      rateCall?.status !== "success"
    ) {
      throw new Error(
        `LBTC multicall failed: supply=${supplyCall?.status} decimals=${decimalsCall?.status} rate=${rateCall?.status}`,
      );
    }

    const ethereumSupply = requirePositive(
      math.fromUnits(
        supplyCall.result as bigint,
        decimalsCall.result as number,
      ),
      "lbtc.totalSupply",
    );
    const btcPerLbtc = requirePositive(
      math.fromUnits(rateCall.result as bigint, RATE_DECIMALS),
      "lbtc.getRate",
    );
    const tvlBtc = requirePositive(
      math.mul(ethereumSupply, btcPerLbtc),
      "tvlBtc",
    );

    const headline = growth30d.hasBaseline
      ? { window: "30d" as const, growth: growth30d }
      : growth7d.hasBaseline
        ? { window: "7d" as const, growth: growth7d }
        : null;

    if (!headline) {
      throw new Error(
        "LBTC rate history unavailable on this RPC; need archive access for the 30d or 7d window",
      );
    }

    const rawApy = headline.growth.apy;
    const rate = createRate({
      type: "apy",
      value: rawApy,
      basis: "calculated",
      source: `ethereum:${LBTC_ADDRESS}.getRate`,
      windowDays: headline.growth.elapsedDays,
      compounding: {
        method: "automatic",
        evidence: {
          kind: "exchange_rate",
          field: "getRate()",
          reference: `ethereum:${LBTC_ADDRESS}`,
        },
      },
      simpleAprPercent: headline.growth.apr,
    });

    return [
      {
        symbol: "LBTC",
        tvlBtc,
        rate,
        metadata: {
          rawApy,
          rateWindow: headline.window,
          windowDays: headline.growth.elapsedDays,
          rateThen: headline.growth.sharePriceThen,
          apy7d: growth7d.hasBaseline ? growth7d.apy : null,
          apy30d: growth30d.hasBaseline ? growth30d.apy : null,
          linearApr7d: growth7d.hasBaseline ? growth7d.apr : null,
          linearApr30d: growth30d.hasBaseline ? growth30d.apr : null,
          rateSource: `onchain-${headline.window}-rate-growth`,
          targetApyPct: TARGET_APY_PCT,
          contractAddress: LBTC_ADDRESS,
          decimals: decimalsCall.result,
          ethereumSupply,
          exchangeRateBtcPerLbtc: btcPerLbtc,
          transparencyUrl: "https://www.lombard.finance/transparency/lbtc",
        },
      },
    ];
  },
});
