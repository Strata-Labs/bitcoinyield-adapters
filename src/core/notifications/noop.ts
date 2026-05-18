import type {
  Notifier,
  SpikeAlert,
  BoundaryAlert,
  StalenessAlert,
  RegressionAlert,
} from '../types.js'

export class NoopNotifier implements Notifier {
  async spike(_alert: SpikeAlert): Promise<void> {}
  async boundary(_alert: BoundaryAlert): Promise<void> {}
  async staleness(_alert: StalenessAlert): Promise<void> {}
  async regression(_alert: RegressionAlert): Promise<void> {}
}
