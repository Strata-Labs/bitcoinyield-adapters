import {
  createPublicClient,
  fallback,
  http as viemHttp,
  type Address,
  type Abi,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'

const PUBLIC_FALLBACKS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
]

let client: PublicClient | null = null
let warnedAboutFallback = false

/**
 * Shared mainnet viem client. Use `readContract` / `multicall` below for
 * the common case; reach for the raw client only when you need features
 * not wrapped here (e.g. historical reads via `blockNumber`).
 */
export function getClient(): PublicClient {
  if (client) return client

  const rpcUrl = process.env.BITCOINYIELD_RPC_ETHEREUM

  if (!rpcUrl && !warnedAboutFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[bitcoinyield] BITCOINYIELD_RPC_ETHEREUM not set — using public RPC fallbacks.\n' +
        '  For better reliability set a free Alchemy/Infura key.',
    )
    warnedAboutFallback = true
  }

  const transports = rpcUrl
    ? [viemHttp(rpcUrl, { retryCount: 3, timeout: 15_000 })]
    : PUBLIC_FALLBACKS.map((url) =>
        viemHttp(url, { retryCount: 1, timeout: 10_000 }),
      )

  client = createPublicClient({
    chain: mainnet,
    transport: fallback(transports, { rank: false, retryCount: 2 }),
  }) as PublicClient

  return client
}

export async function readContract<T = unknown>(args: {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}): Promise<T> {
  const c = getClient()
  return (await c.readContract({
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  })) as T
}

export async function multicall(
  contracts: Array<{
    address: Address
    abi: Abi
    functionName: string
    args?: readonly unknown[]
  }>,
) {
  const c = getClient()
  return await c.multicall({ contracts })
}

export async function getBlockNumber(): Promise<bigint> {
  const c = getClient()
  return await c.getBlockNumber()
}

/** Reset the cached client. For tests only. */
export function _resetClient(): void {
  client = null
  warnedAboutFallback = false
}

export const erc20Abi = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const erc4626VaultAbi = [
  {
    inputs: [],
    name: 'totalAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'asset',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'shares', type: 'uint256' }],
    name: 'convertToAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'receiver', type: 'address' }],
    name: 'maxDeposit',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const pausableAbi = [
  {
    inputs: [],
    name: 'paused',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
