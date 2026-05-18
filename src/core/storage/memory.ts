import type { Storage, MetricRow, AdapterRunRecord } from '../types.js'

/** In-memory storage for unit tests. */
export class MemoryStorage implements Storage {
  private rows = new Map<string, MetricRow[]>()
  private runs = new Map<string, AdapterRunRecord[]>()

  async getLatest(slug: string): Promise<MetricRow | null> {
    const list = this.rows.get(slug)
    if (!list || list.length === 0) return null
    return [...list].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null
  }

  async insert(slug: string, rows: MetricRow[]): Promise<void> {
    const existing = this.rows.get(slug) ?? []
    this.rows.set(slug, [...existing, ...rows])
  }

  async recordRun(slug: string, record: AdapterRunRecord): Promise<void> {
    const existing = this.runs.get(slug) ?? []
    this.runs.set(slug, [...existing, record])
  }

  getAllRows(slug: string): MetricRow[] {
    return this.rows.get(slug) ?? []
  }

  getAllRuns(slug: string): AdapterRunRecord[] {
    return this.runs.get(slug) ?? []
  }
}
