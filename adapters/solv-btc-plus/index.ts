/**
 * Solv BTC+ adapter — on-chain SolvBTCYieldTokenOracleForSFT reads.
 *
 * The retired stats endpoint reports a stale aggregate. BTC+ yield is encoded
 * in the NAV oracle Solv wires to each deployed yield token, so this adapter
 * derives APY from trailing NAV growth and TVL from token supply * current NAV.
 */

import { defineAdapter, math, requirePositive } from "@bitcoinyield/adapters";
import {
  createPublicClient,
  fallback,
  http as viemHttp,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import {
  arbitrum,
  avalanche,
  base,
  berachain,
  bob,
  bsc,
  hyperEvm,
  mainnet,
} from "viem/chains";

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
const HEADLINE_WINDOW_DAYS = 30;
const COMPARISON_WINDOW_DAYS = 7;
const HEADLINE_WINDOW_SECONDS = HEADLINE_WINDOW_DAYS * SECONDS_PER_DAY;
const COMPARISON_WINDOW_SECONDS = COMPARISON_WINDOW_DAYS * SECONDS_PER_DAY;
const FRESH_NAV_MAX_AGE_SECONDS = 3 * SECONDS_PER_DAY;
const PRIMARY_READ_TIMEOUT_MS = 30_000;
const OPTIONAL_READ_TIMEOUT_MS = 12_000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const BTC_PLUS_SHARED_TOKEN =
  "0x4Ca70811E831db42072CBa1f0d03496EF126fAad" as Address;

interface BtcPlusDeployment {
  key: string;
  label: string;
  chain: Chain;
  token: Address;
  oracleForSft: Address;
  primary: boolean;
  rpcEnv: string;
  publicRpcs: string[];
}

interface SftOracleConfig {
  poolId: Hex;
  sft: Address;
  sftSlot: bigint;
  oracle: Address;
}

interface NavPoint {
  navRaw: bigint;
  navTime: number;
}

interface DeploymentSnapshot {
  key: string;
  label: string;
  chainId: number;
  token: Address;
  oracleForSft: Address;
  navOracle: Address;
  poolId: Hex;
  sft: Address;
  sftSlot: string;
  totalSupply: number;
  tvlBtc: number;
  nav: number;
  navTime: number;
  navTimeIso: string;
  previousNav7d: number;
  previousNav7dTime: number;
  previousNav7dTimeIso: string;
  previousNav30d: number;
  previousNav30dTime: number;
  previousNav30dTimeIso: string;
  apy7d: number;
  apy30d: number;
  isFresh: boolean;
  primary: boolean;
}

interface SnapshotInput {
  tvlBtc: number;
  apy7d: number;
  apy30d: number;
  navTime: number;
  isFresh: boolean;
}

interface SnapshotAggregate {
  tvlBtc: number;
  apy7d: number;
  apy30d: number;
  freshTvlBtc: number;
}

const tokenAbi = [
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const solvBtcYieldTokenOracleForSftAbi = [
  {
    inputs: [{ name: "erc20", type: "address" }],
    name: "navDecimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "erc20", type: "address" }],
    name: "sftOracles",
    outputs: [
      {
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "sft", type: "address" },
          { name: "sftSlot", type: "uint256" },
          { name: "oracle", type: "address" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const sftNavOracleAbi = [
  {
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "time", type: "uint256" },
    ],
    name: "getSubscribeNav",
    outputs: [
      { name: "nav", type: "uint256" },
      { name: "navTime", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const DEPLOYMENTS: BtcPlusDeployment[] = [
  {
    key: "ethereum",
    label: "Ethereum",
    chain: mainnet,
    token: "0xCEa2DAf93617B97504E05AFfc5BCF9b3922D3034",
    oracleForSft: "0x3c98C54808830DC0DdEc56BEA89c69FFa0569AC9",
    primary: true,
    rpcEnv: "BITCOINYIELD_RPC_ETHEREUM",
    publicRpcs: [
      "https://eth-mainnet.public.blastapi.io",
      "https://eth.drpc.org",
      "https://ethereum.publicnode.com",
      "https://rpc.mevblocker.io",
    ],
  },
  {
    key: "bsc",
    label: "BNB Chain",
    chain: bsc,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0xECd36716f0f9A1045a176DB8B20aBa6ecCBF5D94",
    primary: true,
    rpcEnv: "BITCOINYIELD_RPC_BSC",
    publicRpcs: [
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed.binance.org",
    ],
  },
  {
    key: "base",
    label: "Base",
    chain: base,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0xDe412e1a2AA965207e65d6594DF48F5568D89D93",
    primary: true,
    rpcEnv: "BITCOINYIELD_RPC_BASE",
    publicRpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  },
  {
    key: "arbitrum",
    label: "Arbitrum",
    chain: arbitrum,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0x94e768B546f2580f2B47249F278e554ff8a9077e",
    primary: true,
    rpcEnv: "BITCOINYIELD_RPC_ARBITRUM",
    publicRpcs: [
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arb1.arbitrum.io/rpc",
    ],
  },
  {
    key: "avalanche",
    label: "Avalanche",
    chain: avalanche,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0xd157B70F917fEf3A59502b9128feCA911dEbC864",
    primary: false,
    rpcEnv: "BITCOINYIELD_RPC_AVALANCHE",
    publicRpcs: [
      "https://avalanche-c-chain-rpc.publicnode.com",
      "https://api.avax.network/ext/bc/C/rpc",
    ],
  },
  {
    key: "bob",
    label: "BOB",
    chain: bob,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0x5b60F7e24Ac48C1146d1aedb6a72B62c83378730",
    primary: false,
    rpcEnv: "BITCOINYIELD_RPC_BOB",
    publicRpcs: ["https://rpc.gobob.xyz"],
  },
  {
    key: "berachain",
    label: "Berachain",
    chain: berachain,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0x689020287883DfeBa3382158Ade309a5963952BA",
    primary: false,
    rpcEnv: "BITCOINYIELD_RPC_BERACHAIN",
    publicRpcs: ["https://rpc.berachain.com"],
  },
  {
    key: "hyperevm",
    label: "HyperEVM",
    chain: hyperEvm,
    token: BTC_PLUS_SHARED_TOKEN,
    oracleForSft: "0x600Fb9600444fb8373bF9A112Ae0977F6676c564",
    primary: false,
    rpcEnv: "BITCOINYIELD_RPC_HYPEREVM",
    publicRpcs: ["https://rpc.hyperliquid.xyz/evm"],
  },
];

export function calculateNavApy(input: {
  currentNavRaw: bigint;
  previousNavRaw: bigint;
  elapsedSeconds: number;
}): number {
  if (input.elapsedSeconds <= 0) return 0;

  const currentNav = math.fromUnits(input.currentNavRaw, 18);
  const previousNav = math.fromUnits(input.previousNavRaw, 18);
  if (currentNav <= 0 || previousNav <= 0) return 0;

  const growth = math.div(currentNav, previousNav);
  if (growth <= 0) return 0;

  return math.mul(
    Math.pow(growth, SECONDS_PER_YEAR / input.elapsedSeconds) - 1,
    100,
  );
}

export function calculateUnderlyingBtc(input: {
  totalSupplyRaw: bigint;
  tokenDecimals: number;
  navRaw: bigint;
  navDecimals: number;
}): number {
  const totalSupply = math.fromUnits(input.totalSupplyRaw, input.tokenDecimals);
  const nav = math.fromUnits(input.navRaw, input.navDecimals);
  return math.mul(totalSupply, nav);
}

export function aggregateSnapshots(
  snapshots: SnapshotInput[],
): SnapshotAggregate {
  const tvlBtc = math.add(...snapshots.map((snapshot) => snapshot.tvlBtc));
  const freshSnapshots = snapshots.filter(
    (snapshot) => snapshot.isFresh && snapshot.tvlBtc > 0,
  );
  const freshTvlBtc = math.add(
    ...freshSnapshots.map((snapshot) => snapshot.tvlBtc),
  );

  const weightedApy7dNumerator = math.add(
    ...freshSnapshots.map((snapshot) =>
      math.mul(snapshot.tvlBtc, snapshot.apy7d),
    ),
  );
  const weightedApy30dNumerator = math.add(
    ...freshSnapshots.map((snapshot) =>
      math.mul(snapshot.tvlBtc, snapshot.apy30d),
    ),
  );

  return {
    tvlBtc,
    freshTvlBtc,
    apy7d: math.div(weightedApy7dNumerator, freshTvlBtc),
    apy30d: math.div(weightedApy30dNumerator, freshTvlBtc),
  };
}

export default defineAdapter({
  slug: "solv-btc-plus",
  name: "Solv BTC+",
  url: "https://app.solv.finance/btc+?network=bitcoin-mainnet",
  category: "yield-bearing",
  custody: "multisig",
  requires: {
    rpc: [
      "ethereum",
      "bsc",
      "base",
      "arbitrum",
      "avalanche",
      "bob",
      "berachain",
      "hyperevm",
    ],
  },

  async fetch() {
    const now = Math.floor(Date.now() / 1000);
    const previous7d = now - COMPARISON_WINDOW_SECONDS;
    const previous30d = now - HEADLINE_WINDOW_SECONDS;

    const reads = await Promise.allSettled(
      DEPLOYMENTS.map((deployment) => {
        const timeoutMs = deployment.primary
          ? PRIMARY_READ_TIMEOUT_MS
          : OPTIONAL_READ_TIMEOUT_MS;

        return withTimeout(
          fetchDeploymentSnapshot(deployment, now, previous7d, previous30d),
          timeoutMs,
          `${deployment.key} BTC+ read timed out after ${timeoutMs}ms`,
        );
      }),
    );

    const snapshots: DeploymentSnapshot[] = [];
    const failures: Array<{ chain: string; primary: boolean; reason: string }> =
      [];

    reads.forEach((read, index) => {
      const deployment = DEPLOYMENTS[index];
      if (!deployment) return;

      if (read.status === "fulfilled") {
        snapshots.push(read.value);
        return;
      }

      failures.push({
        chain: deployment.key,
        primary: deployment.primary,
        reason:
          read.reason instanceof Error
            ? read.reason.message
            : String(read.reason),
      });
    });

    const primaryFailures = failures.filter((failure) => failure.primary);
    if (primaryFailures.length > 0) {
      throw new Error(
        `Solv BTC+ primary chain read failed: ${primaryFailures
          .map((failure) => `${failure.chain}: ${failure.reason}`)
          .join("; ")}`,
      );
    }

    if (snapshots.length === 0) {
      throw new Error("Solv BTC+ on-chain oracle returned no snapshots");
    }

    const aggregate = aggregateSnapshots(snapshots);
    requirePositive(aggregate.tvlBtc, "tvlBtc");
    requirePositive(aggregate.freshTvlBtc, "freshTvlBtc");
    const apy30d = requireNonNegative(aggregate.apy30d, "apy30d");
    const apy7d = requireNonNegative(aggregate.apy7d, "apy7d");

    return [
      {
        symbol: "BTC+",
        tvlBtc: aggregate.tvlBtc,
        apr: apy30d,
        metadata: {
          source: "onchain-solv-nav-oracle",
          rateKind: "nav-apy",
          windowDays: HEADLINE_WINDOW_DAYS,
          headlineWindowDays: HEADLINE_WINDOW_DAYS,
          comparisonWindowDays: COMPARISON_WINDOW_DAYS,
          apy7d,
          apy30d,
          freshNavMaxAgeDays: FRESH_NAV_MAX_AGE_SECONDS / SECONDS_PER_DAY,
          freshTvlBtc: aggregate.freshTvlBtc,
          deployments: snapshots.map(toMetadataSnapshot),
          failedDeployments: failures.filter((failure) => !failure.primary),
        },
      },
    ];
  },
});

async function fetchDeploymentSnapshot(
  deployment: BtcPlusDeployment,
  now: number,
  previous7d: number,
  previous30d: number,
): Promise<DeploymentSnapshot> {
  const client = getClient(deployment);

  const [totalSupplyRaw, tokenDecimals, navDecimals, sftOracleValue] =
    await Promise.all([
      client.readContract({
        address: deployment.token,
        abi: tokenAbi,
        functionName: "totalSupply",
      }),
      client.readContract({
        address: deployment.token,
        abi: tokenAbi,
        functionName: "decimals",
      }),
      client.readContract({
        address: deployment.oracleForSft,
        abi: solvBtcYieldTokenOracleForSftAbi,
        functionName: "navDecimals",
        args: [deployment.token],
      }),
      client.readContract({
        address: deployment.oracleForSft,
        abi: solvBtcYieldTokenOracleForSftAbi,
        functionName: "sftOracles",
        args: [deployment.token],
      }),
    ]);

  const sftOracle = normalizeSftOracle(sftOracleValue);
  assertConfiguredOracle(deployment, sftOracle);

  const [currentNavValue, previousNav7dValue, previousNav30dValue] =
    await Promise.all([
      client.readContract({
        address: sftOracle.oracle,
        abi: sftNavOracleAbi,
        functionName: "getSubscribeNav",
        args: [sftOracle.poolId, BigInt(now)],
      }),
      client.readContract({
        address: sftOracle.oracle,
        abi: sftNavOracleAbi,
        functionName: "getSubscribeNav",
        args: [sftOracle.poolId, BigInt(previous7d)],
      }),
      client.readContract({
        address: sftOracle.oracle,
        abi: sftNavOracleAbi,
        functionName: "getSubscribeNav",
        args: [sftOracle.poolId, BigInt(previous30d)],
      }),
    ]);

  const current = normalizeNavPoint(currentNavValue);
  const prior7d = normalizeNavPoint(previousNav7dValue);
  const prior30d = normalizeNavPoint(previousNav30dValue);
  const elapsed7dSeconds = current.navTime - prior7d.navTime;
  const elapsed30dSeconds = current.navTime - prior30d.navTime;
  const isFresh = now - current.navTime <= FRESH_NAV_MAX_AGE_SECONDS;

  const apy7d =
    isFresh && elapsed7dSeconds > 0
      ? calculateNavApy({
          currentNavRaw: current.navRaw,
          previousNavRaw: prior7d.navRaw,
          elapsedSeconds: elapsed7dSeconds,
        })
      : 0;
  const apy30d =
    isFresh && elapsed30dSeconds > 0
      ? calculateNavApy({
          currentNavRaw: current.navRaw,
          previousNavRaw: prior30d.navRaw,
          elapsedSeconds: elapsed30dSeconds,
        })
      : 0;

  const tvlBtc = calculateUnderlyingBtc({
    totalSupplyRaw,
    tokenDecimals,
    navRaw: current.navRaw,
    navDecimals,
  });

  return {
    key: deployment.key,
    label: deployment.label,
    chainId: deployment.chain.id,
    token: deployment.token,
    oracleForSft: deployment.oracleForSft,
    navOracle: sftOracle.oracle,
    poolId: sftOracle.poolId,
    sft: sftOracle.sft,
    sftSlot: sftOracle.sftSlot.toString(),
    totalSupply: math.fromUnits(totalSupplyRaw, tokenDecimals),
    tvlBtc,
    nav: math.fromUnits(current.navRaw, navDecimals),
    navTime: current.navTime,
    navTimeIso: toIso(current.navTime),
    previousNav7d: math.fromUnits(prior7d.navRaw, navDecimals),
    previousNav7dTime: prior7d.navTime,
    previousNav7dTimeIso: toIso(prior7d.navTime),
    previousNav30d: math.fromUnits(prior30d.navRaw, navDecimals),
    previousNav30dTime: prior30d.navTime,
    previousNav30dTimeIso: toIso(prior30d.navTime),
    apy7d,
    apy30d,
    isFresh,
    primary: deployment.primary,
  };
}

function getClient(deployment: BtcPlusDeployment) {
  const rpcUrls = unique([
    process.env[deployment.rpcEnv],
    ...deployment.publicRpcs,
    ...deployment.chain.rpcUrls.default.http,
  ]);

  return createPublicClient({
    chain: deployment.chain,
    transport: fallback(
      rpcUrls.map((url) => viemHttp(url, { retryCount: 0, timeout: 10_000 })),
      { rank: false, retryCount: 1 },
    ),
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeSftOracle(value: unknown): SftOracleConfig {
  const record = value as Partial<SftOracleConfig>;
  if (
    record.poolId &&
    record.sft &&
    record.sftSlot !== undefined &&
    record.oracle
  ) {
    return {
      poolId: record.poolId,
      sft: record.sft,
      sftSlot: record.sftSlot,
      oracle: record.oracle,
    };
  }

  const tuple = value as readonly unknown[];
  return {
    poolId: tuple[0] as Hex,
    sft: tuple[1] as Address,
    sftSlot: tuple[2] as bigint,
    oracle: tuple[3] as Address,
  };
}

function normalizeNavPoint(value: unknown): NavPoint {
  const record = value as { nav?: bigint; navTime?: bigint };
  if (record.nav !== undefined && record.navTime !== undefined) {
    return { navRaw: record.nav, navTime: toUnixSeconds(record.navTime) };
  }

  const tuple = value as readonly unknown[];
  return {
    navRaw: tuple[0] as bigint,
    navTime: toUnixSeconds(tuple[1] as bigint),
  };
}

function assertConfiguredOracle(
  deployment: BtcPlusDeployment,
  oracle: SftOracleConfig,
): void {
  if (!oracle.poolId || oracle.poolId === ZERO_BYTES32) {
    throw new Error(`${deployment.key} BTC+ oracle has no poolId`);
  }

  if (
    !oracle.oracle ||
    oracle.oracle.toLowerCase() === ZERO_ADDRESS.toLowerCase()
  ) {
    throw new Error(`${deployment.key} BTC+ oracle has no NAV oracle address`);
  }
}

function toMetadataSnapshot(
  snapshot: DeploymentSnapshot,
): Record<string, unknown> {
  return {
    chain: snapshot.key,
    label: snapshot.label,
    chainId: snapshot.chainId,
    primary: snapshot.primary,
    token: snapshot.token,
    oracleForSft: snapshot.oracleForSft,
    navOracle: snapshot.navOracle,
    poolId: snapshot.poolId,
    sft: snapshot.sft,
    sftSlot: snapshot.sftSlot,
    totalSupply: snapshot.totalSupply,
    tvlBtc: snapshot.tvlBtc,
    nav: snapshot.nav,
    navTime: snapshot.navTime,
    navTimeIso: snapshot.navTimeIso,
    previousNav7d: snapshot.previousNav7d,
    previousNav7dTime: snapshot.previousNav7dTime,
    previousNav7dTimeIso: snapshot.previousNav7dTimeIso,
    previousNav30d: snapshot.previousNav30d,
    previousNav30dTime: snapshot.previousNav30dTime,
    previousNav30dTimeIso: snapshot.previousNav30dTimeIso,
    apy7d: snapshot.apy7d,
    apy30d: snapshot.apy30d,
    isFresh: snapshot.isFresh,
  };
}

function toUnixSeconds(value: bigint): number {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error(`Invalid NAV timestamp: ${value.toString()}`);
  }
  return timestamp;
}

function toIso(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function unique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function requireNonNegative(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Expected non-negative finite number for ${name}`);
  }
  return value;
}
