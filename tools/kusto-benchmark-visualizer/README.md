# Kusto benchmark visualizer

Minimal Vite/React client for schemaVersion `1` Kusto-direct ExIQ ingestion benchmark artifacts, plus a second **Poll
Telemetry** page for the `PollTelemetry__Sink=jsonl` cursor-poller stream. The two pages share only generic UI
primitives, formatting, and file-picker patterns; each has its own isolated parser and data model, switched by a
dependency-free tab bar (`AppShell.tsx`) that keeps both pages mounted so switching tabs never resets either page's
loaded state.

## Run locally

```cmd
cd tools\kusto-benchmark-visualizer
npm install
npm run dev
```

Use the **Benchmark** / **Poll Telemetry** tabs at the top of the page to switch views.

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

## Build

```cmd
cd tools\kusto-benchmark-visualizer
npm run build
```

The static output is written to `dist\`.

## Run with Docker

Build and run the production image from the repository root:

```cmd
docker build -t kusto-benchmark-visualizer tools\kusto-benchmark-visualizer
docker run --rm -p 8080:8080 kusto-benchmark-visualizer
```

Open `http://localhost:8080`.

To build and start it in the background with Docker Compose:

```cmd
docker compose -f tools\kusto-benchmark-visualizer\compose.yaml up --build --detach
```

Stop and remove the local container with:

```cmd
docker compose -f tools\kusto-benchmark-visualizer\compose.yaml down
```

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
