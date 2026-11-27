import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  fetchMorphoWindow,
  MorphoDataError,
  VAULT_ADDRESS,
  WBTC_ADDRESS,
  ZAMA_ADDRESS,
} from "../adapters/wintermute-confidential-wbtc/morpho.js";
import { adapters } from "../src/adapters-registry.js";
import { runAdapter } from "../src/core/runAdapter.js";

const SLUG = "wintermute-confidential-wbtc";
const HOUR = 3600;
const HOURS = 720;
const END = Date.parse("2026-11-25T23:00:00Z") / 1000;
const START = END - HOURS * HOUR;
const OBSERVED_AT = END + HOUR + 15 * 60;
const OPEN_PRICE = 1.0015419848614056;
const CLOSE_PRICE = 1.0023011401140667;
const EXPECTED_NATIVE = 0.9261297948979452;
const EXPECTED_REWARD = 4.210530067661095;
const EXPECTED_TOTAL = 5.13665986255904;

type Point = { x: number; y: number | null };
type Reward = { asset: { address: string; symbol: string }; supplyApr: number };
const ZAMA_REWARD = {
  asset: { address: ZAMA_ADDRESS, symbol: "ZAMA" },
  supplyApr: 0.05,
};
const OTHER_REWARD = {
  asset: {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "OTHER",
  },
  supplyApr: 0.03,
};

function benchmarkVault(rewards: Reward[] | null = [ZAMA_REWARD]) {
  // Preserve the real endpoint prices and the 360-hour mean reward in
  // each half of the benchmark. The intervening hourly points are synthetic.
  const inclusiveOneHour: Point[] = [];
  const nativeOneHour: Point[] = [];
  for (let i = 0; i < HOURS; i++) {
    const x = START + i * HOUR;
    const native = i % 2 === 0 ? 0.01 : 0.015;
    const reward = i < 360 ? 0.03837696399837035 : 0.04583363735485155;
    inclusiveOneHour.push({ x, y: native + reward });
    nativeOneHour.push({ x, y: native });
  }
  // GraphQL includes the end timestamp. The next window's reward is
  // deliberately large so including it, or dropping the first hour, fails.
  inclusiveOneHour.push({ x: END, y: 0.8 });
  nativeOneHour.push({ x: END, y: 0.01 });
  return {
    address: VAULT_ADDRESS,
    chain: { id: 1 },
    asset: { address: WBTC_ADDRESS, decimals: 8, symbol: "WBTC" },
    totalAssets: "9178000000",
    netApy: 0.07,
    netApyExcludingRewards: 0.02,
    rewards,
    historicalState: {
      sharePrice: [
        { x: START, y: OPEN_PRICE },
        { x: END, y: CLOSE_PRICE },
      ],
      inclusiveOneHour,
      nativeOneHour,
    },
  };
}

function mockMorpho(t: TestContext, vault: ReturnType<typeof benchmarkVault>) {
  t.mock.method(Date, "now", () => OBSERVED_AT * 1000);
  return t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "https://api.morpho.org/graphql");
      assert.equal(init?.method, "POST");
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request.variables, { start: START, end: END });
      return Response.json({ data: { vaultV2ByAddress: vault } });
    },
  );
}

function close(actual: unknown, expected: number) {
  assert.equal(typeof actual, "number");
  assert.ok(
    Math.abs(Number(actual) - expected) < 1e-9,
    `expected ${expected}, got ${actual}`,
  );
}

test("registered hourly run reproduces the November 25 23:00 UTC inclusive benchmark", async (t) => {
  const calls = mockMorpho(t, benchmarkVault());
  const adapter = adapters[SLUG];
  assert.ok(adapter, "Wintermute vault must be present in the cron registry");
  const result = await runAdapter(adapter, {
    btcPrice: 60_000,
    dryRun: true,
    now: new Date(END * 1000),
  });
  assert.equal(result.inserted.length, 1);
  const row = result.inserted[0]!;
  assert.equal(row.symbol, "WBTC");
  assert.equal(row.rateType, "apy");
  close(row.rate, EXPECTED_TOTAL);
  close(row.tvlBtc, 91.78);
  close(row.tvlUsd, 5_506_800);
  assert.equal(row.timestamp.getTime(), END * 1000);
  assert.equal(row.metadata?.rateSource, "morpho-graphql");
  assert.equal(row.metadata?.windowStart, START);
  assert.equal(row.metadata?.windowEnd, END);
  assert.equal(row.metadata?.observedAt, OBSERVED_AT);
  assert.equal(row.metadata?.observedHours, HOURS);
  assert.equal(row.metadata?.expectedHours, HOURS);
  close(row.metadata?.nativeApyPct, EXPECTED_NATIVE);
  close(row.metadata?.rewardAprPct, EXPECTED_REWARD);
  close(row.metadata?.spotNativeApyPct, 2);
  close(row.metadata?.spotZamaAprPct, 5);
  close(row.metadata?.spotTotalApyPct, 7);
  assert.equal(calls.mock.callCount(), 1);
});

test("a missing paired hour fails the registered run without switching windows", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.nativeOneHour.splice(100, 1);
  const calls = mockMorpho(t, vault);
  const adapter = adapters[SLUG];
  assert.ok(adapter);
  await assert.rejects(
    runAdapter(adapter, {
      btcPrice: 60_000,
      dryRun: true,
      now: new Date(END * 1000),
    }),
    MorphoDataError,
  );
  assert.equal(calls.mock.callCount(), 1);
});

test("a null hourly rate is missing data", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.inclusiveOneHour[0]!.y = null;
  mockMorpho(t, vault);
  await assert.rejects(fetchMorphoWindow(END), MorphoDataError);
});

test("a duplicate hour is rejected even when the duplicate value matches", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.inclusiveOneHour.push(
    vault.historicalState.inclusiveOneHour[3]!,
  );
  mockMorpho(t, vault);
  await assert.rejects(fetchMorphoWindow(END), MorphoDataError);
});

test("missing closing share price prevents a trailing rate", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.sharePrice.pop();
  mockMorpho(t, vault);
  await assert.rejects(fetchMorphoWindow(END), MorphoDataError);
});

test("observed zero incentives preserve a loss in WBTC per share", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.sharePrice[1]!.y = OPEN_PRICE * 0.999;
  vault.historicalState.inclusiveOneHour = vault.historicalState.nativeOneHour;
  vault.rewards = [];
  mockMorpho(t, vault);
  const result = await fetchMorphoWindow(END);
  assert.equal(result.rewardAprPct, 0);
  assert.equal(result.spotZamaAprPct, 0);
  close(result.nativeApyPct, (0.999 ** (365 / 30) - 1) * 100);
  assert.equal(result.totalApyPct, result.nativeApyPct);
});

test("spot rewards from other tokens stay in the total without increasing the ZAMA APR", async (t) => {
  const vault = benchmarkVault([OTHER_REWARD, ZAMA_REWARD]);
  vault.netApy = 0.1;
  mockMorpho(t, vault);
  const result = await fetchMorphoWindow(END);
  close(result.spotTotalApyPct, 10);
  close(result.spotZamaAprPct, 5);
  close(result.totalApyPct, EXPECTED_TOTAL);
});

test("a successor token alone gives zero spot ZAMA while historical rewards remain", async (t) => {
  const vault = benchmarkVault([OTHER_REWARD]);
  vault.netApy = 0.05;
  mockMorpho(t, vault);
  const result = await fetchMorphoWindow(END);
  close(result.spotTotalApyPct, 5);
  assert.equal(result.spotZamaAprPct, 0);
  close(result.rewardAprPct, EXPECTED_REWARD);
});

test("an unavailable spot reward list preserves the observed 30-day rate", async (t) => {
  mockMorpho(t, benchmarkVault(null));
  const result = await fetchMorphoWindow(END);
  assert.equal(result.spotZamaAprPct, null);
  close(result.totalApyPct, EXPECTED_TOTAL);
});

test("an explicitly flat share-price window with no incentive is a valid zero", async (t) => {
  const vault = benchmarkVault();
  vault.historicalState.sharePrice[1]!.y = OPEN_PRICE;
  vault.historicalState.inclusiveOneHour = vault.historicalState.nativeOneHour;
  mockMorpho(t, vault);
  const adapter = adapters[SLUG];
  assert.ok(adapter);
  const result = await runAdapter(adapter, {
    btcPrice: 60_000,
    dryRun: true,
    now: new Date(END * 1000),
  });
  const row = result.inserted[0]!;
  assert.equal(row.rate, 0);
  assert.equal(row.metadata?.allowZeroRate, true);
});
