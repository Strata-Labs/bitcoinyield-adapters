/**
 * Merlin BTC Staking adapter — scraper with click interaction.
 *
 * The page has one tab per staking phase and opens on a completed phase, so
 * the live phase's stats are only visible after clicking its tab. The fetch
 * waits for the tabs to render, clicks the "Live" tab, and waits for the
 * stats panel to actually swap before reading.
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
      const STAKE_RE = /All Users[''"]?\s*Stake[\s\n]*([\d,.]+)\s*BTC/i;

      // The page opens on a completed phase's stats; the live phase is a
      // separate tab. Both render client-side, and locator.isVisible() does
      // not wait, so clicking before the tabs exist silently skips the click
      // and reads stale completed-phase figures (July 2026: 76 BTC reported
      // while the live Phase 5 held ~10). Wait for the stats and the live
      // tab to render before touching anything; a page with no live tab
      // fails loudly on purpose.
      await session.waitForText(STAKE_RE);
      await session.waitForText(/Staking Live/i);
      const preClickStake = scraper.matchNumber(
        await session.getText(),
        STAKE_RE,
      );

      // Click via the DOM, not Playwright's locator: locator.click() flakes
      // in Browserbase (hit-testing against the horizontally scrolling tab
      // row), while a JS-dispatched click swaps the panel reliably.
      await session.page.evaluate(() => {
        const node = document.evaluate(
          "//*[contains(text(), 'Live')]",
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
        (node as HTMLElement | null)?.click();
      });

      // The tab swap is client-side, no navigation. Poll until the stake
      // figure moves off the pre-click (completed phase) value, and refuse
      // to record if it never does: the stale figure looks plausible, so
      // failing loudly beats silently storing the wrong phase again.
      const deadline = Date.now() + 10_000;
      let text = await session.getText();
      while (
        scraper.matchNumber(text, STAKE_RE) === preClickStake &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        text = await session.getText();
      }
      if (scraper.matchNumber(text, STAKE_RE) === preClickStake) {
        throw new Error(
          `Merlin live tab did not swap in (stake still ${preClickStake}). ` +
            `Snippet: ${text.slice(0, 300)}`,
        );
      }

      const stakeBtc = scraper.matchNumber(text, STAKE_RE) ?? 0;
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
