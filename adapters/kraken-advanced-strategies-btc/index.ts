import {
  createPublicClient,
  defineChain,
  fallback,
  http as viemHttp,
  type Address,
  type Chain,
} from "viem";
import { defineAdapter, math, requirePositive } from "@bitcoinyield/adapters";

const SECONDS_PER_DAY = 86_400;
const BLOCKS_PER_7D_INK = 604_800n;

const PUBLIC_INK_RPCS = [
  "https://rpc-gel.inkonchain.com",
  "https://rpc-qnd.inkonchain.com",
] as const;

const ink = defineChain({
  id: 57073,
  name: "Ink",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [...PUBLIC_INK_RPCS] },
  },
  blockExplorers: {
    default: { name: "Ink Explorer", url: "https://explorer.inkonchain.com" },
  },
}) satisfies Chain;

const vaultAbi = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const accountantAbi = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRate",
    outputs: [{ name: "rate", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "accountantState",
    outputs: [
      { name: "payoutAddress", type: "address" },
      { name: "highwaterMark", type: "uint96" },
      { name: "feesOwedInBase", type: "uint128" },
      { name: "totalSharesLastUpdate", type: "uint128" },
      { name: "exchangeRate", type: "uint96" },
      { name: "allowedExchangeRateChangeUpper", type: "uint16" },
      { name: "allowedExchangeRateChangeLower", type: "uint16" },
      { name: "lastUpdateTimestamp", type: "uint64" },
      { name: "isPaused", type: "bool" },
      { name: "minimumUpdateDelayInSeconds", type: "uint24" },
      { name: "platformFee", type: "uint16" },
      { name: "performanceFee", type: "uint16" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])];
}

function getInkClient(privateRpc: string | undefined) {
  const transports = uniqueDefined([privateRpc, ...PUBLIC_INK_RPCS]).map(
    (url) => viemHttp(url, { retryCount: 2, timeout: 15_000 }),
  );

  return createPublicClient({
    chain: ink,
    transport: fallback(transports, { rank: false, retryCount: 2 }),
  });
}

function timestampToIso(timestamp: bigint | number): string {
  return new Date(Number(timestamp) * 1000).toISOString();
}

export default defineAdapter({
  slug: "kraken-advanced-strategies-btc",
  name: "Kraken Advanced Strategies BTC",
  url: "https://www.kraken.com/",
  category: "yield-bearing",
  custody: "custodial",
  requires: { rpc: ["ink"], secrets: ["RPC_INK"] },

  async fetch(ctx) {
    const vaultAddress =
      "0x7Dee0120739b7ec048B469939EFB178ADbbB19B2" as Address;
    const accountantAddress =
      "0x4Bb6C416a00561ad6657110b76552c42d55Ff1d6" as Address;

    const client = getInkClient(ctx.env.RPC_INK);
    const latestBlock = await client.getBlock({ blockTag: "latest" });
    const historicalBlockNumber = latestBlock.number - BLOCKS_PER_7D_INK;

    const [
      historicalBlock,
      shareDecimals,
      rateDecimals,
      totalSupplyRaw,
      currentRateRaw,
      historicalRateRaw,
      accountantState,
    ] = await Promise.all([
      client.getBlock({ blockNumber: historicalBlockNumber }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "decimals",
        blockNumber: latestBlock.number,
      }),
      client.readContract({
        address: accountantAddress,
        abi: accountantAbi,
        functionName: "decimals",
        blockNumber: latestBlock.number,
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "totalSupply",
        blockNumber: latestBlock.number,
      }),
      client.readContract({
        address: accountantAddress,
        abi: accountantAbi,
        functionName: "getRate",
        blockNumber: latestBlock.number,
      }),
      client.readContract({
        address: accountantAddress,
        abi: accountantAbi,
        functionName: "getRate",
        blockNumber: historicalBlockNumber,
      }),
      client.readContract({
        address: accountantAddress,
        abi: accountantAbi,
        functionName: "accountantState",
        blockNumber: latestBlock.number,
      }),
    ]);

    const rateScale = 10n ** BigInt(rateDecimals);
    const tvlRaw = (totalSupplyRaw * currentRateRaw) / rateScale;
    const tvlBtc = requirePositive(
      math.fromUnits(tvlRaw, shareDecimals),
      "tvlBtc",
    );

    const currentExchangeRate = requirePositive(
      math.fromUnits(currentRateRaw, rateDecimals),
      "currentExchangeRate",
    );
    const historicalExchangeRate = requirePositive(
      math.fromUnits(historicalRateRaw, rateDecimals),
      "historicalExchangeRate",
    );

    const elapsedDays =
      Number(latestBlock.timestamp - historicalBlock.timestamp) /
      SECONDS_PER_DAY;
    if (elapsedDays <= 0) {
      throw new Error(`Invalid 7d window: elapsedDays=${elapsedDays}`);
    }

    const growth = math.div(currentExchangeRate, historicalExchangeRate);
    const simpleApr7d = math.mul(
      math.mul(math.sub(growth, 1), math.div(365, elapsedDays)),
      100,
    );
    const compoundedApy7d = (Math.pow(growth, 365 / elapsedDays) - 1) * 100;
    if (!Number.isFinite(compoundedApy7d)) {
      throw new Error(`Invalid compounded APY: ${compoundedApy7d}`);
    }

    const [
      ,
      highwaterMarkRaw,
      feesOwedInBaseRaw,
      totalSharesLastUpdateRaw,
      stateExchangeRateRaw,
      allowedExchangeRateChangeUpper,
      allowedExchangeRateChangeLower,
      lastUpdateTimestamp,
      isPaused,
      minimumUpdateDelayInSeconds,
      platformFeeBps,
      performanceFeeBps,
    ] = accountantState;

    return [
      {
        symbol: "sentoraBTC",
        tvlBtc,
        apr: compoundedApy7d,
        metadata: {
          chain: "ink",
          chainId: ink.id,
          vaultAddress,
          accountantAddress,
          shareDecimals,
          rateDecimals,
          totalSupplyRaw: totalSupplyRaw.toString(),
          totalSupply: math.fromUnits(totalSupplyRaw, shareDecimals),
          currentRateRaw: currentRateRaw.toString(),
          currentExchangeRate,
          historicalRateRaw: historicalRateRaw.toString(),
          historicalExchangeRate,
          windowTargetDays: 7,
          windowActualDays: elapsedDays,
          latestBlock: latestBlock.number.toString(),
          latestBlockTimestamp: timestampToIso(latestBlock.timestamp),
          historicalBlock: historicalBlockNumber.toString(),
          historicalBlockTimestamp: timestampToIso(historicalBlock.timestamp),
          growth,
          simpleApr7d,
          compoundedApy7d,
          aprSource: "7d-onchain-getRate-compounded",
          accountantStateExchangeRate: math.fromUnits(
            stateExchangeRateRaw,
            rateDecimals,
          ),
          highwaterMark: math.fromUnits(highwaterMarkRaw, rateDecimals),
          feesOwedInBase: math.fromUnits(feesOwedInBaseRaw, shareDecimals),
          totalSharesLastUpdate: math.fromUnits(
            totalSharesLastUpdateRaw,
            shareDecimals,
          ),
          allowedExchangeRateChangeUpper: Number(
            allowedExchangeRateChangeUpper,
          ),
          allowedExchangeRateChangeLower: Number(
            allowedExchangeRateChangeLower,
          ),
          lastUpdateTimestamp: Number(lastUpdateTimestamp),
          lastUpdateTime: timestampToIso(lastUpdateTimestamp),
          isPaused,
          minimumUpdateDelayInSeconds: Number(minimumUpdateDelayInSeconds),
          platformFeeBps: Number(platformFeeBps),
          performanceFeeBps: Number(performanceFeeBps),
        },
      },
    ];
  },
});
