/**
 * Reads a share-price view function at the latest block AND at
 * `latest - blocksBack`, then annualizes the delta into APR/APY.
 *
 * The two-block read avoids the per-cycle noise of comparing to last cycle:
 * a 1-hour window can imply absurd annualized numbers from a single fee
 * accrual event. A 30d window via block-tag is stable from day one with no
 * warmup or DB history.
 *
 * Requires archive RPC support at the requested depth.
 */

import type { Abi, Address, PublicClient } from "viem";

const SECONDS_PER_DAY = 86_400;

export interface ShareGrowthOptions {
  client: PublicClient;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** ~216_000n for Ethereum (~30d), ~518_400n for Botanix. Approximate; exact elapsed days come from block timestamps. */
  blocksBack: bigint;
  /** Divisor for the raw uint256 — typically 18 for ERC-4626 share prices. */
  decimals: number;
}

export interface ShareGrowthResult {
  sharePriceNow: number;
  /** `null` when the historical read failed. */
  sharePriceThen: number | null;
  elapsedDays: number;
  /** Linear annualization, percent. 0 when no baseline. */
  apr: number;
  /** Compounded annualization, percent. 0 when no baseline. */
  apy: number;
  hasBaseline: boolean;
}

/**
 * Fail-soft: if the historical read throws, `sharePriceNow` is still
 * returned and `apr`/`apy` are `0`. Adapter can persist sharePrice anyway
 * and the next cycle likely succeeds.
 */
export async function readShareGrowth(
  opts: ShareGrowthOptions,
): Promise<ShareGrowthResult> {
  const { client, address, abi, functionName, args, blocksBack, decimals } =
    opts;
  const divisor = 10 ** decimals;

  const latestBlock = await client.getBlock({ blockTag: "latest" });
  const rawNow = (await client.readContract({
    address,
    abi,
    functionName,
    args,
    blockNumber: latestBlock.number,
  })) as bigint;
  const sharePriceNow = Number(rawNow) / divisor;

  const historicalBlockNumber = latestBlock.number - blocksBack;
  try {
    const [rawThen, historicalBlock] = await Promise.all([
      client.readContract({
        address,
        abi,
        functionName,
        args,
        blockNumber: historicalBlockNumber,
      }) as Promise<bigint>,
      client.getBlock({ blockNumber: historicalBlockNumber }),
    ]);

    const sharePriceThen = Number(rawThen) / divisor;
    if (sharePriceThen <= 0) {
      return {
        sharePriceNow,
        sharePriceThen: null,
        elapsedDays: 0,
        apr: 0,
        apy: 0,
        hasBaseline: false,
      };
    }

    const elapsedSeconds = Number(
      latestBlock.timestamp - historicalBlock.timestamp,
    );
    const elapsedDays = elapsedSeconds / SECONDS_PER_DAY;
    if (elapsedDays < 0.01) {
      return {
        sharePriceNow,
        sharePriceThen,
        elapsedDays,
        apr: 0,
        apy: 0,
        hasBaseline: false,
      };
    }

    const growth = sharePriceNow / sharePriceThen;
    const apr = (growth - 1) * (365 / elapsedDays) * 100;
    const apy = (Math.pow(growth, 365 / elapsedDays) - 1) * 100;

    return {
      sharePriceNow,
      sharePriceThen,
      elapsedDays,
      apr,
      apy,
      hasBaseline: true,
    };
  } catch (err) {
    // Usually a non-archive RPC that can't serve state at this depth.
    // eslint-disable-next-line no-console
    console.warn(
      `[readShareGrowth] historical read failed for ${address}.${functionName} ` +
        `at block ${historicalBlockNumber} (likely non-archive RPC): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      sharePriceNow,
      sharePriceThen: null,
      elapsedDays: 0,
      apr: 0,
      apy: 0,
      hasBaseline: false,
    };
  }
}

export const BLOCKS_PER_30D = {
  ethereum: 216_000n,
  botanix: 518_400n,
} as const;
