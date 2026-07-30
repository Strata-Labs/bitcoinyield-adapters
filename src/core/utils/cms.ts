/**
 * Manual-metrics reader for CMS-sourced adapters — products with no API or
 * on-chain source, where a human maintains APR/TVL in the main app's CMS.
 * Reading it back keeps the CMS the single source of truth while rows still
 * pass the normal pipeline (validators, boundaries, spike guard).
 *
 * Endpoint contract (main app, see INTEGRATION.md):
 *
 *   GET /api/manual-metrics/:slug     auth: x-adapter-key
 *   → 200 { slug, aprPercent, tvlUsd: number | null, updatedAt }
 *   → 404 when no CMS product matches the slug
 */

import type { FetchContext } from "../types.js";
import * as http from "./http.js";
import { requireNumber } from "./validators.js";

export interface ManualMetrics {
  /** APR as a percentage (4.35 = 4.35%). */
  aprPercent: number;
  /** Reported TVL in USD, or null when the product doesn't disclose it. */
  tvlUsd: number | null;
  /** ISO timestamp of the last CMS edit. */
  updatedAt: string;
}

/**
 * Callers must declare `requires: { secrets: ["API_URL", "ADAPTER_KEY"] }`.
 * Validation of the fetched values (positive APR, disclosed vs undisclosed
 * TVL) is left to the adapter — products differ on what's legitimate.
 */
export async function getManualMetrics(
  ctx: FetchContext,
  slug: string,
): Promise<ManualMetrics> {
  const baseUrl = ctx.env.API_URL?.replace(/\/+$/, "");
  const adapterKey = ctx.env.ADAPTER_KEY;
  if (!baseUrl || !adapterKey) {
    throw new Error(
      `cms.getManualMetrics(${slug}): BITCOINYIELD_API_URL and ` +
        `BITCOINYIELD_ADAPTER_KEY must be set, and the adapter must declare ` +
        `requires.secrets: ["API_URL", "ADAPTER_KEY"]`,
    );
  }

  const data = await http.get<{
    aprPercent?: unknown;
    tvlUsd?: unknown;
    updatedAt?: unknown;
  }>(`${baseUrl}/api/manual-metrics/${encodeURIComponent(slug)}`, {
    headers: { "x-adapter-key": adapterKey },
  });

  const aprPercent = requireNumber(
    data.aprPercent,
    `manual-metrics(${slug}).aprPercent`,
  );
  const tvlUsd =
    data.tvlUsd === null || data.tvlUsd === undefined
      ? null
      : requireNumber(data.tvlUsd, `manual-metrics(${slug}).tvlUsd`);
  if (typeof data.updatedAt !== "string" || data.updatedAt === "") {
    throw new Error(`manual-metrics(${slug}).updatedAt missing from response`);
  }

  return { aprPercent, tvlUsd, updatedAt: data.updatedAt };
}
