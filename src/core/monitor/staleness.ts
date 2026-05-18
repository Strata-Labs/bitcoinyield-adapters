import type { Storage, Notifier } from '../types.js'

export const DEFAULT_STALENESS_GRACE_MS = 3 * 60 * 60 * 1000

export interface StalenessReport {
  slug: string
  lastUpdateAt: Date | null
  hoursSilent: number | null
  isStale: boolean
}

export interface StalenessOptions {
  slugs: string[]
  gracePeriodMs?: number
  now?: Date
}

/** Pure: returns the report without firing alerts. */
export async function getStalenessReport(
  storage: Storage,
  options: StalenessOptions,
): Promise<StalenessReport[]> {
  const grace = options.gracePeriodMs ?? DEFAULT_STALENESS_GRACE_MS
  const now = options.now ?? new Date()
  const reports: StalenessReport[] = []

  for (const slug of options.slugs) {
    const latest = await storage.getLatest(slug)
    if (!latest) {
      reports.push({ slug, lastUpdateAt: null, hoursSilent: null, isStale: false })
      continue
    }
    const silentMs = now.getTime() - latest.timestamp.getTime()
    const hoursSilent = silentMs / (60 * 60 * 1000)
    reports.push({
      slug,
      lastUpdateAt: latest.timestamp,
      hoursSilent,
      isStale: silentMs > grace,
    })
  }

  return reports
}

export async function runStalenessMonitor(
  storage: Storage,
  notifier: Notifier,
  options: StalenessOptions,
): Promise<StalenessReport[]> {
  const reports = await getStalenessReport(storage, options)
  for (const report of reports) {
    if (report.isStale && report.lastUpdateAt && report.hoursSilent !== null) {
      await notifier.staleness({
        adapter: report.slug,
        lastUpdateAt: report.lastUpdateAt,
        hoursSilent: report.hoursSilent,
      })
    }
  }
  return reports
}
