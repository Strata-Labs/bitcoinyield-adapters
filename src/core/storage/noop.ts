import type { Storage, MetricRow, AdapterRunRecord } from '../types.js'

/**
 * Discards everything. Default for CLI so adapters can never accidentally
 * write to a real database — there's no DB driver to construct.
 */
export class NoopStorage implements Storage {
  async getLatest(_slug: string): Promise<MetricRow | null> {
    return null
  }

  async insert(_slug: string, _rows: MetricRow[]): Promise<void> {}

  async recordRun(_slug: string, _record: AdapterRunRecord): Promise<void> {}
}
