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
    // Capture an optional K/M/B suffix — if the UI ever abbreviates
    // ("TVL $262.8M"), reading 262.8 as whole dollars would be a ~10^6
    // understatement that still passes every downstream guard.
    const tvlMatch = page.text.match(/TVL\s*\$?([\d,]+(?:\.\d+)?)\s*([KMB])?/i);
    const tvlBase = requirePositive(
      tvlMatch?.[1]?.replace(/,/g, ""),
      "mezo tvlUsd",
    );
    const suffix = tvlMatch?.[2]?.toUpperCase();
    const tvlUsd = math.mul(
      tvlBase,
      suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : suffix === "K" ? 1e3 : 1,
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
