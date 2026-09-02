import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateUnitValueRate, createRate } from "../src/core/rates.js";
import { normalize } from "../src/core/pipeline/normalize.js";
import type { Adapter } from "../src/core/types.js";

const adapter: Adapter = {
  slug: "example-vault",
  name: "Example Vault",
  url: "https://example.com",
  async fetch() {
    return [];
  },
};

test("unit-value growth resolves to APY and retains the simple APR comparison", () => {
  const result = calculateUnitValueRate({
    valueThen: 1,
    valueNow: 1.01,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-01-31T00:00:00.000Z",
    source: "ethereum:0xvault.convertToAssets",
    evidence: {
      kind: "unit_value",
      field: "convertToAssets(1 share)",
      reference: "ethereum:0xvault",
    },
  });

  assert.equal(result.type, "apy");
  assert.equal(result.basis, "calculated");
  assert.equal(result.windowDays, 30);
  assert.ok(Math.abs(result.value - 12.869529415939041) < 1e-12);
  assert.ok(
    Math.abs((result.simpleAprPercent ?? 0) - 12.166666666666666) < 1e-12,
  );
});

test("APY cannot be declared without automatic compounding evidence", () => {
  assert.throws(
    () =>
      createRate({
        type: "apy",
        value: 4.2,
        basis: "reported",
        source: "https://example.com/rate",
        windowDays: 30,
      } as never),
    /APY requires automatic compounding evidence/,
  );
});

test("normalize publishes explicit APY canonically while preserving the legacy numeric projection", () => {
  const rate = createRate({
    type: "apy",
    value: 4.2,
    basis: "reported",
    source: "https://example.com/rate",
    windowDays: 30,
    compounding: {
      method: "automatic",
      evidence: {
        kind: "unit_value",
        field: "pricePerShare()",
        reference: "ethereum:0xvault",
      },
    },
  });

  const [row] = normalize(
    [{ symbol: "xBTC", tvlBtc: 10, rate }],
    adapter,
    80_000,
    new Date("2026-09-02T00:00:00.000Z"),
  );

  assert.ok(row);
  assert.equal(row.rate?.type, "apy");
  assert.equal(row.apy, 4.2);
  assert.equal(row.apr, 4.2);
  assert.equal(row.metadata?.rateType, "apy");
  assert.deepEqual(row.metadata?.rate, rate);
});

test("legacy adapters default to APR until migrated", () => {
  const [row] = normalize(
    [
      {
        symbol: "xBTC",
        tvlBtc: 10,
        apr: 3.5,
        metadata: { aprSource: "protocol-api" },
      },
    ],
    adapter,
    80_000,
    new Date("2026-09-02T00:00:00.000Z"),
  );

  assert.ok(row);
  assert.equal(row.rate?.type, "apr");
  assert.equal(row.apr, 3.5);
  assert.equal(row.apy, null);
  assert.equal(row.metadata?.rateType, "apr");
  assert.equal(row.metadata?.rateMigrated, false);
});

test("an unavailable rate persists TVL with null instead of inventing zero", () => {
  const [row] = normalize(
    [
      {
        symbol: "BTC",
        tvlBtc: 100,
        rate: null,
        rateUnavailableReason: "No product-level yield observation",
      },
    ],
    adapter,
    80_000,
    new Date("2026-09-02T00:00:00.000Z"),
  );

  assert.ok(row);
  assert.equal(row.apr, null);
  assert.equal(row.apy, null);
  assert.equal(row.rate, null);
  assert.equal(row.metadata?.rateStatus, "unavailable");
  assert.equal(
    row.metadata?.rateUnavailableReason,
    "No product-level yield observation",
  );
});

test("negative verified rates remain negative instead of being floored to zero", () => {
  const rate = createRate({
    type: "apy",
    value: -1.25,
    basis: "reported",
    source: "https://example.com/rate",
    windowDays: 30,
    compounding: {
      method: "automatic",
      evidence: {
        kind: "nav",
        field: "navPerToken",
        reference: "ethereum:0xfeed",
      },
    },
  });

  const [row] = normalize(
    [{ symbol: "xBTC", tvlBtc: 10, rate }],
    adapter,
    80_000,
    new Date("2026-09-02T00:00:00.000Z"),
  );

  assert.ok(row);
  assert.equal(row.apr, -1.25);
  assert.equal(row.apy, -1.25);
  assert.equal(row.metadata?.rateType, "apy");
});
