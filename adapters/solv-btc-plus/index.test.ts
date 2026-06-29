import assert from "node:assert/strict";
import test from "node:test";

const adapterModule = (await import("./index.js")) as Record<string, unknown>;

test("annualizes BTC+ NAV growth over a rolling seven-day window", () => {
  assert.equal(typeof adapterModule.calculateNavApy, "function");

  const calculateNavApy = adapterModule.calculateNavApy as (input: {
    currentNavRaw: bigint;
    previousNavRaw: bigint;
    elapsedSeconds: number;
  }) => number;

  const apy = calculateNavApy({
    currentNavRaw: 1_020_196_119_839_896_600n,
    previousNavRaw: 1_019_574_231_961_736_000n,
    elapsedSeconds: 7 * 86_400,
  });

  assert.ok(Math.abs(apy - 3.2306) < 0.0001);
});

test("annualizes BTC+ NAV growth over a rolling thirty-day window", () => {
  assert.equal(typeof adapterModule.calculateNavApy, "function");

  const calculateNavApy = adapterModule.calculateNavApy as (input: {
    currentNavRaw: bigint;
    previousNavRaw: bigint;
    elapsedSeconds: number;
  }) => number;

  const apy = calculateNavApy({
    currentNavRaw: 1_020_196_119_839_896_600n,
    previousNavRaw: 1_017_660_941_291_573_000n,
    elapsedSeconds: 30 * 86_400,
  });

  assert.ok(Math.abs(apy - 3.0735) < 0.0001);
});

test("converts BTC+ token supply and NAV into underlying BTC TVL", () => {
  assert.equal(typeof adapterModule.calculateUnderlyingBtc, "function");

  const calculateUnderlyingBtc =
    adapterModule.calculateUnderlyingBtc as (input: {
      totalSupplyRaw: bigint;
      tokenDecimals: number;
      navRaw: bigint;
      navDecimals: number;
    }) => number;

  const tvlBtc = calculateUnderlyingBtc({
    totalSupplyRaw: 47_056_067_614_105_193_101n,
    tokenDecimals: 18,
    navRaw: 1_020_196_119_839_896_600n,
    navDecimals: 18,
  });

  assert.ok(Math.abs(tvlBtc - 48.006417594834) < 0.000000000001);
});

test("uses thirty-day NAV APY as the headline rate while retaining seven-day APY", () => {
  assert.equal(typeof adapterModule.aggregateSnapshots, "function");

  const aggregateSnapshots = adapterModule.aggregateSnapshots as (
    snapshots: Array<{
      tvlBtc: number;
      apy7d: number;
      apy30d: number;
      navTime: number;
      isFresh: boolean;
    }>,
  ) => {
    tvlBtc: number;
    apy7d: number;
    apy30d: number;
    freshTvlBtc: number;
  };

  const result = aggregateSnapshots([
    {
      tvlBtc: 48,
      apy7d: 3.23,
      apy30d: 3.07,
      navTime: 1_782_691_200,
      isFresh: true,
    },
    {
      tvlBtc: 158,
      apy7d: 3.23,
      apy30d: 3.07,
      navTime: 1_782_691_200,
      isFresh: true,
    },
    {
      tvlBtc: 0.7,
      apy7d: 0,
      apy30d: 0,
      navTime: 1_770_681_600,
      isFresh: false,
    },
  ]);

  assert.equal(result.tvlBtc, 206.7);
  assert.equal(result.freshTvlBtc, 206);
  assert.equal(result.apy7d, 3.23);
  assert.equal(result.apy30d, 3.07);
});
