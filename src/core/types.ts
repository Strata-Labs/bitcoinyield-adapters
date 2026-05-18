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

export interface AdapterResult {
  symbol: string;
  tvlBtc: number;
  tvlUsd?: number;
  apr: number;
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
  apr: number;
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
