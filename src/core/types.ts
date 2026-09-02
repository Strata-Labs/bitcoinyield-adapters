export type CustodyModel = "self" | "multisig" | "custodial" | "mpc";

export interface AdapterRequirements {
  rpc?: string[];
  stacks?: boolean;
  apis?: string[];
  /** Named secrets; whitelisted from env as `BITCOINYIELD_${name}` and exposed on `ctx.env`. */
  secrets?: string[];
}

export interface AdapterAuditInfo {
  firms?: string[];
  latestUrl?: string;
}

export interface FetchContext {
  env: Record<string, string | undefined>;
}

import type { Rate } from "./rates.js";

export interface AdapterResult {
  symbol: string;
  tvlBtc: number;
  tvlUsd?: number;
  /** Canonical rate. Explicit APY requires verified compounding evidence. */
  rate?: Rate | null;
  /** Why no defensible product-level rate is available. Required with rate:null. */
  rateUnavailableReason?: string;
  /**
   * Legacy adapter field. When `rate` is omitted this is interpreted as APR.
   * Migrated adapters should emit `rate` instead.
   */
  apr?: number;
  metadata?: Record<string, unknown>;
}

export interface Adapter {
  slug: string;
  name: string;
  url: string;
  category?: string;
  custody?: CustodyModel;
  audit?: AdapterAuditInfo;
  proofOfReserves?: string;
  schemaVersion?: number;
  requires?: AdapterRequirements;
  fetch: (ctx: FetchContext) => Promise<AdapterResult[]>;
}

export interface MetricRow {
  symbol: string;
  tvlBtc: number;
  tvlUsd: number;
  btcPrice: number;
  /** Temporary database projection. For APY rows this mirrors rate.value. */
  apr: number | null;
  /** Canonical APY value for upgraded storage consumers. */
  apy?: number | null;
  /** Canonical semantic rate record. Also copied into metadata for old storage. */
  rate?: Rate | null;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export type AdapterRunStatus = "success" | "error";

export interface AdapterRunRecord {
  status: AdapterRunStatus;
  finishedAt: Date;
  durationMs: number;
  rowsInserted?: number;
  rowsDropped?: number;
  lastError?: string | null;
}

export interface Storage {
  getLatest(slug: string): Promise<MetricRow | null>;
  insert(slug: string, rows: MetricRow[]): Promise<void>;
  recordRun(slug: string, record: AdapterRunRecord): Promise<void>;
}

export interface SpikeAlert {
  adapter: string;
  field: "tvlBtc" | "apr";
  oldValue: number;
  newValue: number;
  multiplier: number;
  direction: "up" | "down";
  /** Whether the row was dropped (>= drop threshold) or kept (alert-only band). */
  dropped: boolean;
}

export interface BoundaryAlert {
  adapter: string;
  field: "tvlBtc" | "apr";
  value: number;
  bound: "lower" | "upper";
  threshold: number;
}

export interface StalenessAlert {
  adapter: string;
  lastUpdateAt: Date;
  hoursSilent: number;
}

export interface RegressionAlert {
  adapter: string;
  consecutiveFailures: number;
  lastError: string;
}

export interface Notifier {
  spike(alert: SpikeAlert): Promise<void>;
  boundary(alert: BoundaryAlert): Promise<void>;
  staleness(alert: StalenessAlert): Promise<void>;
  regression(alert: RegressionAlert): Promise<void>;
}
