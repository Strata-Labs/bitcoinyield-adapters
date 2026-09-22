/**
 * HTTP storage backend — wire contract with the main BitcoinYield app.
 *
 * All requests authenticate via `x-adapter-key`. Endpoint contract:
 *
 *   GET  /api/adapter-metrics/:slug/latest
 *        → 200 { row: MetricRow | null }  (404 also treated as null)
 *
 *   POST /api/adapter-metrics
 *        body: { slug, row }                  → 200
 *        row carries `rate` + `rateType`, plus `apr` (= rate) as a deprecated
 *        alias until the main app reads the new fields.
 *
 *   POST /api/adapter-status
 *        body: { slug, ...AdapterRunRecord }  → 200
 *
 * Timestamps serialize as ISO 8601 strings.
 *
 * Idempotency: `src/server.ts` pins each row's `timestamp` to the Inngest
 * event's `triggeredAt`, so a retry of the same invocation produces the
 * same timestamps. Main app MUST dedup on `(slug, timestamp)` — otherwise
 * dropped responses become duplicate rows.
 */

import type {
  Storage,
  MetricRow,
  AdapterRunRecord,
  RateType,
} from "../types.js";

export interface HttpStorageOptions {
  baseUrl: string;
  adapterKey: string;
  timeoutMs?: number;
  /** Override fetch (for tests). */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpStorage implements Storage {
  private readonly baseUrl: string;
  private readonly adapterKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpStorageOptions) {
    if (!options.baseUrl) throw new Error("HttpStorage: baseUrl is required");
    if (!options.adapterKey)
      throw new Error("HttpStorage: adapterKey is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adapterKey = options.adapterKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async getLatest(slug: string): Promise<MetricRow | null> {
    const res = await this.request(
      "GET",
      `/api/adapter-metrics/${encodeURIComponent(slug)}/latest`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `HttpStorage.getLatest(${slug}) failed: HTTP ${res.status} ${await safeText(res)}`,
      );
    }
    const body = (await res.json()) as { row?: SerializedMetricRow | null };
    return body.row ? deserializeRow(body.row) : null;
  }

  async insert(slug: string, rows: MetricRow[]): Promise<void> {
    if (rows.length === 0) return;
    if (rows.length !== 1) {
      throw new Error(
        `HttpStorage.insert(${slug}): expected exactly 1 row per adapter run, got ${rows.length}. ` +
          "Multi-row adapters are no longer supported — split into separate adapter folders.",
      );
    }
    const row = rows[0] as MetricRow;
    // TODO(rate-type): drop the `apr` alias once the main app stores
    // rate + rateType (see INTEGRATION.md).
    const res = await this.request("POST", "/api/adapter-metrics", {
      slug,
      row: { ...row, apr: row.rate },
    });
    if (!res.ok) {
      throw new Error(
        `HttpStorage.insert(${slug}) failed: HTTP ${res.status} ${await safeText(res)}`,
      );
    }
  }

  async recordRun(slug: string, record: AdapterRunRecord): Promise<void> {
    const res = await this.request("POST", "/api/adapter-status", {
      slug,
      ...record,
    });
    if (!res.ok) {
      throw new Error(
        `HttpStorage.recordRun(${slug}) failed: HTTP ${res.status} ${await safeText(res)}`,
      );
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "x-adapter-key": this.adapterKey,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

interface SerializedMetricRow extends Omit<
  MetricRow,
  "timestamp" | "symbol" | "rate" | "rateType"
> {
  timestamp: string;
  /** The main app doesn't persist symbol yet; absent from `latest` responses. */
  symbol?: string;
  rate?: number;
  rateType?: RateType | null;
  /** Legacy name for `rate`; the only field on rows stored before rateType. */
  apr?: number;
}

function deserializeRow(row: SerializedMetricRow): MetricRow {
  const { apr, rate, rateType, ...rest } = row;
  const value = rate ?? apr;
  if (typeof value !== "number") {
    throw new Error("HttpStorage: latest row has neither rate nor apr");
  }
  return {
    ...rest,
    rate: value,
    // Anything but a known label reads as "unlabeled". Passing an unknown
    // value through would make the spike guard treat every new row as a
    // relabel and silently skip the rate check for that adapter.
    rateType: rateType === "apr" || rateType === "apy" ? rateType : null,
    symbol: row.symbol ?? "",
    timestamp: new Date(row.timestamp),
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
