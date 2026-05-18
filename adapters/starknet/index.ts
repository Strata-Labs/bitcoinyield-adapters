/**
 * Starknet adapter — BTC staking on Starknet via Voyager.
 *
 * Voyager occasionally returns zero values during cache-warmup or cycle-
 * transition windows; the requirePositive guards turn those into thrown
 * errors so the runner retries instead of silently saving apr=0.
 *
 * Requires VOYAGER_API_KEY (set BITCOINYIELD_VOYAGER_API_KEY in production).
 */

import { defineAdapter, http, math, requirePositive } from '@bitcoinyield/adapters'

const VOYAGER_API = 'https://api.voyager.online/beta/staking/overview'

interface VoyagerResponse {
  overview: {
    totalStakeBtc: string
    totalStakeStrk: string
    tokenInfoBtc: { price: number }
    tokenInfoStrk: { price: number }
    maxAPRBtc: number // basis points (466 = 4.66%)
    maxAPRStrk: number
  }
}

export default defineAdapter({
  slug: 'starknet',
  name: 'Starknet',
  url: 'https://www.starknet.io',
  category: 'staking',
  custody: 'self',
  requires: { secrets: ['VOYAGER_API_KEY'] },

  async fetch(ctx) {
    const apiKey = ctx.env.VOYAGER_API_KEY
    if (!apiKey) {
      throw new Error('VOYAGER_API_KEY required (set BITCOINYIELD_VOYAGER_API_KEY)')
    }

    const data = await http.get<VoyagerResponse>(VOYAGER_API, {
      headers: { 'x-api-key': apiKey },
    })

    if (!data.overview) {
      throw new Error('Voyager returned no overview field')
    }

    // Voyager occasionally ships zeros during cache warm-up; throw loud so
    // Inngest retries rather than persisting a bad row.
    const tvlBtc = requirePositive(
      parseFloat(data.overview.totalStakeBtc),
      'totalStakeBtc',
    )
    const btcPriceFromVoyager = requirePositive(
      data.overview.tokenInfoBtc?.price,
      'tokenInfoBtc.price',
    )
    const aprBps = requirePositive(data.overview.maxAPRBtc, 'maxAPRBtc')

    const apr = math.fromBps(aprBps)
    const tvlUsd = math.mul(tvlBtc, btcPriceFromVoyager)

    return [
      {
        symbol: 'BTC',
        tvlBtc,
        tvlUsd,
        apr,
        metadata: {
          maxAPRStrk: data.overview.maxAPRStrk,
          totalStakeStrk: data.overview.totalStakeStrk,
          voyagerBtcPrice: btcPriceFromVoyager,
        },
      },
    ]
  },
})
