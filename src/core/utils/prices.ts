/**
 * Canonical USD price helpers via CoinGecko. Uses the same URL the main
 * BitcoinYield app uses so the two services see compatible numbers.
 *
 * In-process cache is mostly a no-op on Vercel serverless (each invocation
 * is its own Lambda) but harmless and occasionally helps on warm reuse. If
 * CoinGecko ever rate-limits, switch to a shared Redis pointed at the main
 * app's `btc-price-with-change` key.
 *
 * Requests go through the retrying `http` helper (429s back off instead of
 * failing the run), and concurrent cache misses share one in-flight request
 * so the hourly fan-out can't stampede CoinGecko.
 */

import { get } from "./http.js";

const COINGECKO_BTC_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";

const cache = new Map<string, { price: number; cachedAt: number }>();
const inflight = new Map<string, Promise<number>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): number | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.price;
}

function fetchPrice(
  key: string,
  url: string,
  extract: (data: unknown) => number | undefined,
  label: string,
): Promise<number> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const data = await get(url);
    const price = extract(data);
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(
        `Invalid price returned from CoinGecko for ${label}: ${price}`,
      );
    }
    cache.set(key, { price, cachedAt: Date.now() });
    return price;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

export async function getBtc(): Promise<number> {
  const key = "coingecko:bitcoin";
  const cached = getCached(key);
  if (cached !== null) return cached;

  return fetchPrice(
    key,
    COINGECKO_BTC_PRICE_URL,
    (data) => (data as { bitcoin?: { usd?: number } }).bitcoin?.usd,
    "bitcoin",
  );
}

/**
 * Spot price for any token by its CoinGecko id (e.g. `'yield-basis'`).
 */
export async function getToken(coingeckoId: string): Promise<number> {
  const key = `coingecko:${coingeckoId}`;
  const cached = getCached(key);
  if (cached !== null) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`;
  return fetchPrice(
    key,
    url,
    (data) => (data as Record<string, { usd?: number }>)[coingeckoId]?.usd,
    coingeckoId,
  );
}
