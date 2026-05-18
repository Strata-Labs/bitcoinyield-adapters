/**
 * Stacks Dual Stacking (Boosted) adapter.
 *
 * sBTC boosted-tier dual-stacking yield (DeFi-boosted via various Stacks
 * yield protocols). Uses DegenLab v3's next-cycle max DeFi APR — forward-
 * looking value, post-halving aware.
 */

import { defineAdapter, http, parseNumber, requireNumber } from '@bitcoinyield/adapters'

const ENDPOINT =
  'https://dual-stacking-v3-server.degenlab.io/dual-stacking-server/last-cycle-aprs'

interface ApyResponse {
  cycle_id?: string
  base_apr?: string
  max_defi_apr?: string
  stacking_apr?: string
  boosted_tvl?: string
  boosted_sbtc?: string
  next_cycle_max_defi_apr?: string
}

export default defineAdapter({
  slug: 'stacks-dual-stacking-boosted',
  name: 'Stacks Dual Stacking (Boosted)',
  url: 'https://stx.eco/dual-stack',
  category: 'staking',
  custody: 'self',

  async fetch() {
    const data = await http.get<ApyResponse>(ENDPOINT)
    if (!data?.next_cycle_max_defi_apr) {
      throw new Error('Invalid DegenLab response: missing next_cycle_max_defi_apr')
    }

    const apr = requireNumber(data.next_cycle_max_defi_apr, 'next_cycle_max_defi_apr')
    const tvlBtc = parseNumber(data.boosted_sbtc, 0)
    const tvlUsd = parseNumber(data.boosted_tvl, 0)

    return [
      {
        symbol: 'sBTC',
        tvlBtc,
        ...(tvlUsd > 0 ? { tvlUsd } : {}),
        apr,
        metadata: {
          cycleId: data.cycle_id,
          baseApr: parseNumber(data.base_apr, 0),
          maxDefiApr: parseNumber(data.max_defi_apr, 0),
          stackingApr: parseNumber(data.stacking_apr, 0),
          nextCycleMaxDefiApr: apr,
        },
      },
    ]
  },
})
