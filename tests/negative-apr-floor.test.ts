import assert from "node:assert/strict";
import { test } from "node:test";

import { config as wBtcConfig } from "../adapters/yb-wbtc-yieldbearing/index.js";
import {
  createYieldBasisYieldBearingAdapter,
  type YieldBasisYieldBearingDependencies,
} from "../adapters/yieldbasis/yield-bearing-adapter.js";
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

test("yieldbasis yield-bearing adapters floor a negative official APY", async () => {
  const oneEther = 10n ** 18n;
  const dependencies: YieldBasisYieldBearingDependencies = {
    async readBalances() {
      return [20n * oneEther, 8n * oneEther];
    },
    async readSharePrice() {
      return oneEther;
    },
    async getInceptionApy(marketId) {
      return {
        marketId,
        bucketStart: 1_787_011_200,
        apyRaw: "-3700000000000000",
        sourceTimestamp: "2026-08-18T17:30:46.208Z",
      };
    },
  };

  const adapter = createYieldBasisYieldBearingAdapter(wBtcConfig, dependencies);
  const rows = await adapter.fetch({ env: {} });
  assert.equal(rows[0]?.apr, 0);
  assert.equal(rows[0]?.metadata?.allowZeroApr, true);
  assert.equal(rows[0]?.metadata?.rawApy, "-3700000000000000");
});
