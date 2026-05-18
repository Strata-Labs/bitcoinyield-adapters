/**
 * Helpers for reading sBTC balances out of Zest's vault contracts.
 */

import { stacks, math } from '@bitcoinyield/adapters'
import { SBTC_TOKEN_ID, VAULT_ADDRESSES } from './constants.js'

/**
 * Returns the total sBTC held across all Zest vaults, in BTC units.
 */
export async function getTotalSbtcBtc(): Promise<number> {
  const balances = await Promise.all(
    VAULT_ADDRESSES.map((address) =>
      stacks.getFungibleTokenBalance({ address, tokenId: SBTC_TOKEN_ID }),
    ),
  )
  const totalSats = math.add(...balances)
  return math.fromUnits(totalSats, 8)
}
