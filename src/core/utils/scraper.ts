/**
 * Scraper utility (Stagehand wrapper).
 *
 * For adapters whose protocol publishes APR/TVL only on a web page (not via
 * an API). Stagehand runs a real browser via Browserbase, which handles
 * JS-rendered pages, anti-bot challenges, etc.
 *
 * The wrapper handles env var lookup, session lifecycle, and DOM-readiness
 * waits so each scraper adapter is just "open page, read these values".
 *
 * Required environment (set in production deploy, or in .env.local for local dev):
 *   - BITCOINYIELD_BROWSERBASE_KEY
 *   - BITCOINYIELD_BROWSERBASE_PROJECT_ID
 *
 * Without these, scrape() throws a descriptive error so the runner retries
 * (or, for unrecoverable cases like missing keys, surfaces the failure to
 * the staleness monitor → Discord alert).
 */

import { Stagehand } from "@browserbasehq/stagehand";

/**
 * Minimal subset of the Stagehand Page interface we use. Stagehand v3 does
 * NOT expose Playwright's `waitForFunction`/`waitForSelector` — only
 * `goto`, `evaluate`, `locator`, and `waitForLoadState`. We poll via
 * `evaluate` for content readiness instead (see pollForText below).
 */
interface StagehandLikeContext {
  pages?: () => Array<StagehandLikePage>;
}
export interface StagehandLikePage {
  goto: (url: string, options?: { waitUntil?: string }) => Promise<unknown>;
  evaluate: <R, Arg = unknown>(
    fn: ((arg: Arg) => R | Promise<R>) | (() => R | Promise<R>),
    arg?: Arg,
  ) => Promise<R>;
  locator: (selector: string) => {
    first: () => {
      isVisible: () => Promise<boolean>;
      click: () => Promise<void>;
    };
  };
}

export interface ScrapeOptions {
  /** Wait until this regex matches document.body.innerText before scraping. */
  waitForText?: RegExp;
  /**
   * Max time (ms) to wait for waitForText / page load. Default: 15_000.
   * Stagehand's Browserbase sessions cost time, so don't go too long.
   */
  timeoutMs?: number;
}

export interface ScrapedContent {
  /** Full document.body.innerText at the time of scrape. */
  text: string;
  /** Convenience: extract the first capturing group from a regex against text. */
  match(regex: RegExp): string | null;
  /** Convenience: extract a parsed number from a regex (allows `[\d,]+(?:\.\d+)?`). */
  matchNumber(regex: RegExp): number | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Poll `document.body.innerText` via page.evaluate until it matches the
 * regex, or throw after `timeoutMs`. Replaces Playwright's `waitForFunction`
 * which Stagehand v3 doesn't expose.
 */
async function pollForText(
  page: StagehandLikePage,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  const POLL_INTERVAL_MS = 250;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const present = await page.evaluate(
      (re: { source: string; flags: string }) =>
        new RegExp(re.source, re.flags).test(document.body.innerText),
      { source: pattern.source, flags: pattern.flags },
    );
    if (present) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for text matching ${pattern}`,
  );
}

function getCredentials(): { apiKey: string; projectId: string } {
  const apiKey = process.env.BITCOINYIELD_BROWSERBASE_KEY;
  const projectId = process.env.BITCOINYIELD_BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      "Scraper requires BITCOINYIELD_BROWSERBASE_KEY and BITCOINYIELD_BROWSERBASE_PROJECT_ID. " +
        "Set them in .env.local for local dev (sign up at https://browserbase.com for a free trial).",
    );
  }
  return { apiKey, projectId };
}

/**
 * Open a URL in a Browserbase session, wait until ready, return the rendered text.
 *
 * @example
 *   const page = await scrape('https://mezo.org/earn/lock', {
 *     waitForText: /[\d.]+\s*%\s*APR/i,
 *   })
 *   const apr = page.matchNumber(/([\d.]+)\s*%\s*APR/i)
 *   const tvl = page.matchNumber(/TVL\s*\$?([\d,]+(?:\.\d+)?)/i)
 */
export async function scrape(
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapedContent> {
  const { apiKey, projectId } = getCredentials();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isProduction = process.env.NODE_ENV === "production";

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    disablePino: isProduction,
  });

  try {
    await stagehand.init();

    const context = stagehand.context as unknown as StagehandLikeContext;
    const page = context?.pages?.()?.[0];
    if (!page) {
      throw new Error(
        `Stagehand session opened but no page available for ${url}`,
      );
    }

    await page.goto(url, { waitUntil: "networkidle" });

    if (options.waitForText) {
      await pollForText(page, options.waitForText, timeoutMs);
    }

    const text = await page.evaluate(() => document.body.innerText);

    return {
      text,
      match: (regex: RegExp) => firstCapture(text, regex),
      matchNumber: (regex: RegExp) => matchNumber(text, regex),
    };
  } finally {
    await stagehand.close().catch(() => {
      // Failure to close session is best-effort; don't mask the original error.
    });
  }
}

export interface OpenedSession {
  page: StagehandLikePage;
  /** Caller MUST invoke close() — typically in a try/finally. */
  close: () => Promise<void>;
  sessionId: string | undefined;
  /** Navigate to a different URL using the same session (for multi-page scrapes). */
  goto: (
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" },
  ) => Promise<void>;
  /** Wait until document.body.innerText matches the given regex. Default 15s. */
  waitForText: (regex: RegExp, timeoutMs?: number) => Promise<void>;
  /** Read document.body.innerText. */
  getText: () => Promise<string>;
}

/**
 * First capturing group of a regex against the text, or null.
 * A `g` flag is stripped first: `String.match` with a global regex returns
 * full matches with NO capture groups, so `m[1]` would silently be the
 * second full match instead of the first group.
 */
function firstCapture(text: string, regex: RegExp): string | null {
  const safe = regex.global
    ? new RegExp(regex.source, regex.flags.replace(/g/g, ""))
    : regex;
  const m = text.match(safe);
  return m && m[1] ? m[1] : null;
}

/**
 * Extract the first capturing group of a regex, parse as comma-stripped float.
 * Returns null if no match or non-finite. Use with openPage() text scrapes.
 */
export function matchNumber(text: string, regex: RegExp): number | null {
  const captured = firstCapture(text, regex);
  if (captured === null) return null;
  const n = parseFloat(captured.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lower-level escape hatch for adapters that need to interact with the page
 * (click buttons, navigate between routes, scrape multiple URLs in sequence).
 *
 * For simple "open page, read text" use scrape() — this is for complex flows.
 *
 * @example
 *   const session = await openPage('https://merlinchain.io/stakebtc')
 *   try {
 *     const live = session.page.locator("//*[contains(text(), 'Live')]").first()
 *     if (await live.isVisible()) await live.click()
 *     // ... read text, click more, etc.
 *   } finally {
 *     await session.close()
 *   }
 */
export async function openPage(
  url: string,
  options: { waitUntil?: "load" | "domcontentloaded" | "networkidle" } = {},
): Promise<OpenedSession> {
  const { apiKey, projectId } = getCredentials();
  const isProduction = process.env.NODE_ENV === "production";

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    disablePino: isProduction,
  });

  await stagehand.init();
  const sessionId = (stagehand as unknown as { browserbaseSessionID?: string })
    .browserbaseSessionID;

  try {
    const context = stagehand.context as unknown as StagehandLikeContext;
    const page = context?.pages?.()?.[0];
    if (!page) {
      throw new Error(
        `Stagehand session opened but no page available for ${url}`,
      );
    }
    await page.goto(url, { waitUntil: options.waitUntil ?? "networkidle" });

    const goto: OpenedSession["goto"] = async (newUrl, gotoOptions) => {
      await page.goto(newUrl, {
        waitUntil: gotoOptions?.waitUntil ?? "networkidle",
      });
    };

    const waitForText: OpenedSession["waitForText"] = (
      regex,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    ) => pollForText(page, regex, timeoutMs);

    const getText: OpenedSession["getText"] = () =>
      page.evaluate(() => document.body.innerText);

    return {
      page,
      sessionId,
      goto,
      waitForText,
      getText,
      close: async () => {
        await stagehand.close().catch(() => {});
      },
    };
  } catch (err) {
    await stagehand.close().catch(() => {});
    throw err;
  }
}
