/**
 * Sypher Capital — institutional fund, no public API. Rate/TVL are maintained
 * in the main app's CMS from monthly reports: edit there, no deploy.
 */

import {
  cms,
  defineAdapter,
  math,
  prices,
  requirePositive,
} from "@bitcoinyield/adapters";

// Must equal the CMS yieldProducts slug AND the main app's protocol key —
// renaming breaks the metrics lookup, history continuity, and the CMS read.
const SLUG = "sypher-capital-bitcoin-yield-fund";

export default defineAdapter({
  slug: SLUG,
  name: "Sypher Capital",
  url: "https://syphercapital.com",
  category: "yield-bearing",
  custody: "custodial",
  requires: { secrets: ["API_URL", "ADAPTER_KEY"] },

  async fetch(ctx) {
    const manual = await cms.getManualMetrics(ctx, SLUG);
    const rate = requirePositive(manual.ratePercent, "cms.ratePercent");
    const tvlUsd = requirePositive(manual.tvlUsd, "cms.tvlUsd");
    const tvlBtc = math.div(tvlUsd, await prices.getBtc());

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd,
        rate,
        // Label is the adapter's call, not the CMS's. Flip this if the fund
        // starts quoting a compounded (APY) figure.
        rateType: "apr",
        metadata: {
          source: "cms",
          sourceDetail: "monthly-report",
          cmsUpdatedAt: manual.updatedAt,
        },
      },
    ];
  },
});
