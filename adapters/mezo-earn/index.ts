/**
 * Mezo Earn adapter — scraper.
 *
 * Mezo doesn't expose an API; APR + TVL are read from the staking page.
 * The waitForText regex avoids the fixed-sleep race that produced silent
 * zeros in the original adapter.
 */

import {
  defineAdapter,
  math,
  prices,
  requirePositive,
  scraper,
} from "@bitcoinyield/adapters";

const MEZO_EARN_URL = "https://mezo.org/earn/lock";

export default defineAdapter({
  slug: "mezo-earn",
  name: "Mezo Earn",
  url: "https://mezo.org/earn",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const [page, btcPrice] = await Promise.all([
      scraper.scrape(MEZO_EARN_URL, { waitForText: /[\d.]+\s*%\s*APR/i }),
      prices.getBtc(),
    ]);

    // Suffix-agnostic regex: the page historically rendered "X% APR + Boosts"
    // but the trailing token has changed across UI revisions.
    const apr = requirePositive(
      page.matchNumber(/([\d.]+)\s*%\s*APR/i),
      "mezo apr",
    );
    const tvlUsd = requirePositive(
      page.matchNumber(/TVL\s*\$?([\d,]+(?:\.\d+)?)/i),
      "mezo tvlUsd",
    );

    return [
      {
        symbol: "BTC",
        tvlBtc: math.div(tvlUsd, btcPrice),
        tvlUsd,
        apr,
      },
    ];
  },
});
