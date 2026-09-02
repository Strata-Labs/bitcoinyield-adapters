/**
 * Kraken Bitcoin Earn adapter — BoringVault on Ink L2 (chain id 57073).
 *
 * TVL: vault totalSupply × accountant getRate (rate = BTC per share).
 * APY: 7-day compounded rate growth via readShareGrowth, matching the
 *      "Net APY (7D)" window Kraken's public Dune dashboard reports. When
 *      archive history is unavailable, TVL persists with rate unavailable;
 *      a seed rate is never substituted.
 */

import {
  defineAdapter,
  createRate,
  getEvmClient,
  math,
  requirePositive,
  readShareGrowth,
  type EvmChainConfig,
} from "@bitcoinyield/adapters";

const BORING_VAULT = "0x7Dee0120739b7ec048B469939EFB178ADbbB19B2";
const ACCOUNTANT = "0x4Bb6C416a00561ad6657110b76552c42d55Ff1d6";

// Ink produces ~1 block/sec, so 604_800 blocks ≈ 7 days. readShareGrowth
// annualizes by actual block timestamps, so drift only widens the window.
const INK_BLOCKS_7D = 604_800n;

const INK: EvmChainConfig = {
  id: 57073,
  name: "Ink",
  rpcEnv: "BITCOINYIELD_RPC_INK",
  fallbackRpcs: ["https://rpc-gel.inkonchain.com", "https://ink.drpc.org"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const vaultAbi = [
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

const accountantAbi = [
  {
    inputs: [],
    name: "getRate",
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

export default defineAdapter({
  slug: "kraken-bitcoin-earn",
  name: "Kraken Bitcoin Earn",
  url: "https://www.kraken.com/earn",
  category: "yield-bearing",
  custody: "custodial",
  requires: { rpc: ["ink"] },

  async fetch() {
    const client = getEvmClient(INK);

    const [totalSupply, shareDecimals, rateDecimals] = await Promise.all([
      client.readContract({
        address: BORING_VAULT,
        abi: vaultAbi,
        functionName: "totalSupply",
      }),
      client.readContract({
        address: BORING_VAULT,
        abi: vaultAbi,
        functionName: "decimals",
      }),
      client.readContract({
        address: ACCOUNTANT,
        abi: accountantAbi,
        functionName: "decimals",
      }),
    ]);

    const growth = await readShareGrowth({
      client,
      address: ACCOUNTANT,
      abi: accountantAbi,
      functionName: "getRate",
      blocksBack: INK_BLOCKS_7D,
      decimals: Number(rateDecimals),
    });

    const shares = math.fromUnits(totalSupply, Number(shareDecimals));
    const rateNow = requirePositive(growth.sharePriceNow, "getRate");
    const tvlBtc = requirePositive(math.mul(shares, rateNow), "tvlBtc");

    const rate = growth.hasBaseline
      ? createRate({
          type: "apy",
          value: growth.apy,
          basis: "calculated",
          source: `ink:${ACCOUNTANT}.getRate`,
          windowDays: growth.elapsedDays,
          compounding: {
            method: "automatic",
            evidence: {
              kind: "exchange_rate",
              field: "getRate()",
              reference: `ink:${ACCOUNTANT}`,
            },
          },
          simpleAprPercent: growth.apr,
        })
      : null;

    return [
      {
        symbol: "BTC",
        tvlBtc,
        rate,
        ...(!rate && {
          rateUnavailableReason:
            "Archive rate history unavailable; seed rates are not publishable",
        }),
        metadata: {
          vaultAddress: BORING_VAULT,
          accountantAddress: ACCOUNTANT,
          chainId: INK.id,
          exchangeRateBtcPerShare: rateNow,
          rate7dAgo: growth.sharePriceThen,
          windowDays: growth.elapsedDays,
          rateSource: growth.hasBaseline ? "onchain-7d" : "unavailable",
        },
      },
    ];
  },
});
