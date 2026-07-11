/**
 * Binance BTC Yield (BTCY) — custodial fund-style product on Binance Earn.
 *
 * Reads the public statistics endpoint the product page uses (keyless, not
 * behind the site's WAF): daily rows of nav + btcTvl.
 *
 * TVL: latest daily row's btcTvl.
 * APR: 14-day annualized NAV growth, computed from the series. The overview
 *      endpoint's apr14d headline is NOT used: Binance nulls it whenever the
 *      figure would be unflattering (observed 2026-07-11 with NAV below 1.0),
 *      which took the adapter down. When present, apr14d matches this
 *      computation to rounding. NAV can genuinely decline, so a negative
 *      window is floored at 0 with the raw figure kept in metadata,
 *      mirroring acre-mezo's dormant handling.
 */

import { defineAdapter, http, math, requirePositive } from "@bitcoinyield/adapters";

interface BtcyEnvelope<T> {
  code: string;
  success: boolean;
  data: T;
}

interface BtcyStatRow {
  bizDate: string;
  nav: string;
  btcTvl: string;
}

const STATISTICS_URL =
  "https://www.binance.com/bapi/earn/v1/public/earn/btcy/project/statistics";

const APR_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export default defineAdapter({
  slug: "binance-btc-yield",
  name: "Binance BTC Yield",
  url: "https://www.binance.com/en/earn/btc-yield",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    // Rows are daily (bizDate = midnight UTC). Ask for a couple of days more
    // than the APR window so a late "today" row can't leave it short.
    const end = Date.now();
    const start = end - (APR_WINDOW_DAYS + 3) * DAY_MS;

    const res = await http.get<BtcyEnvelope<BtcyStatRow[]>>(
      `${STATISTICS_URL}?startTime=${start}&endTime=${end}`,
    );
    if (!res.success || res.code !== "000000") {
      throw new Error(`binance btcy statistics returned code ${res.code}`);
    }
    const rows = res.data;
    const latest = rows.at(-1);
    if (!latest) throw new Error("binance btcy statistics returned no rows");

    const tvlBtc = requirePositive(latest.btcTvl, "btcTvl");
    const navNow = requirePositive(latest.nav, "nav");

    // Row closest to APR_WINDOW_DAYS before the latest row.
    const targetDate = Number(latest.bizDate) - APR_WINDOW_DAYS * DAY_MS;
    const baseline = rows.reduce((best, row) =>
      Math.abs(Number(row.bizDate) - targetDate) <
      Math.abs(Number(best.bizDate) - targetDate)
        ? row
        : best,
    );
    const windowDays =
      (Number(latest.bizDate) - Number(baseline.bizDate)) / DAY_MS;
    if (windowDays < APR_WINDOW_DAYS / 2) {
      throw new Error(
        `binance btcy statistics window too short (${windowDays} days)`,
      );
    }
    const navThen = requirePositive(baseline.nav, "baseline nav");

    // Annualized NAV growth over the window; reproduces Binance's apr14d
    // headline when they publish one. The fund can lose money, so floor at
    // 0 (the pipeline treats negative apr as a parse bug) and keep the raw
    // figure visible.
    const rawApr = math.mul(
      math.mul(math.sub(math.div(navNow, navThen), 1), 365 / windowDays),
      100,
    );
    const apr = Math.max(rawApr, 0);

    return [
      {
        symbol: "BTCY",
        tvlBtc,
        apr,
        metadata: {
          allowZeroApr: true,
          rawApr14d: rawApr,
          nav: navNow,
          nav14dAgo: navThen,
          windowDays,
          aprSource: "nav-series",
          tvlAsOf: Number(latest.bizDate),
        },
      },
    ];
  },
});
