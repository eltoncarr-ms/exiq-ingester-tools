# Kusto benchmark visualizer

Minimal Vite/React client for schemaVersion `1` Kusto-direct ExIQ ingestion benchmark artifacts, a **Poll
Telemetry** page for the `PollTelemetry__Sink=jsonl` cursor-poller stream, and an **App Insights** page for
completed `CursorPoll.Cycle` rows from Azure Monitor. The three pages share only generic UI primitives,
formatting, and file-picker patterns; each has its own isolated parser and data model, switched by a
dependency-free tab bar (`AppShell.tsx`) that keeps all three pages mounted so switching tabs never resets any
page's loaded state.

## Run locally

```cmd
cd tools\kusto-benchmark-visualizer
npm install
npm run dev
```

Use the **Benchmark** / **Poll Telemetry** / **App Insights** tabs at the top of the page to switch views.

### Benchmark page

Accepts one or more JSON artifacts or a benchmark run folder through the picker or drag/drop area. Use **Live Stream**
in the header to poll a benchmark run folder while it is being refreshed.

### Poll Telemetry page

Accepts a static `PollTelemetry__Sink=jsonl` file through **Load .jsonl** or drag/drop. Where the browser supports the
File System Access API, **Poll live file** opens a file picker and tails that single file: each poll reads only the
bytes appended since the last read (decoded byte-safely with a persistent `TextDecoder` in streaming mode so a
multi-byte character split across a read is never corrupted), retains a partial trailing line until the rest of it
arrives, and never re-parses bytes already read. If the file is truncated (rewritten shorter), the reader resets and
restarts from byte zero instead of misreading stale offsets. **Stop live** halts polling and flushes any retained
partial line; **Clear** resets the page entirely.

Parsed `stage`/`cycle` events are grouped with `buildPollAnalysis` into per-source dashboards (cycle outcomes, Rows
Processed/Events Finalized/Checkpoints totals, and five weighted throughput dials — Kusto read, processing, event,
compression, and checkpoint velocity — reusing the benchmark page's gauge component), a dedicated Poll Duration Stats
section with per-stage (seal query, row mapping, write, advance) descriptive stats (avg/min/p50/p95/max/count),
source-throughput trends, a cycle list scoped to the selected source or, when cycles still have stage activity but no
rollup yet (no source assigned), to a distinct **Source pending** selection — never both at once — and interactive
stage-timeline replay for the selected cycle. The selected source (or pending) and cycle stay stable as new events
arrive; the header shows the selected source's cycle count and full-run duration (or the pending cycle count) as
tags, a running warning count for malformed or unrecognized lines, and the run hero surfaces a live/static status
badge and any load error.

### App Insights page

Accepts completed `CursorPoll.Cycle` rows in three input modes — all normalized through the same typed DTO path:

- **Load fixture**: the checked-in `SAMPLE_RAW_ROWS` from `src/appinsights/sample.ts` covering singleton, sharded, bulk, contention, validation-failure, cancelled, missing-optional-fields, mixed-schema (pre-schema), observed-zero, and unknown-additive-fact scenarios.
- **Load exported JSON**: a user-selected JSON file exported from Azure Monitor Log Analytics — either a flat array of row objects (`RawCycleRow[]`) or the standard tabular export format (`{ tables: [{ columns, rows }] }`).
- **Query live** (requires the local server — see below): a loopback HTTP `POST /api/query` call to `server/appInsightsQueryServer.ts`, which uses the current Azure CLI identity to query Azure Monitor and returns raw rows the page normalizes client-side.

The page displays seven content areas: a filter/selector bar, a fleet summary panel, a per-shard fleet table, backlog and paging health, mode-aware Kusto pipeline stats, Cosmos partition-batch outcomes and partial RU, and a cycle-detail fact list for the selected row.

Semantic rules enforced:
- Fleet throughput = `sum(records) / wallClockSeconds` — **not** `avg(recordsPerSec)`.
- Backlog is shown per-shard and uses `max` for fleet health — **never summed** across shards.
- Legacy and drain-safe `kustoMs` are displayed separately (different timing boundaries).
- Legacy `mapMs` and `rowsScanned` are labelled "unknown (legacy)", never substituted with 0.
- `sdkFailedServiceRequestCount` is labelled "SDK failed service requests" — **not** "retries".
- `terminal429OperationCount` is labelled "terminal 429 operations" — **not** "total 429s".
- Cosmos write outcomes are labelled as **partition-batch** outcomes.
- All RU fields carry an explicit **"partial/incomplete"** completeness label (successful transactional interaction-write RU and successful snapshot RU are still unavailable from the producer).

#### Live query local server

The server is an optional companion and is **not required** for `npm test`, `npm run typecheck:test`, or `npm run build`. It binds to `127.0.0.1` only (never `0.0.0.0`) and accepts only bounded dashboard parameters — never arbitrary KQL.

Prerequisites (packages not installable in the sandbox; install separately with real registry access):

```cmd
npm install @azure/identity @azure/monitor-query
```

Required RBAC on the target Log Analytics workspace or App Insights resource: **Log Analytics Reader** or **Monitoring Reader**.

Start the server:

```cmd
set WORKSPACE_ID=<your-log-analytics-workspace-id-or-app-insights-resource-id>
set TENANT_ID=<optional-tenant-id-for-cross-tenant>
npm run server
```

The server listens on port 7432 by default (`QUERY_SERVER_PORT` env var overrides). The browser client's "Query live" control must match this port.

> **Known limitation**: `npm run typecheck:server` (`tsc -p tsconfig.server.json`) is unverified in this sandbox because `@azure/identity` and `@azure/monitor-query` are not installable. It should compile once a developer installs those packages with real registry access.


```cmd
cd tools\kusto-benchmark-visualizer
npm run build
```

The static output is written to `dist\`.

## Run with Docker

The Docker image bundles both the React SPA (served by nginx on port 8080) and the loopback App Insights query
server (Node.js on `127.0.0.1:7432`). nginx proxies `/api/` requests to the query server, so no second container
or port is needed.

### Prerequisites

- `az login` (or `az login --tenant <tenantId>`) so the container can use your Azure CLI credential.
- The Log Analytics workspace ID or App Insights resource ID you want to query.
- A valid Azure Artifacts token in your user `~/.npmrc`. The project `.npmrc` routes all npm traffic through
  the private ADO feed; refresh your token before building:

  ```cmd
  cd tools\kusto-benchmark-visualizer
  vsts-npm-auth -config .npmrc
  ```

  The Docker build mounts `%USERPROFILE%\.npmrc` as a BuildKit secret so the container can authenticate to
  the feed without embedding credentials in the image.

### Docker Compose (recommended)

Create `tools\kusto-benchmark-visualizer\.env` (never commit this file):

```
WORKSPACE_ID=<your-log-analytics-workspace-id-or-app-insights-resource-id>
# TENANT_ID=<optional-tenant-id-for-cross-tenant>
```

Build and start:

```cmd
docker compose -f tools\kusto-benchmark-visualizer\compose.yaml up --build --detach
```

Stop and remove the container:

```cmd
docker compose -f tools\kusto-benchmark-visualizer\compose.yaml down
```

### docker run (manual)

```cmd
docker build -t kusto-benchmark-visualizer tools\kusto-benchmark-visualizer
docker run --rm -p 8080:8080 ^
  -e WORKSPACE_ID=<your-workspace-id> ^
  -v "%USERPROFILE%\.azure:/root/.azure:ro" ^
  kusto-benchmark-visualizer
```

> **Note**: the image uses Node 24 to match the `package-lock.json` generated by npm 11.

Open `http://localhost:8080`. Use the **App Insights** tab and click **Query live** to fetch live data.

## Test

```cmd
cd tools\kusto-benchmark-visualizer
npm run test
npm run typecheck:test
```

## Artifact contract

### Benchmark artifacts

The benchmark page expects the shared `schemaVersion: 1` shape with `run`, `iterations`, `memorySamples`, and
`summary`. Each loaded run is isolated in-browser; no data leaves the page.

### Poll telemetry stream

The Poll Telemetry page expects the raw `PollTelemetry__Sink=jsonl` stream: an append-only mixture of `stage` and
`cycle` NDJSON records, joined by `runId` (one poll cycle per `runId`). This is a distinct, unrelated contract from the
benchmark artifacts above and is never converted to or from it.

- `stage` — a progressive per-stage span boundary: `{ type: "stage", ts, runId, stage, ev: "start" | "end", atMs,
  durMs? }`. `durMs` is present only on `"end"`.
- `cycle` — the final rollup for one poll cycle: `{ type: "cycle", ts, runId, source, outcome: "success" | "skipped" |
  "failed", startedAtUtc, completedAtUtc, totalMs, records, recordsPerSec, timeline }`, plus optional producer facts
  (`users`, `cursorLagSec`, `kustoMs`, `mapMs`, `writeMs`, `advanceMs`, `writeInteractionsRu`, `failingStage`, `error`)
  that are omitted — never zeroed or defaulted — when the producer did not report them for that cycle.

Malformed JSON, unknown record types, and records missing a required field are collected as non-fatal warnings; every
other valid line still loads. Every other producer field on a `cycle` line is preserved verbatim on that event's
`facts` object even though the visualizer's dashboards only read the fields listed above.

### Weighted throughput dials

The Poll Cycle Metrics dashboard's five gauges (Kusto read, processing, event, and compression throughput, plus
checkpoint velocity) read two additional facts directly from a `cycle` line's `facts` object, when the producer
reports them — `inputRows` (a number) and `windowStartUtc`/`windowEndUtc` (ISO timestamps bounding the source window
this cycle advanced). None of these are required fields: an older log that omits them still loads and parses
normally, and any cycle missing `inputRows` is simply excluded from the first four (successful-only) dials rather than
contributing a zeroed value. Checkpoint velocity is computed over every completed cycle regardless of outcome: a
cycle's source-seconds-advanced is `max(0, windowEndUtc - windowStartUtc)` only when it succeeded and reports both
window facts, and 0 for every skipped/failed cycle or a successful cycle missing either fact — but its wall time
(`totalMs`) always counts toward the dial's denominator.

The same two facts back two headline cards: **Rows Processed** sums every cycle's finite `inputRows` fact (source
messages read, regardless of outcome), and **Checkpoints** counts only the successful cycles whose window strictly
advanced (`windowEndUtc - windowStartUtc > 0`) — i.e. an actual cursor movement, not merely a reported window.
