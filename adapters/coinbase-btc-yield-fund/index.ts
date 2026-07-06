/**
 * Coinbase BTC Yield Fund — institutional product, TVL not disclosed.
 * APR updated manually from monthly reports.
 *
 * Last updated: 2026-04-21
 */

import {
  BOUNDARIES,
  defineAdapter,
  math,
  prices,
} from "@bitcoinyield/adapters";

const REPORTED_APR = 4.0; // ~4.00% APR
const REPORTED_TVL_USD = 0; // not disclosed

export default defineAdapter({
  slug: "coinbase-btc-yield-fund",
  name: "Coinbase BTC Yield Fund",
  url: "https://www.coinbase.com",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    // Coinbase doesn't disclose TVL. Pin to the framework's lower-bound so
    // the row survives the boundary check; metadata.tvlDisclosed = false flags
    // it. Only fetch the BTC price if a reported figure ever gets filled in —
    // a dead CoinGecko call is a run-failure risk for nothing.
    const tvlBtc =
      REPORTED_TVL_USD > 0
        ? math.div(REPORTED_TVL_USD, await prices.getBtc())
        : BOUNDARIES.tvlBtc.lb;

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd: REPORTED_TVL_USD,
        apr: REPORTED_APR,
        metadata: { tvlDisclosed: false, source: "monthly-report" },
      },
    ];
  },
});
