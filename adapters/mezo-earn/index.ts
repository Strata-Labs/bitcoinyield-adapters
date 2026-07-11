/**
 * Mezo Earn (veBTC locking) adapter — reads Mezo's own API (replaces the
 * earlier Browserbase scrape; the "no API" note that justified it is stale).
 *
 * GET api.mezo.org/locks/stats?type=vebtc returns the veBTC lock totals and
 * the previous epoch's chain fees. The endpoint answers plain requests with
 * a 500 unless Origin/Referer headers are sent.
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

// The API's filter answers a blanket 500 unless Origin/Referer are present.
// The User-Agent identifies us honestly with a contact URL so Mezo can see
// who is calling and reach out; no browser impersonation is needed.
const API_HEADERS = {
  "User-Agent":
    "BitcoinYieldAdapters/1.0 (+https://github.com/Strata-Labs/bitcoinyield-adapters)",
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
      headers: API_HEADERS,
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
