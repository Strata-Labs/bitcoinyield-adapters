/**
 * Coinbase BTC Yield Fund — institutional product, TVL not disclosed. APR is
 * maintained in the main app's CMS from monthly reports: edit there, no deploy.
 */

import {
  BOUNDARIES,
  cms,
  defineAdapter,
  math,
  prices,
  requirePositive,
} from "@bitcoinyield/adapters";

// Must equal the CMS yieldProducts slug AND the main app's protocol key —
// renaming breaks the metrics lookup, history continuity, and the CMS read.
const SLUG = "coinbase-bitcoin-yield-fund";

export default defineAdapter({
  slug: SLUG,
  name: "Coinbase BTC Yield Fund",
  url: "https://www.coinbase.com",
  category: "yield-bearing",
  custody: "custodial",
  requires: { secrets: ["API_URL", "ADAPTER_KEY"] },

  async fetch(ctx) {
    const manual = await cms.getManualMetrics(ctx, SLUG);
    const apr = requirePositive(manual.aprPercent, "cms.aprPercent");

    // Undisclosed TVL (null from the CMS): pin to the framework's lower bound
    // so the row survives the boundary check; metadata.tvlDisclosed flags it.
    const tvlDisclosed = manual.tvlUsd !== null;
    const tvlBtc = tvlDisclosed
      ? math.div(
          requirePositive(manual.tvlUsd, "cms.tvlUsd"),
          await prices.getBtc(),
        )
      : BOUNDARIES.tvlBtc.lb;

    return [
      {
        symbol: "BTC",
        tvlBtc,
        tvlUsd: manual.tvlUsd ?? 0,
        apr,
        metadata: {
          tvlDisclosed,
          source: "cms",
          sourceDetail: "monthly-report",
          cmsUpdatedAt: manual.updatedAt,
        },
      },
    ];
  },
});
