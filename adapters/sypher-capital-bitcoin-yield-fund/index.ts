/**
 * Sypher Capital — institutional fund, no public API. APR/TVL are maintained
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
    const apr = requirePositive(manual.aprPercent, "cms.aprPercent");
    const tvlUsd = requirePositive(manual.tvlUsd, "cms.tvlUsd");
    const tvlBtc = math.div(tvlUsd, await prices.getBtc());

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd,
        apr,
        metadata: {
          source: "cms",
          sourceDetail: "monthly-report",
          cmsUpdatedAt: manual.updatedAt,
        },
      },
    ];
  },
});
