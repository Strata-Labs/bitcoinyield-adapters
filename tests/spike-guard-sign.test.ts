import assert from "node:assert/strict";
import { test } from "node:test";

import { spikeGuard } from "../src/core/pipeline/spikeGuard.js";
import type { MetricRow, Notifier, SpikeAlert } from "../src/core/types.js";

function row(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    symbol: "yb-WBTC",
    tvlBtc: 129.8,
    tvlUsd: 12_980_000,
    btcPrice: 100_000,
    rate: 1.5,
    rateType: "apy",
    timestamp: new Date("2026-08-07T00:00:00.000Z"),
    ...overrides,
  };
}

function capturingNotifier() {
  const spikes: SpikeAlert[] = [];
  const notifier: Notifier = {
    async spike(alert) {
      spikes.push(alert);
    },
    async boundary() {},
    async staleness() {},
    async regression() {},
  };
  return { notifier, spikes };
}

test("a negative rate collapsing further is caught like its positive mirror", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: -45 })],
    row({ rate: -0.37 }),
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 0, "a 121x move must not reach the DB");
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0]?.direction, "down");
  assert.ok((spikes[0]?.multiplier ?? 0) > 100);
});

test("a negative rate recovering toward zero reads as an upward spike", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: -0.37 })],
    row({ rate: -45 }),
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(spikes[0]?.direction, "up");
  assert.equal(result.kept.length, 0);
});

test("a small negative drift is not a spike", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: -0.4 })],
    row({ rate: -0.37 }),
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 1);
  assert.equal(spikes.length, 0);
});

test("a sign flip is not ranked", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: -0.37 })],
    row({ rate: 2.5 }),
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 1);
  assert.equal(spikes.length, 0);
});

test("positive-side behaviour is unchanged", async () => {
  const { notifier, spikes } = capturingNotifier();
  const tripled = await spikeGuard(
    [row({ rate: 12 })],
    row({ rate: 3 }),
    "some-adapter",
    notifier,
  );
  assert.equal(tripled.kept.length, 1, "3x alerts but keeps");
  assert.equal(spikes[0]?.direction, "up");
  assert.equal(spikes[0]?.multiplier, 4);

  const crashed = await spikeGuard(
    [row({ rate: 0.5 })],
    row({ rate: 10 }),
    "some-adapter",
    notifier,
  );
  assert.equal(crashed.kept.length, 0, "20x drop still drops");
  assert.equal(spikes[1]?.direction, "down");
});

test("tvl spikes are still ranked alongside rate", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ tvlBtc: 1_300 })],
    row({ tvlBtc: 129.8 }),
    "some-adapter",
    notifier,
  );

  assert.equal(result.kept.length, 0);
  assert.equal(spikes[0]?.field, "tvlBtc");
});

test("a rateType change is not ranked as a spike", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: 12, rateType: "apr" })],
    row({ rate: 2, rateType: "apy" }),
    "some-adapter",
    notifier,
  );

  assert.equal(result.kept.length, 1);
  assert.equal(spikes.length, 0);
});

test("a legacy baseline without rateType still guards the rate", async () => {
  const { notifier, spikes } = capturingNotifier();
  const result = await spikeGuard(
    [row({ rate: 20, rateType: "apr" })],
    row({ rate: 2, rateType: null }),
    "some-adapter",
    notifier,
  );

  assert.equal(result.kept.length, 0, "10x must still drop across the cutover");
  assert.equal(spikes[0]?.field, "rate");
});
