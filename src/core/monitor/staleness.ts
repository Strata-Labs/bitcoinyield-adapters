import type { Storage, Notifier } from "../types.js";

export const DEFAULT_STALENESS_GRACE_MS = 3 * 60 * 60 * 1000;

export interface StalenessReport {
  slug: string;
  lastUpdateAt: Date | null;
  hoursSilent: number | null;
  isStale: boolean;
  /** Set when the freshness check itself failed for this slug. */
  error?: string;
}

export interface StalenessOptions {
  slugs: string[];
  gracePeriodMs?: number;
  now?: Date;
}

/** Pure: returns the report without firing alerts. */
export async function getStalenessReport(
  storage: Storage,
  options: StalenessOptions,
): Promise<StalenessReport[]> {
  const grace = options.gracePeriodMs ?? DEFAULT_STALENESS_GRACE_MS;
  const now = options.now ?? new Date();

  // Per-slug isolation: one failed getLatest must not abort the sweep for
  // every other adapter, and the ~30 independent lookups shouldn't run
  // serially against a 10s-per-call HTTP storage.
  return Promise.all(
    options.slugs.map(async (slug): Promise<StalenessReport> => {
      let latest;
      try {
        latest = await storage.getLatest(slug);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[staleness] getLatest(${slug}) failed: ${message}`);
        return {
          slug,
          lastUpdateAt: null,
          hoursSilent: null,
          isStale: false,
          error: message,
        };
      }
      if (!latest) {
        return { slug, lastUpdateAt: null, hoursSilent: null, isStale: false };
      }
      const silentMs = now.getTime() - latest.timestamp.getTime();
      const hoursSilent = silentMs / (60 * 60 * 1000);
      return {
        slug,
        lastUpdateAt: latest.timestamp,
        hoursSilent,
        isStale: silentMs > grace,
      };
    }),
  );
}

export async function runStalenessMonitor(
  storage: Storage,
  notifier: Notifier,
  options: StalenessOptions,
): Promise<StalenessReport[]> {
  const reports = await getStalenessReport(storage, options);
  for (const report of reports) {
    if (report.isStale && report.lastUpdateAt && report.hoursSilent !== null) {
      await notifier.staleness({
        adapter: report.slug,
        lastUpdateAt: report.lastUpdateAt,
        hoursSilent: report.hoursSilent,
      });
    }
  }
  return reports;
}
