/**
 * Babylon adapter — Bitcoin staking protocol.
 *
 * TVL: `total_active_tvl` from staking-api.babylonlabs.io (in satoshis).
 * APR: `btc_staking_apr` (decimal rate, scaled to percent).
 *
 * Metadata captures staking-class signals that aren't universal across all
 * adapters but are useful on Babylon's protocol detail page:
 *   - maxAprPercent: theoretical ceiling vs current rate (utilization headroom)
 *   - activeFinalityProviders / totalFinalityProviders: validator set health
 *   - activeDelegations: number of current stakers (the "holders" equivalent
 *     for a non-tokenized staking position)
 *   - pendingTvlBtc: BTC in flight (total_active_tvl - active_tvl); noisy
 *     inflow signal but cheap to derive.
 */

import { defineAdapter, http, math, requirePositive } from '@bitcoinyield/adapters'

const BABYLON_API = 'https://staking-api.babylonlabs.io/v2/stats'

interface BabylonResponse {
  data: {
    active_tvl: number
    total_active_tvl: number
    btc_staking_apr: number
    max_staking_apr: number
    active_finality_providers: number
    total_finality_providers: number
    active_delegations: number
  }
}

export default defineAdapter({
  slug: 'babylon',
  name: 'Babylon',
  url: 'https://babylonlabs.io',
  category: 'staking',
  custody: 'self',

  async fetch() {
    const response = await http.get<BabylonResponse>(BABYLON_API, {
      headers: { Accept: 'application/json' },
    })

    if (!response.data) throw new Error('Invalid Babylon API response: missing data')

    const tvlSatoshis = requirePositive(response.data.total_active_tvl, 'total_active_tvl')
    const rawApr = requirePositive(response.data.btc_staking_apr, 'btc_staking_apr')

    // Pending = total minus currently-active. Can be 0 or small; never negative
    // in healthy state. Clamp to 0 for defensive cosmetics if the API drifts.
    const pendingSatoshis = Math.max(
      0,
      response.data.total_active_tvl - response.data.active_tvl,
    )

    return [
      {
        symbol: 'BTC',
        tvlBtc: math.fromUnits(tvlSatoshis, 8),
        apr: math.toPercent(rawApr),
        metadata: {
          // Theoretical APR ceiling. Often much higher than the live `apr`
          // when utilization is low — explains "why is current yield small?"
          maxAprPercent: math.toPercent(response.data.max_staking_apr),
          // Validator-set health. 46 of 131 active = "fraction of registered
          // FPs actually producing." A decentralization signal users compare
          // across staking protocols.
          activeFinalityProviders: response.data.active_finality_providers,
          totalFinalityProviders: response.data.total_finality_providers,
          // Number of current stakers. Babylon doesn't tokenize positions, so
          // this is the only available "how many users" count.
          activeDelegations: response.data.active_delegations,
          // BTC currently in flight (queued / undelegating). Net flow signal.
          pendingTvlBtc: math.fromUnits(pendingSatoshis, 8),
        },
      },
    ]
  },
})
