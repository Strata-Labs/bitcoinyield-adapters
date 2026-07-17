/**
 * Binance BTC Yield (BTCY) — custodial fund-style product on Binance Earn.
 *
 * Reads the public bapi endpoints the product page uses (keyless, not
 * behind the site's WAF).
 *
 * TVL: latest daily statistics row's btcTvl.
 * APR: Binance's published apr14d headline when present, so the site
 *      matches what users see on Binance's page. Their figure is gross
 *      strategy yield and excludes NAV drawdowns; the net 14-day NAV
 *      return (which can be lower or negative, e.g. July 2026 drawdown)
 *      is always computed from the statistics series and recorded as
 *      metadata.navApr14d. When Binance nulls apr14d (they do whenever
 *      the headline would be unflattering, which took the adapter down
 *      on 2026-07-11), fall back to that NAV figure floored at 0.
 */

import { defineAdapter, http, math, requirePositive } from "@bitcoinyield/adapters";

interface BtcyEnvelope<T> {
  code: string;
  success: boolean;
  data: T;
}

interface BtcyOverview {
  apr14d: string | null;
  currentNav: string | null;
}

interface BtcyStatRow {
  bizDate: string;
  nav: string;
  btcTvl: string;
}

const BAPI = "https://www.binance.com/bapi/earn/v1/public/earn/btcy/project";

const APR_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Rows are daily (bizDate = midnight UTC). Ask for a couple of days more
    // than the APR window so a late "today" row can't leave it short.
    const end = Date.now();
    const start = end - (APR_WINDOW_DAYS + 3) * DAY_MS;

    // The overview call only carries the headline; statistics is the source
    // of record. Overview failing must not take TVL reporting down with it.
    const [overviewResult, statsRes] = await Promise.all([
      http
        .get<BtcyEnvelope<BtcyOverview>>(`${BAPI}/overview`)
        .then((res) => unwrap(res, "overview"))
        .catch((err) => {
          console.warn(`[binance-btc-yield] overview unavailable: ${err}`);
          return null;
        }),
      http.get<BtcyEnvelope<BtcyStatRow[]>>(
        `${BAPI}/statistics?startTime=${start}&endTime=${end}`,
      ),
    ]);

    const rows = unwrap(statsRes, "statistics");
    const latest = rows.at(-1);
    if (!latest) throw new Error("binance btcy statistics returned no rows");

    const tvlBtc = requirePositive(latest.btcTvl, "btcTvl");
    const navNow = requirePositive(latest.nav, "nav");

    // Net 14d NAV return, always computed: it is the fallback APR and the
    // honest cross-reference against Binance's gross headline.
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
    const navApr = math.mul(
      math.mul(math.sub(math.div(navNow, navThen), 1), 365 / windowDays),
      100,
    );

    // apr14d arrives as a fraction string (0.0022 = 0.22%) or null.
    const reported = overviewResult?.apr14d
      ? parseFloat(overviewResult.apr14d)
      : null;
    const useReported = reported !== null && reported > 0;
    const apr = useReported ? math.mul(reported, 100) : Math.max(navApr, 0);

    return [
      {
        symbol: "BTCY",
        tvlBtc,
        apr,
        metadata: {
          // Only relevant when the fallback floors a negative NAV window.
          allowZeroApr: true,
          aprSource: useReported ? "binance-apr14d" : "nav-series-fallback",
          navApr14d: navApr,
          nav: navNow,
          nav14dAgo: navThen,
          windowDays,
          tvlAsOf: Number(latest.bizDate),
        },
      },
    ];
  },
});
