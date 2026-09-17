# Main-app integration

This microservice holds no database credentials. Every hour it runs all
registered adapters and reports results to the main BitcoinYield app over
HTTP. This document is the complete contract the main app must implement —
once these three endpoints exist and the env vars below are set, the
pipeline is live end to end.

## Authentication

Every request carries the shared secret in a header:

```
x-adapter-key: <BITCOINYIELD_ADAPTER_KEY>
```

Reject anything else with `401`. The key is a single static secret shared
between the two deploys.

## Endpoints

### 1. `POST /api/adapter-metrics`

Writes one metrics row. Called once per adapter per hourly run (only when
the run produced a row that survived the pipeline's guards).

```jsonc
// request body
{
  "slug": "kraken-bitcoin-earn",
  "row": {
    "symbol": "BTC",
    "tvlBtc": 4510.7696,
    "tvlUsd": 283876269.33,
    "btcPrice": 62933,
    // Temporary compatibility projection; may contain APR or APY until the
    // main app completes the migration below.
    "apr": 1.3389,
    "apy": 1.3389,
    "rate": {
      "type": "apy",
      "value": 1.3389,
      "basis": "calculated",
      "source": "ink:0xAccountant.getRate",
      "windowDays": 7,
      "compounding": {
        "method": "automatic",
        "evidence": {
          "kind": "exchange_rate",
          "field": "getRate()",
          "reference": "ink:0xAccountant",
        },
      },
    },
    // `rate` is duplicated here until the Payload collection has first-class
    // columns, so current production storage and MCP can consume semantics.
    "metadata": { "rateType": "apy", "rateStatus": "valid", "rate": {} },
    "timestamp": "2026-07-06T07:00:00.000Z", // ISO 8601
  },
}
```

Respond `200` on success (body ignored). Any non-2xx marks the run failed
and Inngest retries it.

### Main-app rate storage migration

The endpoint must map the canonical `row.rate`, rather than treating
`row.apr` as authoritative:

| Database field     | Mapping                                   |
| ------------------ | ----------------------------------------- |
| `apr`              | `rate.type === "apr" ? rate.value : null` |
| `apy`              | `rate.type === "apy" ? rate.value : null` |
| `rate_type`        | `rate?.type ?? null`                      |
| `rate_basis`       | `rate?.basis ?? null`                     |
| `rate_window_days` | `rate?.windowDays ?? null`                |
| `rate_source`      | `rate?.source ?? null`                    |
| `rate_status`      | `rate ? "valid" : "unavailable"`          |
| `rate_observation` | Full `rate` JSON for evidence/provenance  |

Keep the incoming compatibility `row.apr` only during the dual-write period.
The public UI and MCP should select `apy` when `rate_type = 'apy'`, otherwise
`apr`; neither field should be filled with zero when a rate is unavailable.

**Idempotency requirement:** the service pins `row.timestamp` to the
Inngest event's `triggeredAt`, so a retried invocation re-sends the same
timestamp. The main app MUST upsert / dedup on `(slug, timestamp)` —
otherwise a dropped response becomes a duplicate row.

### 2. `GET /api/adapter-metrics/:slug/latest`

Returns the most recent stored row for a slug. The pipeline's spike guard
compares each new row against this baseline.

```jsonc
// 200 response
{ "row": { /* same shape as row above */ } }
// or, when the adapter has no rows yet:
{ "row": null }   // 404 is also treated as "no baseline"
```

If this endpoint is down, adapters still run but the spike guard can't
compare against history — new rows pass through unguarded.

### 3. `POST /api/adapter-status`

Upserts operational health per adapter, written after every run (success
or failure). Intended to back an adapter-health view later; storing the
latest state per slug is enough for now.

```jsonc
// request body
{
  "slug": "kraken-bitcoin-earn",
  "status": "success", // "success" | "error"
  "finishedAt": "2026-07-06T07:00:04.100Z",
  "durationMs": 4100,
  "rowsInserted": 1, // optional
  "rowsDropped": 0, // optional
  "lastError": null, // optional; first 4000 chars of the error
}
```

Upsert by `slug` (one row per adapter, latest state wins). Respond `200`.

### 4. `GET /api/manual-metrics/:slug`

Serves manually-maintained APR/TVL for CMS-sourced adapters (products with
no API or on-chain source — currently Sypher Capital and Coinbase BTC Yield
Fund). Must read the marketer-edited CMS collection (`yieldProducts`), NOT
`protocolMetrics` — reading the latter back would create a feedback loop
that echoes the adapter's own output.

```jsonc
// 200 response
{
  "slug": "sypher-capital-bitcoin-yield-fund",
  "aprPercent": 4.35, // percentage: 4.35 = 4.35%
  "tvlUsd": 6000000, // null when the product doesn't disclose TVL
  "updatedAt": "2026-06-15T20:06:30.000Z", // last CMS edit (ISO 8601)
}
// 404 when no CMS product matches the slug
```

The adapter service fetches this hourly, validates it (`requirePositive`,
boundaries, spike guard — a fat-fingered CMS edit trips the guard), and
POSTs the resulting row back via `POST /api/adapter-metrics`.

## Production environment (this service, on Vercel)

| Variable                                                               | Purpose                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`                            | Inngest auth (dashboard → Manage)                                                           |
| `BITCOINYIELD_API_URL`                                                 | Main app base URL                                                                           |
| `BITCOINYIELD_ADAPTER_KEY`                                             | Shared secret for the endpoints above                                                       |
| `BITCOINYIELD_RPC_ETHEREUM`                                            | Dedicated mainnet RPC (QuickNode/Alchemy). Needed for archive reads that power on-chain APR |
| `BITCOINYIELD_RPC_BOTANIX`                                             | Dedicated Botanix RPC (chain 3637)                                                          |
| `BITCOINYIELD_RPC_INK`                                                 | Dedicated Ink RPC (chain 57073, Kraken Bitcoin Earn)                                        |
| `BITCOINYIELD_BROWSERBASE_KEY` / `BITCOINYIELD_BROWSERBASE_PROJECT_ID` | Scraper adapters (mezo-earn, merlin-btc only)                                               |
| `BITCOINYIELD_AMBOSS_API_KEY`                                          | amboss adapter                                                                              |
| `BITCOINYIELD_VOYAGER_API_KEY`                                         | starknet adapter                                                                            |
| `DISCORD_WEBHOOK`                                                      | Operational paging (optional but recommended)                                               |

Optional: `BITCOINYIELD_STORAGE_MODE=log` makes the service print
`[adapter-metrics]` / `[adapter-status]` lines to stdout instead of POSTing
— useful for verifying the deploy before the main-app endpoints are live.

## Rollout order

1. Deploy this service with `BITCOINYIELD_STORAGE_MODE=log` and confirm
   hourly runs produce sane rows in the Vercel logs.
2. Implement the three endpoints on the main app (with the dedup rule).
3. Set `BITCOINYIELD_API_URL` + `BITCOINYIELD_ADAPTER_KEY`, remove
   `BITCOINYIELD_STORAGE_MODE`, redeploy.
4. Cut the main app's legacy `src/inngest/functions/ingest-*.ts` crons over
   to reading from `protocolMetrics` rows written by this service, then
   delete them.
