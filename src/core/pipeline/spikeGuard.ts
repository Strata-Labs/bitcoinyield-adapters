import type { MetricRow, Notifier } from "../types.js";

/**
 * Bidirectional 2x-in-5h spike guard. Catches both inflations and crashes
 * (one-way guards miss data-quality regressions in the down direction).
 */
export const SPIKE_THRESHOLD = 2;
export const SPIKE_WINDOW_MS = 5 * 60 * 60 * 1000;

export interface SpikeGuardResult {
  kept: MetricRow[];
  dropped: Array<{ row: MetricRow; reason: string }>;
}

export async function spikeGuard(
  rows: MetricRow[],
  previous: MetricRow | null,
  adapterSlug: string,
  notifier: Notifier,
): Promise<SpikeGuardResult> {
  if (!previous || rows.length === 0) return { kept: rows, dropped: [] };

  const firstRow = rows[0];
  if (!firstRow) return { kept: rows, dropped: [] };
  const ageMs = firstRow.timestamp.getTime() - previous.timestamp.getTime();
  // Baseline too old to trust.
  if (ageMs > SPIKE_WINDOW_MS) return { kept: rows, dropped: [] };

  const kept: MetricRow[] = [];
  const dropped: Array<{ row: MetricRow; reason: string }> = [];

  for (const row of rows) {
    const tvlSpike = checkRatio(row.tvlBtc, previous.tvlBtc);
    const aprSpike = checkRatio(row.apr, previous.apr);
    const spike = tvlSpike
      ? { field: "tvlBtc" as const, ...tvlSpike }
      : aprSpike
        ? { field: "apr" as const, ...aprSpike }
        : null;

    if (!spike) {
      kept.push(row);
      continue;
    }

    const oldValue = spike.field === "tvlBtc" ? previous.tvlBtc : previous.apr;
    const newValue = spike.field === "tvlBtc" ? row.tvlBtc : row.apr;
    await notifier.spike({
      adapter: adapterSlug,
      field: spike.field,
      oldValue,
      newValue,
      multiplier: spike.multiplier,
      direction: spike.direction,
    });
    dropped.push({
      row,
      reason: `spike-guard: ${spike.field} ${oldValue} -> ${newValue} (${spike.multiplier.toFixed(2)}x ${spike.direction})`,
    });
  }

  return { kept, dropped };
}

function checkRatio(
  newValue: number,
  oldValue: number,
): { multiplier: number; direction: "up" | "down" } | null {
  if (oldValue <= 0 || newValue <= 0) return null;
  if (newValue >= oldValue * SPIKE_THRESHOLD) {
    return { multiplier: newValue / oldValue, direction: "up" };
  }
  if (oldValue >= newValue * SPIKE_THRESHOLD) {
    return { multiplier: oldValue / newValue, direction: "down" };
  }
  return null;
}
