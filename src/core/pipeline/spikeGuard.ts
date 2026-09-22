import type { MetricRow, Notifier } from "../types.js";

/**
 * Bidirectional two-band spike guard, 5h window. Catches both inflations
 * and crashes (one-way guards miss data-quality regressions down).
 *
 * Alerting is decoupled from dropping. Low-base rates legitimately double
 * (July 2026: yb-tbtc went 1.74% -> 3.5% and the old single 2x threshold
 * blocked it into a staleness page), while the bug class that must never
 * reach the DB (unit confusion, wrong-field parses) lands 10x+ off. So:
 * >= 3x pages Discord but keeps the row; >= 5x pages AND drops.
 */
export const SPIKE_ALERT_THRESHOLD = 3;
export const SPIKE_DROP_THRESHOLD = 5;
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
    // An APR and an APY aren't the same measure, so a relabel is not a
    // spike. Legacy baselines (rateType null) predate the label and still
    // compare — relabeling didn't change the stored figures.
    const rateComparable =
      previous.rateType === null || previous.rateType === row.rateType;
    const rateSpike = rateComparable
      ? checkRatio(row.rate, previous.rate)
      : null;
    const spike = tvlSpike
      ? { field: "tvlBtc" as const, ...tvlSpike }
      : rateSpike
        ? { field: "rate" as const, ...rateSpike }
        : null;

    if (!spike) {
      kept.push(row);
      continue;
    }

    const shouldDrop = spike.multiplier >= SPIKE_DROP_THRESHOLD;
    const oldValue = spike.field === "tvlBtc" ? previous.tvlBtc : previous.rate;
    const newValue = spike.field === "tvlBtc" ? row.tvlBtc : row.rate;
    await notifier.spike({
      adapter: adapterSlug,
      field: spike.field,
      oldValue,
      newValue,
      multiplier: spike.multiplier,
      direction: spike.direction,
      dropped: shouldDrop,
    });

    if (shouldDrop) {
      dropped.push({
        row,
        reason: `spike-guard: ${spike.field} ${oldValue} -> ${newValue} (${spike.multiplier.toFixed(2)}x ${spike.direction})`,
      });
    } else {
      kept.push(row);
    }
  }

  return { kept, dropped };
}

function checkRatio(
  newValue: number,
  oldValue: number,
): { multiplier: number; direction: "up" | "down" } | null {
  if (newValue === 0 || oldValue === 0) return null;
  if (newValue > 0 !== oldValue > 0) return null;

  const ratio = Math.abs(newValue) / Math.abs(oldValue);
  const multiplier = ratio >= 1 ? ratio : 1 / ratio;
  if (multiplier < SPIKE_ALERT_THRESHOLD) return null;

  return { multiplier, direction: newValue > oldValue ? "up" : "down" };
}
