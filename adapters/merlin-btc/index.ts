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
      // Click the "Live" tab if visible (page may default to another tab)
      try {
        const live = session.page
          .locator("//*[contains(text(), 'Live')]")
          .first();
        if (await live.isVisible()) await live.click();
      } catch {
        // No Live tab — read whatever's shown
      }

      await session.waitForText(/All Users[''"]?\s*Stake[\s\n]*[\d.]+\s*BTC/i);
      const text = await session.getText();

      const stakeBtc =
        scraper.matchNumber(
          text,
          /All Users[''"]?\s*Stake[\s\n]*([\d.]+)\s*BTC/i,
        ) ?? 0;
      const histApr = scraper.matchNumber(
        text,
        /Historical Average[:\s]*([\d.]+)\s*%/i,
      );
      const aprLow =
        scraper.matchNumber(text, /([\d.]+)\s*[-–]\s*[\d.]+\s*%/i) ?? 0;
      const aprHigh =
        scraper.matchNumber(text, /[\d.]+\s*[-–]\s*([\d.]+)\s*%/i) ?? 0;

      const apr =
        histApr ??
        (aprLow > 0 && aprHigh > 0
          ? math.div(math.add(aprLow, aprHigh), 2)
          : 0);

      if (apr === 0 && stakeBtc === 0) {
        throw new Error(
          `Merlin scrape returned no data. Snippet: ${text.slice(0, 500)}`,
        );
      }

      return [
        {
          symbol: "BTC",
          tvlBtc: stakeBtc,
          apr,
          metadata: { aprLow, aprHigh, sessionId: session.sessionId },
        },
      ];
    } finally {
      await session.close();
    }
  },
});
