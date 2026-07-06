/**
 * Generic EVM client factory for non-mainnet chains (Botanix, Ink, ...).
 * Ethereum mainnet has its own richer helper in ./ethereum.ts.
 *
 * RPC resolution is env-first: if `process.env[rpcEnv]` is set (a dedicated
 * QuickNode/Alchemy endpoint in production) it is used exclusively;
 * otherwise the chain's public fallbacks rotate. Historical reads
 * (readShareGrowth) need archive state — public RPCs often lack it, which
 * is the main reason to set the env var in production.
 */

import {
  createPublicClient,
  defineChain,
  fallback,
  http as viemHttp,
  type Address,
  type PublicClient,
} from "viem";

export interface EvmChainConfig {
  id: number;
  name: string;
  /** Env var holding a dedicated RPC URL, e.g. `BITCOINYIELD_RPC_BOTANIX`. */
  rpcEnv: string;
  /** Public RPCs used when the env var is unset. */
  fallbackRpcs: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Multicall3 address if deployed — required for `client.multicall()`. */
  multicall3?: Address;
}

const clients = new Map<number, PublicClient>();
const warned = new Set<number>();

export function getEvmClient(config: EvmChainConfig): PublicClient {
  const cached = clients.get(config.id);
  if (cached) return cached;

  const dedicated = process.env[config.rpcEnv];

  if (!dedicated && !warned.has(config.id)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bitcoinyield] ${config.rpcEnv} not set — using public ${config.name} RPC fallbacks.\n` +
        `  Historical reads may fail without a dedicated archive endpoint.`,
    );
    warned.add(config.id);
  }

  // Per-transport retryCount stays 0 in the fallback path: the fallback()
  // wrapper already retries across transports, and stacking both multiplies
  // into dozens of attempts during a broad outage.
  const transports = dedicated
    ? [viemHttp(dedicated, { retryCount: 3, timeout: 15_000 })]
    : config.fallbackRpcs.map((url) =>
        viemHttp(url, { retryCount: 0, timeout: 10_000 }),
      );

  const chain = defineChain({
    id: config.id,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: { http: dedicated ? [dedicated] : config.fallbackRpcs },
    },
    ...(config.multicall3
      ? { contracts: { multicall3: { address: config.multicall3 } } }
      : {}),
  });

  const client = createPublicClient({
    chain,
    transport: fallback(transports, { rank: false, retryCount: 2 }),
  }) as PublicClient;

  clients.set(config.id, client);
  return client;
}

/** Reset cached clients. For tests only. */
export function _resetEvmClients(): void {
  clients.clear();
  warned.clear();
}
