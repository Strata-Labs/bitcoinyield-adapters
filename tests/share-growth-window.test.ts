import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicClient } from "viem";

import { findBlockAtTime, readShareGrowth } from "../src/core/utils/yield.js";

const T0 = 1_700_000_000n;
const DAY = 86_400n;

/** Serves block headers from a timestamp function and counts the reads. */
function stubChain(latest: bigint, timeAt: (n: bigint) => bigint) {
  const calls = { blocks: 0 };
  const client = {
    async getBlock(args: { blockNumber?: bigint; blockTag?: string }) {
      calls.blocks++;
      const number = args.blockTag === "latest" ? latest : args.blockNumber!;
      if (number < 0n || number > latest) throw new Error(`no block ${number}`);
      return { number, timestamp: timeAt(number) };
    },
  } as unknown as PublicClient;
  return { client, calls };
}

// Base's shape: 2s blocks, then 200ms blocks (five per timestamp second)
// for the last 4 days.
const SWITCH = 40_000_000n;
const baseTime = (n: bigint) =>
  n <= SWITCH ? T0 + n * 2n : T0 + SWITCH * 2n + (n - SWITCH) / 5n;
const BASE_LATEST = SWITCH + 4n * DAY * 5n;

test("finds the 30d baseline across a 2s -> 200ms block-time switch", async () => {
  const { client, calls } = stubChain(BASE_LATEST, baseTime);
  const latest = { number: BASE_LATEST, timestamp: baseTime(BASE_LATEST) };
  const target = latest.timestamp - 30n * DAY;

  const block = await findBlockAtTime(client, target, latest);

  const off = block.timestamp - target;
  assert.ok((off < 0n ? -off : off) <= 600n, `baseline ${off}s from target`);
  assert.ok(calls.blocks <= 40, `${calls.blocks} header reads`);
  // The old fixed count (1_296_000 blocks at an assumed 2s) lands 3 days back.
  assert.equal(latest.timestamp - baseTime(BASE_LATEST - 1_296_000n), 3n * DAY);
});

test("a steady block time resolves in a few header reads", async () => {
  const latestNumber = 24_000_000n;
  const timeAt = (n: bigint) => T0 + n * 12n;
  const { client, calls } = stubChain(latestNumber, timeAt);
  const latest = { number: latestNumber, timestamp: timeAt(latestNumber) };

  const block = await findBlockAtTime(
    client,
    latest.timestamp - 7n * DAY,
    latest,
  );

  assert.equal(latest.timestamp - block.timestamp, 7n * DAY);
  assert.ok(calls.blocks <= 3, `${calls.blocks} header reads`);
});

test("a target before genesis throws", async () => {
  const timeAt = (n: bigint) => T0 + n * 2n;
  const { client } = stubChain(1_000n, timeAt);
  const latest = { number: 1_000n, timestamp: timeAt(1_000n) };

  await assert.rejects(
    findBlockAtTime(client, T0 - DAY, latest),
    /No block at or before/,
  );
});

test("readShareGrowth annualizes over the real 30d window after the switch", async () => {
  const { client } = stubChain(BASE_LATEST, baseTime);
  const nowTs = baseTime(BASE_LATEST);
  // Share price grows 0.6% over the final 3 days and is flat before that:
  // a 3-day window would annualize this to ~107%, the real 30d to ~7.6%.
  const priceAt = (n: bigint) =>
    nowTs - baseTime(n) <= 3n * DAY ? 100_600_000n : 100_000_000n;
  const stub = {
    getBlock: client.getBlock,
    async readContract(args: { blockNumber: bigint }) {
      return priceAt(args.blockNumber);
    },
  } as unknown as PublicClient;

  const growth = await readShareGrowth({
    client: stub,
    address: "0x0000000000000000000000000000000000000001",
    abi: [],
    functionName: "convertToAssets",
    windowDays: 30,
    decimals: 8,
  });

  assert.ok(growth.hasBaseline);
  assert.ok(Math.abs(growth.elapsedDays - 30) < 0.01, `${growth.elapsedDays}d`);
  assert.ok(growth.apy > 7 && growth.apy < 8.5, `apy ${growth.apy}`);
});
