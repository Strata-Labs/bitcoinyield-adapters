import type { Adapter, AdapterResult, MetricRow } from "../types.js";
import * as math from "../utils/math.js";
import { requirePositive } from "../utils/validators.js";

export function normalize(
  raw: AdapterResult[],
  adapter: Adapter,
  btcPrice: number,
  timestamp: Date,
): MetricRow[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Adapter ${adapter.slug} returned non-array from fetch(): got ${typeof raw}`,
    );
  }

  return raw.map((row, idx) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Adapter ${adapter.slug} row ${idx} is not an object`);
    }
    if (!row.symbol) {
      throw new Error(`Adapter ${adapter.slug} row ${idx} is missing 'symbol'`);
    }

    const tvlBtc = requirePositive(row.tvlBtc, `${adapter.slug}.tvlBtc`);
    const apr =
      typeof row.apr === "number" && Number.isFinite(row.apr) ? row.apr : NaN;
    if (!Number.isFinite(apr)) {
      throw new Error(`Adapter ${adapter.slug} has non-finite apr: ${row.apr}`);
    }

    const tvlUsd = row.tvlUsd ?? math.mul(tvlBtc, btcPrice);

    return {
      symbol: row.symbol,
      tvlBtc,
      tvlUsd,
      btcPrice,
      apr,
      metadata: row.metadata,
      timestamp,
    };
  });
}
