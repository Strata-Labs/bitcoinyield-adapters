/**
 * Merlin BTC Staking adapter — scraper with click interaction.
 *
 * The page has multiple "phase" tabs; the active one isn't always selected
 * by default. We click on the "Live" tab before reading.
 */

import { defineAdapter, math, scraper } from "@bitcoinyield/adapters";

const MERLIN_URL = "https://merlinchain.io/stakebtc";

export default defineAdapter({
  slug: "merlin-btc",
  name: "Merlin Chain",
  url: "https://merlinchain.io",
  category: "staking",
  custody: "multisig",

  async fetch() {
    const session = await scraper.openPage(MERLIN_URL);
    try {
      try {
        const live = session.page
          .locator("//*[contains(text(), 'Live')]")
          .first();
        if (await live.isVisible()) await live.click();
      } catch (err) {
        console.warn(`[merlin-btc] Live tab click skipped: ${err}`);
      }

      await session.waitForText(/All Users[''"]?\s*Stake[\s\n]*[\d,.]+\s*BTC/i);
      const text = await session.getText();

      const stakeBtc =
        scraper.matchNumber(
          text,
          /All Users[''"]?\s*Stake[\s\n]*([\d,.]+)\s*BTC/i,
        ) ?? 0;
      // The page has cycled through three APR formats: a bare "APR 17%"
      // label (current), "Historical Average: X%", and a "low - high %"
      // range. Try newest first, keep the older two as fallbacks.
      const labelApr = scraper.matchNumber(text, /\bAPR[\s\n]*([\d.]+)\s*%/i);
      const histApr = scraper.matchNumber(
        text,
        /Historical Average[:\s]*([\d.]+)\s*%/i,
      );
      const aprLow =
        scraper.matchNumber(text, /([\d.]+)\s*[-–]\s*[\d.]+\s*%/i) ?? 0;
      const aprHigh =
        scraper.matchNumber(text, /[\d.]+\s*[-–]\s*([\d.]+)\s*%/i) ?? 0;

      const apr =
        labelApr ??
        histApr ??
        (aprLow > 0 && aprHigh > 0
          ? math.div(math.add(aprLow, aprHigh), 2)
          : 0);

      // APR never legitimately reads 0 on this page — treat it as a parse
      // miss so Inngest retries instead of silently storing a bad row.
      if (apr === 0 || stakeBtc === 0) {
        throw new Error(
          `Merlin scrape parse miss (apr=${apr}, stakeBtc=${stakeBtc}). ` +
            `Snippet: ${text.slice(0, 500)}`,
        );
      }

      return [
        {
          symbol: "BTC",
          tvlBtc: stakeBtc,
          apr,
          metadata: {
            aprSource: labelApr !== null ? "apr-label" : "fallback",
            sessionId: session.sessionId,
          },
        },
      ];
    } finally {
      await session.close();
    }
  },
});
