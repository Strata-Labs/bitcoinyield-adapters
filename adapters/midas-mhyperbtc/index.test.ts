import assert from "node:assert/strict";
import test from "node:test";

const adapterModule = (await import("./index.js")) as Record<string, unknown>;

test("converts mHyperBTC supply and NAV into underlying BTC TVL", () => {
  assert.equal(typeof adapterModule.calculateUnderlyingBtc, "function");

  const calculateUnderlyingBtc =
    adapterModule.calculateUnderlyingBtc as (input: {
      totalSupplyRaw: bigint;
      tokenDecimals: number;
      navRaw: bigint;
      navDecimals?: number;
    }) => number;

  const tvlBtc = calculateUnderlyingBtc({
    totalSupplyRaw: 287694588291968500000n,
    tokenDecimals: 18,
    navRaw: 1000000000000000000n,
  });

  assert.ok(Math.abs(tvlBtc - 287.6945882919685) < 1e-12);
});

test("annualizes NAV growth over a seven-day window", () => {
  assert.equal(typeof adapterModule.calculateNavApy, "function");

  const calculateNavApy = adapterModule.calculateNavApy as (input: {
    currentNav: number;
    previousNav: number;
    elapsedDays: number;
  }) => number;

  const apy = calculateNavApy({
    currentNav: 1.000392,
    previousNav: 1,
    elapsedDays: 7,
  });

  const expected = (Math.pow(1.000392, 365 / 7) - 1) * 100;
  assert.ok(Math.abs(apy - expected) < 1e-10);
});
