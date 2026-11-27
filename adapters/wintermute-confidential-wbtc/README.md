# Wintermute Confidential WBTC

The vault lends WBTC on Ethereum. Borrower interest increases the WBTC value of each vault share. Zama pays a separate incentive in confidential ZAMA to eligible depositors who authorize Merkl to read their confidential balance. [Morpho vault](https://app.morpho.org/ethereum/vault/0x3d5EcCb62974178236A768A7ef14D3ce468Fbe91/wintermute-confidential-wbtc) · [Zama campaign rules](https://www.zama.org/legal/zama-reward-campaign-rules)

## Hourly metric

The primary rate is a **trailing 30-day annualized quote**. Only the lending component measures realized WBTC share growth. The incentive component measures quoted rewards. Individual payouts depend on eligibility and claims. [Morpho reward methodology](https://docs.morpho.org/developers/rewards/tutorials/fetch-rewards-data/)

| Field | Calculation |
| --- | --- |
| `tvlBtc` | Current vault `totalAssets` in WBTC, including idle funds once. The Ethereum WBTC asset at `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` has 8 decimals. |
| `nativeApyPct` | Compound growth in WBTC per share over 30 days, annualized as `((close / open) ** (365 / 30) - 1) * 100`. |
| `rewardAprPct` | Mean hourly incentive contribution to Morpho’s vault quote. Each hour is `100 * (avgNetApy - avgApy)` with a one-hour lookback. The series covers all rewards Morpho includes, including a successor campaign if indexed. |
| `rate` | Native APY plus mean quoted incentive APR, in percentage points, using Morpho’s convention and the adapter framework’s `apy` label. |
| `spotTotalApyPct`, `spotNativeApyPct`, `spotZamaAprPct` | Current Morpho headline, current lending APY and current Ethereum ZAMA APR. These describe retrieval time. |

The adapter requests [Morpho GraphQL](https://api.morpho.org/graphql) once per hourly run. It pins the cutoff to the scheduled UTC hour, so a retry measures the same window. It requires both boundary share prices and 720 distinct paired hourly values in `[windowStart, windowEnd)`. A missing pair leaves a gap in the stored series. An observed zero incentive counts as zero. Timestamps in metadata are Unix seconds. The current TVL and spot quotes use `observedAt`. All endpoints are public and require no credentials.

```sh
pnpm validate wintermute-confidential-wbtc
```

## Merkl coverage and API migration

Morpho schedules its GraphQL shutdown for **January 29, 2027**. Its Read API provides historical native share values and excludes Merkl incentives. The command below compares native share growth with direct ZAMA reward quotes over the 30 days ending at the latest UTC midnight. It makes two Morpho reads, then paginates the Merkl campaign list and hourly APRs (normally five Merkl requests). The comparison uses the public vault opportunity once. The confidential-share listing measures the same incentive against a different deposit base. [Morpho migration guide](https://docs.morpho.org/developers/api/migrate-from-graphql/) · [Public vault opportunity](https://api.merkl.xyz/v4/opportunities/1180195578045120503)

```sh
pnpm exec tsx adapters/wintermute-confidential-wbtc/rest.ts
```

The command reports coverage and returns `null` for the incentive-dependent rates if any hour is absent. Its scope excludes rewards forwarded from underlying markets. Publishing a replacement for the primary series requires establishing that coverage and reconciling the result at matching cutoffs. The hourly adapter leaves a gap when its primary source is unavailable.

**Reference check.** At November 25, 2026, 23:00 UTC, the full 720-hour series yielded 0.926130% native WBTC APY and 4.210530% mean quoted incentive APR, totaling 5.136660%. Ethereum archive reads of `convertToAssets` on one million vault shares reproduced the native yield within 0.000002 percentage points. [Opening block](https://etherscan.io/block/26280013) · [Closing block](https://etherscan.io/block/26495342)
