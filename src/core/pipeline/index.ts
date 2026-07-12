export { normalize } from "./normalize.js";
export { applyBoundaries, BOUNDARIES } from "./boundaries.js";
export {
  spikeGuard,
  SPIKE_ALERT_THRESHOLD,
  SPIKE_DROP_THRESHOLD,
  SPIKE_WINDOW_MS,
  type SpikeGuardResult,
} from "./spikeGuard.js";
