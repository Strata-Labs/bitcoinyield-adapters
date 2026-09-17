import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoundaries,
  BOUNDARIES,
} from "../src/core/pipeline/boundaries.js";
import { normalize } from "../src/core/pipeline/normalize.js";
import type {
  Adapter,
  BoundaryAlert,
  MetricRow,
  Notifier,
} from "../src/core/types.js";

function row(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    symbol: "yb-WBTC",
    tvlBtc: 129.8,
    tvlUsd: 12_980_000,
    btcPrice: 100_000,
    apr: 1.5,
    timestamp: new Date("2026-08-07T00:00:00.000Z"),
    ...overrides,
  };
}

function capturingNotifier() {
  const alerts: BoundaryAlert[] = [];
  const notifier: Notifier = {
    async boundary(alert) {
      alerts.push(alert);
    },
    async spike() {},
    async staleness() {},
    async regression() {},
  };
  return { notifier, alerts };
}

test("a plausible negative annualized rate is preserved", async () => {
  const { notifier, alerts } = capturingNotifier();
  const result = await applyBoundaries(
    [row({ apr: -0.37 })],
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 1);
  assert.equal(alerts.length, 0);
});

test("an implausibly large negative annualized rate is still dropped", async () => {
  const { notifier, alerts } = capturingNotifier();
  const result = await applyBoundaries(
    [row({ apr: -1_001 })],
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 0);
  assert.equal(alerts[0]?.threshold, BOUNDARIES.apr.lb);
});

test("a zero apr without allowZeroApr still fails loudly", () => {
  const adapter = { slug: "yb-wbtc-yieldbearing" } as Adapter;
  assert.throws(
    () =>
      normalize(
        [
          {
            symbol: "yb-WBTC",
            tvlBtc: 129.8,
            apr: 0,
            metadata: { rawApr30d: 0 },
          },
        ],
        adapter,
        100_000,
        new Date(),
      ),
    /apr=0/,
    "a frozen share price must not hide behind the floor",
  );
});
