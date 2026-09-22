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
    const rate =
      typeof row.rate === "number" && Number.isFinite(row.rate)
        ? row.rate
        : NaN;
    if (!Number.isFinite(rate)) {
      throw new Error(
        `Adapter ${adapter.slug} has non-finite rate: ${row.rate}`,
      );
    }
    // Never defaulted: an unlabeled figure is exactly the APR/APY mix-up
    // rateType exists to end.
    if (row.rateType !== "apr" && row.rateType !== "apy") {
      throw new Error(
        `Adapter ${adapter.slug} has invalid rateType: ${row.rateType} ` +
          `(expected "apr" or "apy")`,
      );
    }
    // rate=0 is the one wrong value no downstream guard can see: boundaries
    // allow it and the spike guard skips non-positive values. Zero must be an
    // explicit adapter decision, never a fallback's output.
    if (rate === 0 && row.metadata?.allowZeroRate !== true) {
      throw new Error(
        `Adapter ${adapter.slug} produced rate=0. If the protocol genuinely ` +
          `pays nothing right now, set metadata.allowZeroRate; otherwise the ` +
          `source field is broken.`,
      );
    }

    if (row.tvlUsd !== undefined) {
      if (
        typeof row.tvlUsd !== "number" ||
        !Number.isFinite(row.tvlUsd) ||
        row.tvlUsd < 0
      ) {
        throw new Error(
          `Adapter ${adapter.slug} has invalid tvlUsd: ${row.tvlUsd}`,
        );
      }
    }
    const tvlUsd = row.tvlUsd ?? math.mul(tvlBtc, btcPrice);

    return {
      symbol: row.symbol,
      tvlBtc,
      tvlUsd,
      btcPrice,
      rate,
      rateType: row.rateType,
      metadata: row.metadata,
      timestamp,
    };
  });
}
