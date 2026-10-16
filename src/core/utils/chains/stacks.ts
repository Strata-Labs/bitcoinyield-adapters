/**
 * Stacks chain helper.
 *
 * Wraps Hiro's REST API + @stacks/transactions for read-only contract calls.
 * Used by Bitcoin yield products built on Stacks (Zest, Stacks dual-stacking,
 * sBTC-related protocols).
 */

import {
  ClarityType,
  cvToHex,
  cvToValue,
  fetchCallReadOnlyFunction,
  hexToCV,
} from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";
import { get, post } from "../http.js";

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
  if (!tokens) {
    // The balances endpoint always includes this object (empty when the
    // address holds nothing) — its absence means the API shape changed.
    throw new Error(
      `Hiro balances response for ${address} has no fungible_tokens field`,
    );
  }

  // Hiro returns the token id as either the full "addr.contract::asset" form or
  // the short "addr.contract" form depending on version. Match both.
  const shortId = tokenId.split("::")[0];
  for (const [key, entry] of Object.entries(tokens)) {
    if (key === tokenId || key === shortId) {
      const n = Number(entry.balance);
      if (!Number.isFinite(n)) {
        throw new Error(
          `Hiro returned non-numeric balance for ${tokenId} at ${address}: ${entry.balance}`,
        );
      }
      return n;
    }
  }
  // A missing key is a genuine zero balance — Hiro omits tokens the address
  // doesn't hold.
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
  /**
   * Index block hash to evaluate the call at (see `getBlock`). Omit for the
   * chain tip. Pinning every read of a run to one block keeps them atomic.
   */
  tip?: string;
}): Promise<unknown> {
  const [contractAddress, contractName] = input.contract.split(".") as [
    string,
    string,
  ];
  if (!contractAddress || !contractName) {
    throw new Error(`Invalid contract identifier: ${input.contract}`);
  }

  if (input.tip) {
    // @stacks/transactions can't pass `tip`, so call the node endpoint directly.
    const tip = input.tip.replace(/^0x/, "");
    const res = await post<{ okay: boolean; result?: string; cause?: string }>(
      `${getHiroBase()}/v2/contracts/call-read/${contractAddress}/${contractName}/` +
        `${encodeURIComponent(input.functionName)}?tip=${tip}`,
      {
        sender: input.senderAddress ?? contractAddress,
        arguments: (input.args ?? []).map((arg) => cvToHex(arg)),
      },
    );
    if (!res.okay || !res.result) {
      throw new Error(
        `Read-only ${input.contract}.${input.functionName} at tip ${tip} failed: ` +
          `${res.cause ?? "no result"}`,
      );
    }
    const cv = hexToCV(res.result);
    // cvToValue unwraps (err x) to x, which would pass an error code off as data.
    if (cv.type === ClarityType.ResponseErr) {
      throw new Error(
        `Read-only ${input.contract}.${input.functionName} at tip ${tip} returned err`,
      );
    }
    return cvToValue(cv);
  }

  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: input.functionName,
    // Honor the same base-URL override the REST helpers use — otherwise a
    // dedicated Hiro endpoint in production only reroutes balance reads.
    network: {
      ...STACKS_MAINNET,
      client: { ...STACKS_MAINNET.client, baseUrl: getHiroBase() },
    },
    functionArgs: input.args ?? [],
    senderAddress: input.senderAddress ?? contractAddress,
  });

  return cvToValue(result);
}

export interface StacksBlock {
  height: number;
  /** Unix seconds. */
  time: number;
  /** Pass as `tip` to `callReadOnly` to read state as of this block. */
  indexBlockHash: string;
}

export async function getBlock(
  height: number | "latest",
): Promise<StacksBlock> {
  const raw = await get<{
    height?: number;
    block_time?: number;
    index_block_hash?: string;
  }>(`${getHiroBase()}/extended/v2/blocks/${height}`);
  if (
    !Number.isSafeInteger(raw.height) ||
    !Number.isSafeInteger(raw.block_time) ||
    typeof raw.index_block_hash !== "string"
  ) {
    throw new Error(`Hiro returned a malformed Stacks block for ${height}`);
  }
  return {
    height: raw.height!,
    time: raw.block_time!,
    indexBlockHash: raw.index_block_hash,
  };
}

/**
 * The last Stacks block at or before `targetTime` (unix seconds) — the
 * baseline for a trailing-window read. Interpolation steps alternate with
 * bisection: block times are irregular (fast blocks inside ~10min tenures),
 * so interpolation alone can stall.
 */
export async function findBlockAtTime(
  targetTime: number,
  latest?: StacksBlock,
): Promise<StacksBlock> {
  let high = latest ?? (await getBlock("latest"));
  if (high.time <= targetTime) return high;

  let span = 500_000;
  let low = await getBlock(Math.max(1, high.height - span));
  while (low.time > targetTime) {
    if (low.height === 1) {
      throw new Error(`No Stacks block at or before ${targetTime}`);
    }
    high = low;
    span *= 2;
    low = await getBlock(Math.max(1, high.height - span));
  }

  for (let i = 0; high.height - low.height > 1; i++) {
    if (i >= 64) throw new Error("Stacks block search did not converge");
    const interpolated =
      low.height +
      Math.round(
        ((targetTime - low.time) * (high.height - low.height)) /
          Math.max(1, high.time - low.time),
      );
    const guess =
      i % 2 === 0 ? interpolated : Math.floor((low.height + high.height) / 2);
    const mid = await getBlock(
      Math.min(high.height - 1, Math.max(low.height + 1, guess)),
    );
    if (mid.time <= targetTime) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Override the Hiro base URL (mainly for tests).
 */
export function _setHiroBase(url: string | null): void {
  hiroOverride = url;
}
