import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { getManualMetrics } from "../src/core/utils/cms.js";

const ADAPTER_KEY = "test-adapter-key";

const responses = new Map<string, { status: number; body: unknown }>();

let server: Server;
let baseUrl: string;
let lastAuthHeader: string | null = null;

before(async () => {
  server = createServer((req, res) => {
    lastAuthHeader = req.headers["x-adapter-key"] as string | null;
    const slug = req.url?.split("/").pop() ?? "";
    const entry = responses.get(slug) ?? {
      status: 404,
      body: { error: "not found" },
    };
    res.writeHead(entry.status, { "content-type": "application/json" });
    res.end(JSON.stringify(entry.body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function ctx(env?: Record<string, string | undefined>) {
  return { env: env ?? { API_URL: baseUrl, ADAPTER_KEY } };
}

test("parses a fully-populated manual-metrics response", async () => {
  responses.set("sypher", {
    status: 200,
    body: {
      slug: "sypher",
      aprPercent: 4.35,
      tvlUsd: 6_000_000,
      updatedAt: "2026-06-15T20:06:30.000Z",
    },
  });

  const metrics = await getManualMetrics(ctx(), "sypher");
  assert.deepEqual(metrics, {
    aprPercent: 4.35,
    tvlUsd: 6_000_000,
    updatedAt: "2026-06-15T20:06:30.000Z",
  });
  assert.equal(lastAuthHeader, ADAPTER_KEY);
});

test("passes through null tvlUsd for undisclosed products", async () => {
  responses.set("coinbase", {
    status: 200,
    body: {
      slug: "coinbase",
      aprPercent: 4.0,
      tvlUsd: null,
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
  });

  const metrics = await getManualMetrics(ctx(), "coinbase");
  assert.equal(metrics.aprPercent, 4.0);
  assert.equal(metrics.tvlUsd, null);
});

test("throws when API_URL / ADAPTER_KEY are not on ctx.env", async () => {
  await assert.rejects(
    () => getManualMetrics(ctx({}), "sypher"),
    /BITCOINYIELD_API_URL and BITCOINYIELD_ADAPTER_KEY must be set/,
  );
});

test("throws loudly when aprPercent is missing or not a number", async () => {
  responses.set("broken", {
    status: 200,
    body: {
      slug: "broken",
      aprPercent: null,
      tvlUsd: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });

  await assert.rejects(
    () => getManualMetrics(ctx(), "broken"),
    /manual-metrics\(broken\)\.aprPercent/,
  );
});

test("throws when updatedAt is absent", async () => {
  responses.set("stale", {
    status: 200,
    body: { slug: "stale", aprPercent: 2, tvlUsd: null },
  });

  await assert.rejects(
    () => getManualMetrics(ctx(), "stale"),
    /updatedAt missing/,
  );
});

test("throws on 404 for an unknown CMS slug", async () => {
  await assert.rejects(
    () => getManualMetrics(ctx(), "no-such-product"),
    /HTTP 404/,
  );
});
