/**
 * Canonical USD price helpers via CoinGecko. Uses the same URL the main
 * BitcoinYield app uses so the two services see compatible numbers.
 *
 * In-process cache is mostly a no-op on Vercel serverless (each invocation
 * is its own Lambda) but harmless and occasionally helps on warm reuse. If
 * CoinGecko ever rate-limits, switch to a shared Redis pointed at the main
 * app's `btc-price-with-change` key.
 */

const COINGECKO_BTC_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'

const cache = new Map<string, { price: number; cachedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

interface CoinGeckoResponse {
  bitcoin: { usd: number; usd_24h_change?: number }
}

function getCached(key: string): number | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.price
}

function setCached(key: string, price: number): void {
  cache.set(key, { price, cachedAt: Date.now() })
}

export async function getBtc(): Promise<number> {
  const key = 'coingecko:bitcoin'
  const cached = getCached(key)
  if (cached !== null) return cached

  const response = await fetch(COINGECKO_BTC_PRICE_URL)
  if (!response.ok) {
    throw new Error(`CoinGecko BTC price fetch failed: HTTP ${response.status}`)
  }
  const data = (await response.json()) as CoinGeckoResponse
  const price = data.bitcoin?.usd
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid BTC price returned from CoinGecko: ${price}`)
  }
  setCached(key, price)
  return price
}

/**
 * Spot price for any token by its CoinGecko id (e.g. `'yield-basis'`).
 */
export async function getToken(coingeckoId: string): Promise<number> {
  const key = `coingecko:${coingeckoId}`
  const cached = getCached(key)
  if (cached !== null) return cached

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `CoinGecko price fetch failed for ${coingeckoId}: HTTP ${response.status}`,
    )
  }
  const data = (await response.json()) as Record<string, { usd?: number }>
  const price = data[coingeckoId]?.usd
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error(
      `Invalid price returned from CoinGecko for ${coingeckoId}: ${price}`,
    )
  }
  setCached(key, price)
  return price
}
