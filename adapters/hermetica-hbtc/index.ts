/**
 * Hermetica hBTC adapter.
 *
 * 7 parallel HTTP calls fetch APY (at 7d / 30d / 90d windows), TVL, hBTC
 * price, hBTC rate, and remaining capacity.
 *
 * The official endpoint surface is documented by Hermetica's published
 * `@hermetica/sdk` package. We call the endpoints directly (not via the SDK)
 * to avoid pulling axios as a transitive dep and to stay decoupled from the
 * SDK's release cadence. If Hermetica ever changes the endpoint shapes, the
 * SDK's TypeScript definitions are the canonical reference.
 */

import { defineAdapter, http, math, parseNumber } from '@bitcoinyield/adapters'

const HERMETICA = 'https://app.hermetica.fi'

export default defineAdapter({
  slug: 'hermetica-hbtc',
  name: 'Hermetica hBTC',
  url: 'https://app.hermetica.fi',
  category: 'yield-bearing',
  custody: 'multisig',

  async fetch() {
    const [
      apy7dData,
      apy30dData,
      apy90dData,
      tvlData,
      priceData,
      rateData,
      capacityData,
    ] = await Promise.all([
      http.get<{ apy: number | string }>(`${HERMETICA}/api/v2/info/apy/hbtc?range=7d`),
      http.get<{ apy: number | string }>(`${HERMETICA}/api/v2/info/apy/hbtc?range=30d`),
      http.get<{ apy: number | string }>(`${HERMETICA}/api/v2/info/apy/hbtc?range=90d`),
      http.get<{ tvl: number | string; tvl_btc: number | string }>(
        `${HERMETICA}/api/v2c/tvl/hbtc`,
      ),
      http.get<{ price: number | string }>(`${HERMETICA}/api/v2/hbtc/price`),
      http.get<{ rate: number | string }>(`${HERMETICA}/api/v2c/info/hbtc_rate`),
      http.get<{ vault_capacity: number | string }>(
        `${HERMETICA}/api/v2/hbtc/vault-capacity`,
      ),
    ])

    // 7d APY is the headline number — drives `apr`, matches what every other
    // adapter reports as the "current rate" on the homepage. 30d and 90d sit
    // in metadata for richer comparison on the protocol detail page.
    const apy7d = parseNumber(apy7dData.apy, 0)
    const apy30d = parseNumber(apy30dData.apy, 0)
    const apy90d = parseNumber(apy90dData.apy, 0)

    const tvlUsd = parseNumber(tvlData.tvl, 0)
    const tvlBtc = parseNumber(tvlData.tvl_btc, 0)
    const remainingCapacityBtc = parseNumber(capacityData.vault_capacity)

    return [
      {
        symbol: 'hBTC',
        tvlBtc,
        tvlUsd,
        apr: apy7d,
        metadata: {
          // Realized APYs over multiple windows. All from Hermetica's same
          // `/api/v2/info/apy/hbtc?range=…` endpoint with different params.
          apy7d,
          apy30d,
          apy90d,
          hbtcPrice: parseNumber(priceData.price),
          hbtcRate: parseNumber(rateData.rate),
          remainingCapacityBtc,
          maxCapacityBtc: remainingCapacityBtc
            ? math.add(tvlBtc, remainingCapacityBtc)
            : undefined,
        },
      },
    ]
  },
})
