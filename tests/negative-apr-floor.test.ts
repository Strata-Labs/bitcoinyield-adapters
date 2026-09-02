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

test("a negative apr is dropped regardless of metadata", async () => {
  const { notifier, alerts } = capturingNotifier();
  const result = await applyBoundaries(
    [row({ apr: -0.37, metadata: { allowNegativeApr: true } })],
    "yb-wbtc-yieldbearing",
    notifier,
  );

  assert.equal(result.kept.length, 0);
  assert.equal(alerts[0]?.threshold, BOUNDARIES.apr.lb);
});

test("a floored zero with allowZeroApr passes normalize and boundaries", async () => {
  const adapter = { slug: "yb-wbtc-yieldbearing" } as Adapter;
  const rows = normalize(
    [
      {
        symbol: "yb-WBTC",
        tvlBtc: 129.8,
        apr: Math.max(-0.37, 0),
        metadata: { allowZeroApr: true, rawApr30d: -0.37 },
      },
    ],
    adapter,
    100_000,
    new Date(),
  );
  assert.equal(rows[0]?.apr, 0);
  assert.equal(rows[0]?.metadata?.rawApr30d, -0.37);

  const { notifier, alerts } = capturingNotifier();
  const result = await applyBoundaries(rows, "yb-wbtc-yieldbearing", notifier);
  assert.equal(result.kept.length, 1);
  assert.equal(alerts.length, 0);
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

// Adapter-level flooring (apr floored to 0, conditional allowZeroApr, raw
// figure in metadata) is covered by tests/yieldbasis-current-market.test.ts
// via the negative cbBTC/tBTC fixtures; this file owns the pipeline-level
// guarantees only.
