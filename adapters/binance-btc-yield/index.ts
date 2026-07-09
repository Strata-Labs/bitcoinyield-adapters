/**
 * Binance BTC Yield (BTCY) — custodial fund-style product on Binance Earn.
 *
 * Data comes from the same public bapi endpoints the product page uses
 * (keyless, not behind the site's WAF):
 *   overview   → apr14d (fraction) + current NAV
 *   statistics → daily rows with btcTvl; latest row is the TVL
 */

import { defineAdapter, http, math, requirePositive } from "@bitcoinyield/adapters";

interface BtcyEnvelope<T> {
  code: string;
  success: boolean;
  data: T;
}

interface BtcyOverview {
  apr14d: string;
  currentNav: string;
}

interface BtcyStatRow {
  bizDate: string;
  nav: string;
  btcTvl: string;
}

const BAPI = "https://www.binance.com/bapi/earn/v1/public/earn/btcy/project";

function unwrap<T>(res: BtcyEnvelope<T>, endpoint: string): T {
  if (!res.success || res.code !== "000000") {
    throw new Error(`binance btcy ${endpoint} returned code ${res.code}`);
  }
  return res.data;
}

export default defineAdapter({
  slug: "binance-btc-yield",
  name: "Binance BTC Yield",
  url: "https://www.binance.com/en/earn/btc-yield",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    // Statistics rows are daily (bizDate = midnight UTC). Query the last
    // 3 days so a not-yet-published "today" row never leaves us empty.
    const end = Date.now();
    const start = end - 3 * 24 * 60 * 60 * 1000; // 3days

    const [overview, stats] = await Promise.all([
      http.get<BtcyEnvelope<BtcyOverview>>(`${BAPI}/overview`),
      http.get<BtcyEnvelope<BtcyStatRow[]>>(
        `${BAPI}/statistics?startTime=${start}&endTime=${end}`,
      ),
    ]);

    const { apr14d, currentNav } = unwrap(overview, "overview");
    const rows = unwrap(stats, "statistics");
    const latest = rows.at(-1);
    if (!latest) throw new Error("binance btcy statistics returned no rows");

    // apr14d is a fraction (0.0044 = 0.44%).
    const apr = math.mul(requirePositive(apr14d, "apr14d"), 100);
    const tvlBtc = requirePositive(latest.btcTvl, "btcTvl");

    return [
      {
        symbol: "BTCY",
        tvlBtc,
        apr,
        metadata: {
          nav: requirePositive(currentNav, "currentNav"),
          aprWindow: "14d",
          tvlAsOf: Number(latest.bizDate),
        },
      },
    ];
  },
});
