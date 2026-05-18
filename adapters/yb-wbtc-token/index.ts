/**
 * Yield Basis YB-WBTC Token (Staked) vault — on-chain reads.
 *
 * Same protocol as `yb-wbtc-yieldbearing` but covers the staked variant —
 * users who lock their yb-WBTC into the LiquidityGauge to earn $YB
 * emissions on top of the underlying LP trading-fee yield.
 *
 * Per-market addresses (from Yield Basis docs):
 *   LT (yb-WBTC)      : 0xfBF3C16676055776Ab9B286492D8f13e30e2E763
 *   Gauge             : 0xbc56e3edB67b56d598aCE07668b138815F45d7aa
 *   GaugeController   : 0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21
 *   Underlying        : 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 (WBTC, 8 decimals)
 *
 * APR has two components:
 *   - `baseApr`      ← 30-day share-price growth, same `pricePerShare` as
 *                      the yield-bearing variant. (Trading-fee yield.)
 *   - `emissionsApr` ← projected $YB token emissions over the next hour,
 *                      annualized, valued at CoinGecko's $YB spot.
 *   - `apr` (headline) = baseApr + emissionsApr
 *
 * The split lives in metadata so the platform can render either component
 * independently if its UI wants to match the upstream dashboard's
 * "Real Yield" / "Token Yield" two-column display.
 *
 * Emissions math:
 *   ybPerSec   = (preview_emissions(gauge, now+1h) - preview_emissions(gauge, now)) / 3600
 *   ybPerYear  = ybPerSec × 31_536_000
 *   stakedTvl  = LT.updated_balances.staked × pricePerShare × btcPrice (USD)
 *   apr%       = ybPerYear × ybPriceUsd / stakedTvlUsd × 100
 *
 * Important: the staked-share denominator is `LT.updated_balances.staked`,
 * NOT `gauge.totalSupply()`. The two differ because the gauge wraps yb-WBTC
 * into a separate ERC-4626 share, and the boost / share-conversion math
 * makes them diverge. Using the LT's staked count matches the upstream
 * dashboard's emissions APR to within 0.1%.
 */

import {
  defineAdapter,
  ethereum,
  math,
  prices,
  requirePositive,
  readShareGrowth,
  BLOCKS_PER_30D,
} from '@bitcoinyield/adapters'

const LT = '0xfBF3C16676055776Ab9B286492D8f13e30e2E763'
const GAUGE = '0xbc56e3edB67b56d598aCE07668b138815F45d7aa'
const GAUGE_CONTROLLER = '0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21'
const ASSET_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' // WBTC mainnet
const ASSET_DECIMALS = 8

const EMISSIONS_WINDOW_SECONDS = 3600 // 1-hour forward projection
const SECONDS_PER_YEAR = 31_536_000

const yieldBasisLtAbi = [
  {
    inputs: [],
    name: 'pricePerShare',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'updated_balances',
    outputs: [
      { name: 'supply', type: 'uint256' },
      { name: 'staked', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const gaugeControllerAbi = [
  {
    inputs: [
      { name: 'gauge', type: 'address' },
      { name: 'at_time', type: 'uint256' },
    ],
    name: 'preview_emissions',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export default defineAdapter({
  slug: 'yb-wbtc-token',
  name: 'Yield Basis YB-WBTC (Staked)',
  url: 'https://yieldbasis.com',
  category: 'lp',
  custody: 'multisig',
  requires: { rpc: ['ethereum'] },

  async fetch() {
    const client = ethereum.getClient()

    // Need the chain's current timestamp to project emissions forward.
    const latestBlock = await client.getBlock({ blockTag: 'latest' })
    const nowTs = latestBlock.timestamp
    const futureTs = nowTs + BigInt(EMISSIONS_WINDOW_SECONDS)

    // Parallelize everything else.
    const [balancesCall, growth, emissionsNow, emissionsFuture, ybPriceUsd, btcPriceUsd] =
      await Promise.all([
        ethereum.readContract<readonly [bigint, bigint]>({
          address: LT,
          abi: yieldBasisLtAbi,
          functionName: 'updated_balances',
        }),
        readShareGrowth({
          client,
          address: LT,
          abi: yieldBasisLtAbi,
          functionName: 'pricePerShare',
          blocksBack: BLOCKS_PER_30D.ethereum,
          decimals: 18,
        }),
        ethereum.readContract<bigint>({
          address: GAUGE_CONTROLLER,
          abi: gaugeControllerAbi,
          functionName: 'preview_emissions',
          args: [GAUGE, nowTs],
        }),
        ethereum.readContract<bigint>({
          address: GAUGE_CONTROLLER,
          abi: gaugeControllerAbi,
          functionName: 'preview_emissions',
          args: [GAUGE, futureTs],
        }),
        prices.getToken('yield-basis'),
        prices.getBtc(),
      ])

    const [, stakedRaw] = balancesCall
    const stakedShares = math.fromUnits(stakedRaw, 18)
    requirePositive(stakedShares, 'stakedShares')

    const tvlBtc = math.mul(stakedShares, growth.sharePriceNow)
    requirePositive(tvlBtc, 'tvlBtc')

    // Emissions APR
    const ybDelta = Number(emissionsFuture - emissionsNow) / 1e18
    const ybPerYear = (ybDelta / EMISSIONS_WINDOW_SECONDS) * SECONDS_PER_YEAR
    const stakedTvlUsd = tvlBtc * btcPriceUsd
    const emissionsUsdPerYear = ybPerYear * ybPriceUsd
    const emissionsApr = stakedTvlUsd > 0 ? (emissionsUsdPerYear / stakedTvlUsd) * 100 : 0

    const baseApr = growth.apr
    const apr = baseApr + emissionsApr

    return [
      {
        symbol: 'yb-WBTC-staked',
        tvlBtc,
        apr,
        metadata: {
          ltAddress: LT,
          gaugeAddress: GAUGE,
          gaugeController: GAUGE_CONTROLLER,
          assetAddress: ASSET_ADDRESS,
          assetDecimals: ASSET_DECIMALS,
          sharePrice: growth.sharePriceNow,
          sharePrice30dAgo: growth.sharePriceThen,
          stakedShares,
          baseApr, // trading-fee yield (matches dashboard's "Real Yield" math)
          emissionsApr, // $YB emissions yield (matches dashboard's "Token Yield" math)
          apy30dBase: growth.apy,
          ybPerYear,
          ybPriceUsd,
          btcPriceUsd,
          emissionsWindowSeconds: EMISSIONS_WINDOW_SECONDS,
        },
      },
    ]
  },
})
