import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Cl, cvToHex, type ClarityValue } from "@stacks/transactions";

import adapter from "../adapters/stackingdao-stbtc/index.js";
import * as stacks from "../src/core/utils/chains/stacks.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Irregular block times: 5s blocks plus a 10min gap every 100 blocks, the
// shape of Nakamoto tenures that stalls a pure interpolation search.
const LATEST = 1_200_000;
const T0 = 1_700_000_000;
const timeAt = (h: number) => T0 + h * 5 + Math.floor(h / 100) * 600;
const hashAt = (h: number) => `0x${h.toString(16).padStart(64, "0")}`;

type Reads = Record<string, (height: number) => ClarityValue | { okay: false }>;

/** Serves Hiro block lookups and tip-pinned read-only calls. */
function stubHiro(reads: Reads = {}) {
  const calls = { blocks: 0, reads: [] as string[] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const block = /^\/extended\/v2\/blocks\/(\w+)$/.exec(url.pathname);
    if (block) {
      calls.blocks++;
      const height = block[1] === "latest" ? LATEST : Number(block[1]);
      return Response.json({
        height,
        block_time: timeAt(height),
        index_block_hash: hashAt(height),
      });
    }
    const read = /^\/v2\/contracts\/call-read\/\w+\/([\w-]+)\/([\w-]+)$/.exec(
      url.pathname,
    );
    if (read) {
      const key = `${read[1]}.${read[2]}`;
      calls.reads.push(key);
      const height = parseInt(url.searchParams.get("tip")!, 16);
      const value = reads[key]?.(height);
      if (!value) throw new Error(`unexpected read: ${key}`);
      if ("okay" in value) return Response.json({ okay: false, cause: "boom" });
      return Response.json({ okay: true, result: cvToHex(value) });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return calls;
}

test("findBlockAtTime returns the last block at or before the target", async () => {
  const calls = stubHiro();
  for (const target of [
    timeAt(950_000),
    timeAt(950_000) + 4,
    timeAt(4_321) + 1,
  ]) {
    const block = await stacks.findBlockAtTime(target);
    assert.ok(block.time <= target);
    assert.ok(timeAt(block.height + 1) > target);
    assert.equal(block.indexBlockHash, hashAt(block.height));
  }
  // Interpolation alone would need hundreds of steps on this chain.
  assert.ok(calls.blocks < 3 * 60, `${calls.blocks} block reads`);
});

test("callReadOnly at a tip decodes ok values and refuses err", async () => {
  stubHiro({
    "c.plain": () => Cl.uint(7),
    "c.ok": () => Cl.ok(Cl.uint(8)),
    "c.err": () => Cl.error(Cl.uint(1)),
    "c.failed": () => ({ okay: false }),
  });
  const read = (functionName: string) =>
    stacks.callReadOnly({ contract: "SP000.c", functionName, tip: hashAt(5) });
  assert.equal(await read("plain"), 7n);
  assert.deepEqual(await read("ok"), { type: "uint", value: "8" });
  await assert.rejects(read("err"), /returned err/);
  await assert.rejects(read("failed"), /boom/);
});

const stbtc = (overrides: Reads = {}): Reads => ({
  "stbtc-reserve.get-total-sbtc": () => Cl.uint(63_801_957_718n),
  // 1.00253139 now, 1.00117350 at the baseline (the Oct 16 mainnet pair).
  "data-stbtc-v1.get-sbtc-per-stbtc": (h) =>
    Cl.uint(h === LATEST ? 100_253_139n : 100_117_350n),
  "stbtc-token.get-total-supply": () => Cl.ok(Cl.uint(15_249_795_699n)),
  ...overrides,
});

test("annualizes 30d ratio growth from block-pinned reads", async () => {
  const calls = stubHiro(stbtc());
  const [row] = await adapter.fetch({ env: {} });
  assert.equal(row!.rateType, "apy");
  assert.equal(row!.tvlBtc, 638.01957718);
  const windowDays = row!.metadata!.windowDays as number;
  assert.ok(windowDays >= 30 && windowDays < 30.01);
  const expected =
    (Math.pow(100_253_139 / 100_117_350, 365 / windowDays) - 1) * 100;
  assert.ok(Math.abs(row!.rate - expected) < 1e-9);
  assert.ok(Math.abs(row!.rate - 1.6627) < 0.001);
  assert.equal(calls.reads.length, 4);
});

test("publishes a losing window negative", async () => {
  stubHiro(
    stbtc({
      "data-stbtc-v1.get-sbtc-per-stbtc": (h) =>
        Cl.uint(h === LATEST ? 100_000_000n : 100_100_000n),
    }),
  );
  const [row] = await adapter.fetch({ env: {} });
  assert.ok(row!.rate < 0);
});

test("rejects a baseline from before stBTC existed", async () => {
  stubHiro(
    stbtc({
      "data-stbtc-v1.get-sbtc-per-stbtc": (h) =>
        Cl.uint(h === LATEST ? 100_253_139n : 100_000_000n),
      "stbtc-token.get-total-supply": () => Cl.ok(Cl.uint(0)),
    }),
  );
  await assert.rejects(adapter.fetch({ env: {} }), /get-total-supply@baseline/);
});
