/**
 * Helpers for reading sBTC balances out of Zest's vault contracts.
 */

import { stacks, math } from "@bitcoinyield/adapters";
import { SBTC_TOKEN_ID, VAULT_ADDRESSES } from "./constants.js";

/**
 * Returns the total sBTC held across all Zest vaults, in BTC units.
 */
export async function getTotalSbtcBtc(): Promise<number> {
  const balances = await Promise.all(
    VAULT_ADDRESSES.map((address) =>
      stacks.getFungibleTokenBalance({ address, tokenId: SBTC_TOKEN_ID }),
    ),
  );
  // A zero balance is either an emptied vault or a renamed asset identifier
  // silently matching nothing — surface it so a halved TVL doesn't pass
  // unnoticed (the total still counts the other vaults).
  balances.forEach((balance, i) => {
    if (balance === 0) {
      console.warn(
        `[zest-protocol] vault ${VAULT_ADDRESSES[i]} holds 0 sBTC — emptied, or token id changed?`,
      );
    }
  });
  const totalSats = math.add(...balances);
  return math.fromUnits(totalSats, 8);
}
