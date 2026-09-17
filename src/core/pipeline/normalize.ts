import type { Adapter, AdapterResult, MetricRow } from "../types.js";
import { createRate, type Rate } from "../rates.js";
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
    const { rate, legacyValue, migrated } = normalizeRate(row, adapter.slug);

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
      apr: legacyValue,
      apy: rate?.type === "apy" ? rate.value : null,
      rate,
      metadata: {
        ...row.metadata,
        rate,
        rateType: rate?.type ?? null,
        rateStatus: rate ? "valid" : "unavailable",
        rateMigrated: migrated,
        ...(rate === null && {
          rateUnavailableReason: row.rateUnavailableReason,
        }),
      },
      timestamp,
    };
  });
}

function normalizeRate(
  row: AdapterResult,
  adapterSlug: string,
): { rate: Rate | null; legacyValue: number | null; migrated: boolean } {
  if (row.rate === null) {
    if (!row.rateUnavailableReason?.trim()) {
      throw new Error(
        `Adapter ${adapterSlug} returned rate=null without rateUnavailableReason`,
      );
    }
    return { rate: null, legacyValue: null, migrated: true };
  }

  if (row.rate !== undefined) {
    const rate = createRate(row.rate);
    return { rate, legacyValue: rate.value, migrated: true };
  }

  const apr =
    typeof row.apr === "number" && Number.isFinite(row.apr) ? row.apr : NaN;
  if (!Number.isFinite(apr)) {
    throw new Error(
      `Adapter ${adapterSlug} must return rate, rate=null, or a finite legacy apr`,
    );
  }
  // Legacy apr=0 is ambiguous: old adapters used it for both valid zero and
  // failed reads. Keep the old opt-in until that adapter migrates to `rate`.
  if (apr === 0 && row.metadata?.allowZeroApr !== true) {
    throw new Error(
      `Adapter ${adapterSlug} produced apr=0. If the protocol genuinely ` +
        `pays nothing right now, set metadata.allowZeroApr; otherwise the ` +
        `source field is broken.`,
    );
  }

  const rate = createRate({
    type: "apr",
    value: apr,
    basis: "reported",
    source:
      typeof row.metadata?.aprSource === "string"
        ? row.metadata.aprSource
        : "legacy-adapter",
    compounding: { method: "unknown" },
  });
  return { rate, legacyValue: apr, migrated: false };
}
