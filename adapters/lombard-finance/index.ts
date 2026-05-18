/**
 * Lombard Finance adapter.
 *
 * TVL: read directly from the LBTC ERC-20 totalSupply on Ethereum mainnet
 *      (authoritative; beats DefiLlama's cached aggregate).
 * APR: Lombard's own analytics endpoint.
 */

import { defineAdapter, ethereum, http, math } from '@bitcoinyield/adapters'

const LBTC_ADDRESS = '0x8236a87084f8B84306f72007F36F2618A5634494' as const
const LOMBARD_APY_URL =
  'https://mainnet.prod.lombard.finance/api/v1/analytics/estimated-apy'

interface LombardApyResponse {
  lbtc_estimated_apy: number
}

export default defineAdapter({
  slug: 'lombard-finance',
  name: 'Lombard',
  url: 'https://www.lombard.finance/app/stake/',
  category: 'yield-bearing',
  custody: 'multisig',
  requires: { rpc: ['ethereum'] },

  async fetch() {
    const [calls, apyData] = await Promise.all([
      ethereum.multicall([
        { address: LBTC_ADDRESS, abi: ethereum.erc20Abi, functionName: 'totalSupply' },
        { address: LBTC_ADDRESS, abi: ethereum.erc20Abi, functionName: 'decimals' },
      ]),
      http.get<LombardApyResponse>(LOMBARD_APY_URL),
    ])

    const supply = calls[0]
    const decimals = calls[1]
    if (supply?.status !== 'success' || decimals?.status !== 'success') {
      throw new Error(
        `LBTC multicall failed: supply=${supply?.status} decimals=${decimals?.status}`,
      )
    }

    return [
      {
        symbol: 'LBTC',
        tvlBtc: math.fromUnits(supply.result as bigint, decimals.result as number),
        apr: math.toPercent(apyData.lbtc_estimated_apy),
        metadata: { contractAddress: LBTC_ADDRESS, decimals: decimals.result },
      },
    ]
  },
})
