/**
 * Stacks chain helper.
 *
 * Wraps Hiro's REST API + @stacks/transactions for read-only contract calls.
 * Used by Bitcoin yield products built on Stacks (Zest, Stacks dual-stacking,
 * sBTC-related protocols).
 */

import { fetchCallReadOnlyFunction, cvToValue } from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";
import { get } from "../http.js";

const HIRO_API = "https://api.hiro.so";

let hiroOverride: string | null = null;

function getHiroBase(): string {
  if (hiroOverride) return hiroOverride;
  return process.env.BITCOINYIELD_STACKS_API ?? HIRO_API;
}

/**
 * Get the fungible token balance held by an address.
 *
 * @param address - Stacks address (e.g., "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-vault")
 * @param tokenId - Full token identifier (e.g., "SM3VDXK3...sbtc-token::sbtc-token")
 * @returns Raw balance as a number (still in the token's smallest unit; use math.fromUnits to scale)
 *
 * @example
 *   const sats = await stacks.getFungibleTokenBalance({
 *     address: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-vault',
 *     tokenId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
 *   })
 *   const btc = math.fromUnits(sats, 8)
 */
export async function getFungibleTokenBalance(args: {
  address: string;
  tokenId: string;
}): Promise<number> {
  const { address, tokenId } = args;
  const url = `${getHiroBase()}/extended/v1/address/${address}/balances`;

  const data = await get<{
    fungible_tokens?: Record<string, { balance: string }>;
  }>(url);

  const tokens = data.fungible_tokens;
  if (!tokens) return 0;

  // Hiro returns the token id as either the full "addr.contract::asset" form or
  // the short "addr.contract" form depending on version. Match both.
  const shortId = tokenId.split("::")[0];
  for (const [key, entry] of Object.entries(tokens)) {
    if (key === tokenId || key === shortId) {
      const n = Number(entry.balance);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

/**
 * Call a read-only function on a Clarity contract.
 *
 * @param contract - "ADDRESS.CONTRACT-NAME" (e.g., "SP2VCQ...8ADJ7.v0-rates")
 * @param functionName - The function name in the contract (e.g., "get-rates-sbtc")
 * @param args - Arguments to pass (raw Clarity values; usually empty for view functions)
 * @returns Decoded Clarity value (use type-narrowing helpers to extract scalars)
 */
export async function callReadOnly(input: {
  contract: string;
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any[];
  /** The address that "sends" the call. Defaults to the contract's deployer. */
  senderAddress?: string;
}): Promise<unknown> {
  const [contractAddress, contractName] = input.contract.split(".") as [
    string,
    string,
  ];
  if (!contractAddress || !contractName) {
    throw new Error(`Invalid contract identifier: ${input.contract}`);
  }

  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: input.functionName,
    network: STACKS_MAINNET,
    functionArgs: input.args ?? [],
    senderAddress: input.senderAddress ?? contractAddress,
  });

  return cvToValue(result);
}

/**
 * Override the Hiro base URL (mainly for tests).
 */
export function _setHiroBase(url: string | null): void {
  hiroOverride = url;
}
