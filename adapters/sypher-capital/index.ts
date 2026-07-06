/**
 * Sypher Capital — institutional fund, no public API.
 * Values updated manually from monthly reports.
 *
 * Last updated: 2026-07-06
 */

import { defineAdapter, math, prices } from "@bitcoinyield/adapters";

const REPORTED_APR = 4.35;
const REPORTED_TVL_USD = 6_000_000; // within the reported $5-10M range

export default defineAdapter({
  slug: "sypher-capital",
  name: "Sypher Capital",
  url: "https://syphercapital.com",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    const btcPrice = await prices.getBtc();
    const tvlBtc = math.div(REPORTED_TVL_USD, btcPrice);

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd: REPORTED_TVL_USD,
        apr: REPORTED_APR,
        metadata: { source: "monthly-report", reportedAt: "2026-07-06" },
      },
    ];
  },
});
