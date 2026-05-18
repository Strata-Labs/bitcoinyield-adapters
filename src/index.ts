export { defineAdapter } from './core/defineAdapter.js'
export { runAdapter } from './core/runAdapter.js'
export type {
  Adapter,
  AdapterResult,
  AdapterRequirements,
  AdapterAuditInfo,
  AdapterRunRecord,
  AdapterRunStatus,
  BoundaryAlert,
  CustodyModel,
  FetchContext,
  MetricRow,
  Notifier,
  RegressionAlert,
  SpikeAlert,
  StalenessAlert,
  Storage,
} from './core/types.js'

export * as math from './core/utils/math.js'
export * as prices from './core/utils/prices.js'
export * as http from './core/utils/http.js'
export * as scraper from './core/utils/scraper.js'
export * as ethereum from './core/utils/chains/ethereum.js'
export * as stacks from './core/utils/chains/stacks.js'
export {
  readShareGrowth,
  BLOCKS_PER_30D,
  type ShareGrowthOptions,
  type ShareGrowthResult,
} from './core/utils/yield.js'
export {
  requirePositive,
  requireNumber,
  parseNumber,
  parsePercent,
} from './core/utils/validators.js'

export {
  normalize,
  applyBoundaries,
  spikeGuard,
  BOUNDARIES,
  SPIKE_THRESHOLD,
  SPIKE_WINDOW_MS,
} from './core/pipeline/index.js'

export {
  NoopStorage,
  MemoryStorage,
  HttpStorage,
  LoggingStorage,
  type HttpStorageOptions,
} from './core/storage/index.js'

export { NoopNotifier, DiscordNotifier, type DiscordWebhooks } from './core/notifications/index.js'

export {
  runStalenessMonitor,
  getStalenessReport,
  DEFAULT_STALENESS_GRACE_MS,
  type StalenessReport,
  type StalenessOptions,
} from './core/monitor/index.js'

export { adapters } from './adapters-registry.js'
