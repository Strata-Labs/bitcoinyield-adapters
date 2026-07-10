/**
 * Mezo Earn (veBTC locking) adapter — reads Mezo's own API (replaces the
 * earlier Browserbase scrape; the "no API" note that justified it is stale).
 *
 * GET api.mezo.org/locks/stats?type=vebtc returns the veBTC lock totals and
 * the previous epoch's chain fees. The endpoint answers plain requests with
 * a 500 unless browser-ish Origin/Referer headers are sent.
 *
 * TVL: totalLocked (18 decimals) is BTC only. The page's headline TVL also
 *      includes locked MEZO (type=vemezo, ~$4M), which the old scrape was
 *      wrongly recording as BTC TVL.
 * APR: previousEpochChainFeesUSD annualized over weekly epochs against the
 *      veBTC TVL. Reproduces the page's headline (0.24%) to rounding, from
 *      data instead of display text. The page's "up to X% vAPR" boost is a
 *      max-boost promo figure and is deliberately ignored, as before.
 */

import {
  defineAdapter,
  http,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const STATS_URL = "https://api.mezo.org/locks/stats?type=vebtc";

// Without these the API returns a blanket 500 instead of JSON.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://mezo.org",
  Referer: "https://mezo.org/",
};

// veBTC epochs are weekly (Curve-style). Cross-checked against the page:
// fees x 52 / tvl reproduces its displayed APR to rounding.
const EPOCHS_PER_YEAR = 52;

interface LockStats {
  success: boolean;
  data: {
    totalLocked: string;
    tvlUSD: string;
    previousEpochChainFeesUSD: string;
  };
}

export default defineAdapter({
  slug: "mezo-earn",
  name: "Mezo Earn",
  url: "https://mezo.org/earn",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const res = await http.get<LockStats>(STATS_URL, {
      headers: BROWSER_HEADERS,
    });
    if (!res.success) {
      throw new Error("mezo locks/stats returned success=false");
    }

    const tvlBtc = requirePositive(
      math.fromUnits(BigInt(res.data.totalLocked), 18),
      "totalLocked",
    );
    const tvlUsd = requirePositive(res.data.tvlUSD, "tvlUSD");
    const epochFeesUsd = requirePositive(
      res.data.previousEpochChainFeesUSD,
      "previousEpochChainFeesUSD",
    );

    const apr = math.mul(
      math.div(math.mul(epochFeesUsd, EPOCHS_PER_YEAR), tvlUsd),
      100,
    );

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd,
        apr,
        metadata: {
          previousEpochChainFeesUsd: epochFeesUsd,
          epochsPerYear: EPOCHS_PER_YEAR,
          source: "api.mezo.org/locks/stats",
        },
      },
    ];
  },
});
