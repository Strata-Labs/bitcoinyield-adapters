/**
 * Reads a share-price view function at the latest block AND at the block
 * `windowDays` ago, then annualizes the delta into APR/APY.
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
// A baseline this close to the target time is good enough: elapsed days
// come from the two block timestamps, not the target.
const BASELINE_TOLERANCE_SECONDS = 600n;

export interface ShareGrowthOptions {
  client: PublicClient;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /**
   * Trailing window. The baseline block is found by timestamp, not a block
   * count: Base went from 2s to 200ms blocks on 2026-11-05, which shrank a
   * fixed 30d block count to 3 days and annualized it into a 110% APY.
   */
  windowDays: number;
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
  const { client, address, abi, functionName, args, windowDays, decimals } =
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

  const historicalBlock = await findBlockAtTime(
    client,
    latestBlock.timestamp - BigInt(Math.round(windowDays * SECONDS_PER_DAY)),
    latestBlock,
  );
  const historicalBlockNumber = historicalBlock.number;
  try {
    const rawThen = (await client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber: historicalBlockNumber,
    })) as bigint;

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

interface BlockRef {
  number: bigint;
  /** Unix seconds. */
  timestamp: bigint;
}

async function readBlock(
  client: Pick<PublicClient, "getBlock">,
  blockNumber: bigint,
): Promise<BlockRef> {
  const block = await client.getBlock({ blockNumber });
  return { number: block.number, timestamp: block.timestamp };
}

/**
 * A block within BASELINE_TOLERANCE_SECONDS of `targetTime`, or failing
 * that the last block at or before it. Seeds from the recent block rate,
 * widens until the target is bracketed, then alternates interpolation with
 * bisection: interpolation alone stalls when block time changed inside the
 * bracket (Base's 2s -> 200ms switch).
 */
export async function findBlockAtTime(
  client: Pick<PublicClient, "getBlock">,
  targetTime: bigint,
  latest: BlockRef,
): Promise<BlockRef> {
  const near = (b: BlockRef) => {
    const diff = b.timestamp - targetTime;
    return (diff < 0n ? -diff : diff) <= BASELINE_TOLERANCE_SECONDS;
  };
  if (latest.timestamp <= targetTime) return latest;

  const probe = await readBlock(
    client,
    latest.number > 1000n ? latest.number - 1000n : 0n,
  );
  const probeSeconds = latest.timestamp - probe.timestamp;
  let span =
    probeSeconds > 0n
      ? ((latest.timestamp - targetTime) * (latest.number - probe.number)) /
        probeSeconds
      : 1000n;
  let high = latest;
  let low = await readBlock(
    client,
    latest.number > span ? latest.number - span : 0n,
  );
  while (low.timestamp > targetTime) {
    if (low.number === 0n) {
      throw new Error(`No block at or before ${targetTime}`);
    }
    high = low;
    span *= 2n;
    low = await readBlock(client, high.number > span ? high.number - span : 0n);
  }
  if (near(low)) return low;

  for (let i = 0; high.number - low.number > 1n; i++) {
    if (i >= 64) throw new Error("Block search did not converge");
    const timeSpan = high.timestamp - low.timestamp;
    const interpolated =
      low.number +
      ((targetTime - low.timestamp) * (high.number - low.number)) /
        (timeSpan > 0n ? timeSpan : 1n);
    let guess = i % 2 === 0 ? interpolated : (low.number + high.number) / 2n;
    if (guess <= low.number) guess = low.number + 1n;
    if (guess >= high.number) guess = high.number - 1n;
    const mid = await readBlock(client, guess);
    if (near(mid)) return mid;
    if (mid.timestamp <= targetTime) low = mid;
    else high = mid;
  }
  return low;
}
