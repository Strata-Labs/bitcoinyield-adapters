import type { Storage, MetricRow, AdapterRunRecord } from "../types.js";

/**
 * Storage that logs to stdout instead of writing anywhere. Used for testing
 * deploys where the main app endpoints aren't ready yet — set
 * `BITCOINYIELD_STORAGE_MODE=log` to switch from HttpStorage. Each line is
 * grep-friendly: `[adapter-metrics]` for written rows, `[adapter-status]`
 * for run outcomes.
 */
export class LoggingStorage implements Storage {
  async getLatest(_slug: string): Promise<MetricRow | null> {
    return null;
  }

  async insert(slug: string, rows: MetricRow[]): Promise<void> {
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(`[adapter-metrics] slug=${slug} row=${JSON.stringify(row)}`);
    }
  }

  async recordRun(slug: string, record: AdapterRunRecord): Promise<void> {
    const parts = [
      `slug=${slug}`,
      `status=${record.status}`,
      `durationMs=${record.durationMs}`,
      `rowsInserted=${record.rowsInserted ?? 0}`,
      `rowsDropped=${record.rowsDropped ?? 0}`,
    ];
    if (record.lastError) {
      parts.push(`lastError=${JSON.stringify(record.lastError.slice(0, 300))}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[adapter-status] ${parts.join(" ")}`);
  }
}
