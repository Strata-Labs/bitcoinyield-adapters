/**
 * Lombard Finance adapter.
 *
 * TVL: LBTC ERC-20 totalSupply on Ethereum mainnet only — i.e. circulating
 *      LBTC on Ethereum (~$650M), NOT total BTC backing. LBTC is natively
 *      issued cross-chain (Base, BNB, Sonic, Sui, ...) via CCIP burn-and-mint,
 *      so this undercounts the protocol-wide figure (~$960M): total custodied
 *      BTC backing all LBTC. That can't be reproduced from EVM totalSupply
 *      reads alone — summing every EVM chain still only reaches ~$673M; the
 *      rest is on non-EVM chains (Sui). Getting it means paging Lombard's
 *      `/api/v1/addresses` custody list and summing each BTC balance. Left
 *      Ethereum-only intentionally.
 * APR: Lombard's own analytics endpoint.
 */

import {
  defineAdapter,
  ethereum,
  http,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const LBTC_ADDRESS = "0x8236a87084f8B84306f72007F36F2618A5634494" as const;
const LOMBARD_APY_URL =
  "https://mainnet.prod.lombard.finance/api/v1/analytics/estimated-apy";

interface LombardApyResponse {
  lbtc_estimated_apy: number;
}

export default defineAdapter({
  slug: "lombard-finance",
  name: "Lombard",
  url: "https://www.lombard.finance/app/stake/",
  category: "yield-bearing",
  custody: "multisig",
  requires: { rpc: ["ethereum"] },

  async fetch() {
    const [calls, apyData] = await Promise.all([
      ethereum.multicall([
        {
          address: LBTC_ADDRESS,
          abi: ethereum.erc20Abi,
          functionName: "totalSupply",
        },
        {
          address: LBTC_ADDRESS,
          abi: ethereum.erc20Abi,
          functionName: "decimals",
        },
      ]),
      http.get<LombardApyResponse>(LOMBARD_APY_URL),
    ]);

    const supply = calls[0];
    const decimals = calls[1];
    if (supply?.status !== "success" || decimals?.status !== "success") {
      throw new Error(
        `LBTC multicall failed: supply=${supply?.status} decimals=${decimals?.status}`,
      );
    }

    return [
      {
        symbol: "LBTC",
        tvlBtc: math.fromUnits(
          supply.result as bigint,
          decimals.result as number,
        ),
        apr: math.toPercent(
          requirePositive(apyData.lbtc_estimated_apy, "lbtc_estimated_apy"),
        ),
        metadata: { contractAddress: LBTC_ADDRESS, decimals: decimals.result },
      },
    ];
  },
});
