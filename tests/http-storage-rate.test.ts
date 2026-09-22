import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpStorage } from "../src/core/storage/http.js";

function storageReturning(body: unknown) {
  const sent: unknown[] = [];
  const storage = new HttpStorage({
    baseUrl: "http://main.app",
    adapterKey: "k",
    fetch: (async (_url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });
  return { storage, sent };
}

test("insert sends rate + rateType with apr as a deprecated alias", async () => {
  const { storage, sent } = storageReturning({ success: true });
  await storage.insert("some-adapter", [
    {
      symbol: "BTC",
      tvlBtc: 1,
      tvlUsd: 100_000,
      btcPrice: 100_000,
      rate: 2.5,
      rateType: "apy",
      timestamp: new Date("2026-09-17T00:00:00.000Z"),
    },
  ]);

  const { row } = sent[0] as { row: Record<string, unknown> };
  assert.equal(row.rate, 2.5);
  assert.equal(row.rateType, "apy");
  assert.equal(row.apr, 2.5);
});

test("getLatest reads a legacy apr-only row as an unlabeled rate", async () => {
  const { storage } = storageReturning({
    row: {
      tvlBtc: 1,
      tvlUsd: 100_000,
      btcPrice: 100_000,
      apr: 1.8,
      timestamp: "2026-09-17T00:00:00.000Z",
    },
  });

  const row = await storage.getLatest("some-adapter");
  assert.equal(row?.rate, 1.8);
  assert.equal(row?.rateType, null);
  assert.equal("apr" in (row ?? {}), false);
});

test("getLatest treats an unknown rateType as unlabeled, not as a relabel", async () => {
  const { storage } = storageReturning({
    row: {
      tvlBtc: 1,
      tvlUsd: 100_000,
      btcPrice: 100_000,
      rate: 1.8,
      rateType: "APR",
      timestamp: "2026-09-17T00:00:00.000Z",
    },
  });

  const row = await storage.getLatest("some-adapter");
  assert.equal(row?.rateType, null);
});

test("getLatest prefers rate + rateType once the main app serves them", async () => {
  const { storage } = storageReturning({
    row: {
      tvlBtc: 1,
      tvlUsd: 100_000,
      btcPrice: 100_000,
      rate: 3.2,
      rateType: "apr",
      apr: 3.2,
      timestamp: "2026-09-17T00:00:00.000Z",
    },
  });

  const row = await storage.getLatest("some-adapter");
  assert.equal(row?.rate, 3.2);
  assert.equal(row?.rateType, "apr");
});
