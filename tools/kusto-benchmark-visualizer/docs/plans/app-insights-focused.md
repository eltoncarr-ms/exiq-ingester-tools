# App Insights – Focused Dashboard Page

> **Status:** Plan — ready for implementation  
> **Produced by:** Multi-agent planning council (GPT-5.6 Sol + Claude Opus 4.8 + rubber-duck review)

---

## Executive Summary

Add a new **Focused Dashboard** tab to the Kusto Benchmark Visualizer that lets an operator pin an **anchor time**, auto-discover the exact run window around it, and inspect a tight, high-signal view of a single ingestion run: four throughput dials (Kusto, Cosmos, Compression, Checkpoint velocity) plus mode-segregated Kusto/Cosmos latency and progress KPIs. It reuses the existing loopback query server, the normalize pipeline, and the SVG gauge component. The only new server capability is an **absolute time-window query** alongside the existing relative lookback. All work is additive: existing pages, types, and gauge behavior are unchanged.

---

## Feature Overview

Today the App Insights page queries a **relative** window (`lookbackHours`) and renders fleet-wide aggregates that blend execution modes. The Focused Dashboard instead:

1. Takes an **anchor** (`datetime-local`, interpreted as local time and converted to UTC ISO) and sends **one centered discovery query** (`anchor − 24h`, 48h wide).
2. Derives the real run window from returned rows (`windowStart = min(eventTimeUtc)`, `discoveredDuration = max − min`).
3. Lets the operator **extend** the duration (clamped `≥ discoveredDuration`, `≤ 168h`) and **fetch** the focused window, with an in-memory cache.
4. Renders **four gauges** (needle = mean over the window; range/p95 from per-cycle values), **mode-segregated Kusto latency** (never blending `legacy`/`drainSafe`/`unknown`), Cosmos latency, and checkpoint velocity KPIs split by band level.

---

## Scope

### In Scope
- New `PageKey` `'focused'`, `PAGES` entry, and tabpanel in `AppShell.tsx`.
- New page component `src/FocusedDashboardPage.tsx` (anchor input, discovery, extend, fetch, cache, render).
- Server `QueryParams` **discriminated union** adding an absolute-window branch; `validateParams` extension; KQL window template; SDK timespan branch in `azureMonitorClient.ts`.
- Client transport: extend `LiveQueryParams`/`QuerySource` to carry the window branch.
- Derive: `describeDistribution`, `computeFocusedThroughput`, `computeFocusedKpis`.
- Gauge component: optional `gauges?: GaugeKey[]` prop; new `cosmosWriteThroughputBatchesPerSec` field + new Cosmos gauge definition (opt-in only; existing page unchanged).
- Unit tests for all new pure functions and the server window branch.

### Out of Scope
- Changing existing pages (`App`, `PollTelemetryPage`, `AppInsightsPage`) beyond adding the new nullable field to the shared gauge type.
- Any change to `normalize.ts`, `types.ts` field contracts, or the KQL projection column set.
- Persisting cache/anchor across reloads; multi-run comparison; server-side caching.
- New build/lint/test tooling.

---

## Design

### Architecture Overview

```
FocusedDashboardPage.tsx
  ├─ anchor (datetime-local) ──► discovery: loadCompletedCycles({kind:'live', window:{startTimeUtc: anchor-24h, durationHours:48}})
  │        └─ derive windowStart, discoveredDuration, truncation warning (generation-guarded)
  ├─ extend durationHours (≥ discoveredDuration, ≤168) ──► fetch focused window (cache-checked)
  ├─ cache: useRef<Map<string, CompletedCycleRow[]>>
  ├─ computeFocusedThroughput(rows) ──► <ThroughputGaugeGrid gauges={['kusto','cosmos','compression','checkpointVelocity']} …/>
  └─ computeFocusedKpis(rows) ──► Kusto latency by (level,mode) + Cosmos latency + velocity KPIs
        └─ describeDistribution(values)

query.ts (transport)  ──POST /api/query──►  queryEngine.ts (validate + classify)  ──►  azureMonitorClient.ts (KQL + SDK timespan)
```

Same three-mode loader and normalize path; the window branch is a new payload shape only.

---

### Server: QueryParams Extension

In `server/queryEngine.ts`, replace the single interface with a **discriminated union** keyed by the presence of `startTimeUtc`:

```ts
export type QueryParams =
  | { appRoleNameFilter: string; lookbackHours: number }
  | { appRoleNameFilter: string; startTimeUtc: string; durationHours: number };
```

`AppInsightsQueryClient.queryCompletedCycles(params: QueryParams)` is unchanged in signature.

`validateParams` rules (extend the existing function; keep the KQL-injection guard rejecting `kql`/`query`/`kqlOverride`):

- `appRoleNameFilter`: non-empty string, trimmed (unchanged).
- **Ambiguity guard:** if both `lookbackHours` and (`startTimeUtc` or `durationHours`) are present → `{ ok:false, error:'Provide either lookbackHours or a startTimeUtc+durationHours window, not both.' }`.
- **Window branch** (when `startTimeUtc` present):
  - `startTimeUtc`: `typeof === 'string'`, non-empty, and `Number.isFinite(Date.parse(startTimeUtc))` → else bad request.
  - `durationHours`: finite number, `> 0` and `<= MAX_LOOKBACK_HOURS (168)` → else bad request.
  - Return `{ appRoleNameFilter, startTimeUtc, durationHours }`.
- **Lookback branch** (when `lookbackHours` present): unchanged (`MIN_LOOKBACK_HOURS = 0.25 … MAX = 168`).
- Neither present → bad request `'Provide lookbackHours or startTimeUtc+durationHours.'`.

`handleRequest` is otherwise unchanged.

---

### Server: KQL and SDK Timespan

In `server/azureMonitorClient.ts`, avoid KQL duplication by factoring the invariant projection body:

```ts
// let helpers (ToNullableBool, PositiveTicksToUtc, TicksToSeconds) — constant prefix
const HELPERS_KQL = `let ToNullableBool = …;\nlet PositiveTicksToUtc = …;\nlet TicksToSeconds = …;\n`;

// The entire | where AppRoleName == … | extend … | project … | order by … body (unchanged)
const CYCLE_PROJECTION_KQL = `| where AppRoleName == '{APP_ROLE}'\n…`;

// Only the first time-filter line varies
const LOOKBACK_TIME_FILTER = `AppEvents\n| where TimeGenerated > ago({LOOKBACK} * 1h)\n`;
const WINDOW_TIME_FILTER   = `AppEvents\n| where TimeGenerated between (datetime('{START}') .. datetime('{END}'))\n`;
```

`queryCompletedCycles(params)` branches on the union:

```ts
const esc = (s: string) => s.replace(/'/g, "\\'");

if ('lookbackHours' in params) {
  const lookbackSeconds = Math.ceil(params.lookbackHours * 3600);
  const kql = (HELPERS_KQL + LOOKBACK_TIME_FILTER + CYCLE_PROJECTION_KQL)
    .replace('{LOOKBACK}', String(params.lookbackHours))
    .replace('{APP_ROLE}', esc(params.appRoleNameFilter));
  result = await this.client.queryWorkspace(this.workspaceId, kql, { duration: `PT${lookbackSeconds}S` });
} else {
  const startMs = Date.parse(params.startTimeUtc);
  const start   = new Date(startMs);
  const end     = new Date(startMs + params.durationHours * 3_600_000); // single source of truth for both KQL and SDK
  const kql = (HELPERS_KQL + WINDOW_TIME_FILTER + CYCLE_PROJECTION_KQL)
    .replace('{START}',    esc(start.toISOString()))
    .replace('{END}',      esc(end.toISOString()))
    .replace('{APP_ROLE}', esc(params.appRoleNameFilter));
  result = await this.client.queryWorkspace(this.workspaceId, kql, { startTime: start, endTime: end });
}
```

The 3rd positional arg to `queryWorkspace` is the `QueryTimeInterval`; both `{ duration }` and `{ startTime, endTime }` are valid shapes. Row-mapping and `status !== 'Success'` handling are unchanged.

---

### Client Transport

In `src/appinsights/query.ts`, widen the live payload:

```ts
export type LiveQueryParams =
  | { appRoleNameFilter: string; lookbackHours: number }
  | { appRoleNameFilter: string; startTimeUtc: string; durationHours: number };
```

In the `'live'` case: forward exactly the fields present (send `lookbackHours` **or** `startTimeUtc`+`durationHours`, never both). The `fetch` URL, error parsing (`tryParseServerError`), and `normalizeRows(json)` path are unchanged.

---

### Derive: New Functions

All added to `src/appinsights/derive.ts`. All pure, null-safe (never coerce `null → 0`, per repo contract in `types.ts`).

#### 1. `describeDistribution`

```ts
export interface Distribution {
  count: number;
  mean: number | null;
  stdDev: number | null;   // population stdDev; 0 when count === 1
  median: number | null;   // midpoint interpolation on even n
  p95: number | null;      // nearest-rank, matches existing percentile() helper
  min: number | null;
  max: number | null;
}

export function describeDistribution(values: Array<number | null>): Distribution;
```

Rules:
- Filter to finite values (`Number.isFinite`), ascending sort. `count = 0` → all stat fields null, count 0.
- `mean = Σx / n`.
- `stdDev = sqrt(Σ(x−mean)² / n)` (population; n=1 → 0).
- `median`: n odd → middle element; n even → `(a[n/2−1] + a[n/2]) / 2`.
- `p95`: `idx = clamp(ceil(0.95·n) − 1, 0, n−1)` (same rule as the existing `percentile` helper for cross-app consistency).

#### 2. `computeFocusedThroughput`

```ts
export interface FocusedThroughputStats {
  metrics: ThroughputGaugeMetrics;                    // needle = MEAN over the window
  iterationMetrics: ThroughputGaugeIterationMetrics[];
}
export function computeFocusedThroughput(rows: CompletedCycleRow[]): FocusedThroughputStats;
```

Consider `rowKind === 'laneAttempt'` rows only. Per-cycle values (all require `outcome === 'success'` and the listed non-null inputs; else the field is `null`):

| Field | Formula | Guard |
|---|---|---|
| `kustoReadThroughputRowsPerSec` | `rawScanRows / ((kustoMs + mapMs) / 1000)` | `rawScanRows`, `kustoMs`, `mapMs` non-null; `kustoMs + mapMs > 0` |
| `cosmosWriteThroughputBatchesPerSec` | `cosmosSucceeded / (writeMs / 1000)` | both non-null; `writeMs > 0` |
| `compressionRateRowsPerEvent` | `rawScanRows / records` | both non-null; `records > 0` |
| `checkpointVelocitySourcePerWall` | `max(0, checkpointProgressSeconds ?? committedProgressSeconds ?? 0) / (totalMs / 1000)` | `totalMs > 0` |
| `processingThroughputRowsPerSec` | `rawScanRows / (totalMs / 1000)` | both non-null; `totalMs > 0` |
| `eventThroughputEventsPerSec` | `records / (totalMs / 1000)` | both non-null; `totalMs > 0` |
| `checkpointAdvanceSeconds` | `max(0, checkpointProgressSeconds ?? committedProgressSeconds ?? 0)` | always (0 when absent) |

`iterationId = \`${row.runId}|${row.eventTimeUtc}|${index}\`` — unique even when multiple cycles share a `runId`.

`metrics.<field> = describeDistribution(iterationMetrics.map(m => m.<field>)).mean` for every numeric gauge field (the **mean of per-cycle values**, distinct from `computeThroughputStats`' ratio-of-sums). `checkpointAdvanceSeconds` in `metrics` = sum of per-cycle advances (kept for API compatibility with the shared type).

#### 3. `computeFocusedKpis`

```ts
type BandLevel = 'intraBand' | 'band';
// intraBand ← progressKind === 'continuation'
// band      ← progressKind === 'bandCommit'
// Other progressKinds excluded from level splits.

export interface KustoLatencyEntry {
  level: BandLevel;
  mode: ExecutionMode;     // 'drainSafe' | 'legacy' | 'unknown'
  label: string;           // e.g. 'Intra-band (drainSafe)'
  distribution: Distribution;
}

export interface FocusedKpis {
  checkpointVelocity: Distribution;                      // per-row velocity over all success laneAttempts
  iterationSpeed: Distribution;                          // totalMs over all success laneAttempts
  cosmosLatencyByLevel: Record<BandLevel, Distribution>; // writeMs per level (mode-independent)
  kustoLatency: KustoLatencyEntry[];                     // (level, mode) pairs, count ≥ 1, ordered drainSafe/legacy/unknown
}

export function computeFocusedKpis(rows: CompletedCycleRow[]): FocusedKpis;
```

- `kustoLatency`: for each `level ∈ {intraBand, band}` and each `mode ∈ ['drainSafe', 'legacy', 'unknown']`, compute `describeDistribution` of `kustoMs` for rows matching that `(level, mode)`. **Emit only pairs with `count ≥ 1`** (omit empty pairs entirely). Labels: `'Intra-band (drainSafe)'`, `'Band (legacy)'`, `'Intra-band (unknown)'`, etc. Modes never merged — each row is a single-mode distribution.
- `cosmosLatencyByLevel`: `writeMs` distribution per level (mode-independent; Cosmos write timing is not mode-sensitive).
- `checkpointVelocity`, `iterationSpeed`: computed over all `rowKind === 'laneAttempt'` rows with `outcome === 'success'`.

---

### Gauge Component Extension

In `src/components/RunThroughputGauges.tsx`:

**Step 1 — Add new field to types (additive; existing page compiles unchanged):**
```ts
export interface ThroughputGaugeMetrics {
  /* ...existing fields... */
  cosmosWriteThroughputBatchesPerSec: number | null;  // new; null in existing computeThroughputStats
}
```
(`ThroughputGaugeIterationMetrics` extends this, so it gains the field too.)

Update `computeThroughputStats` to set `cosmosWriteThroughputBatchesPerSec: null` in both `metrics` and each iteration entry.

**Step 2 — Add `GaugeKey` and Cosmos gauge definition:**
```ts
export type GaugeKey =
  | 'kusto'
  | 'processing'
  | 'event'
  | 'compression'
  | 'checkpointVelocity'
  | 'cosmos';

// Default = the original five (Cosmos opt-in)
const DEFAULT_GAUGE_KEYS: GaugeKey[] = ['kusto','processing','event','compression','checkpointVelocity'];
```

Assign stable `key: GaugeKey` to each existing gauge definition. Add a 6th definition:
- `key: 'cosmos'`, `label: 'Cosmos write throughput'`, `unit: 'batches/sec'`, `color: '#f472b6'`
- `description: 'Successful Cosmos partition-batch writes per second over Cosmos write-stage time.'`
- `value: displayed?.cosmosWriteThroughputBatchesPerSec ?? null`
- `rangeValues: iterationMetrics.map(c => c.cosmosWriteThroughputBatchesPerSec)`

**Step 3 — Add `gauges?` prop:**
```ts
interface RunThroughputGaugesProps {
  metrics: ThroughputGaugeMetrics | null;
  iterationMetrics: ThroughputGaugeIterationMetrics[];
  rangePercentile?: number;
  gauges?: GaugeKey[];   // undefined → DEFAULT_GAUGE_KEYS (original five, no Cosmos)
}
```

Render: `const order = gauges ?? DEFAULT_GAUGE_KEYS;` → render `order.map(key => allGaugesByKey.get(key))` (unknown keys skipped). Existing `AppInsightsPage` passes no `gauges` prop → still renders exactly five dials, unchanged.

New page passes `gauges={['kusto', 'cosmos', 'compression', 'checkpointVelocity']}`.

---

### Page: State and Flow

New file `src/FocusedDashboardPage.tsx`. Reuses the proven `sessionRef` generation-guard idiom from `AppInsightsPage`.

**State:**
```ts
const [anchor, setAnchor] = useState('');                              // datetime-local value
const [appRole, setAppRole] = useState('cursor-poller-local');
const [windowStart, setWindowStart] = useState<string | null>(null);  // min(eventTimeUtc) ISO
const [discoveredDuration, setDiscoveredDuration] = useState<number | null>(null);  // hours
const [durationHours, setDurationHours] = useState(48);               // user-extendable floor=discoveredDuration
const [rows, setRows] = useState<CompletedCycleRow[]>([]);
const [truncated, setTruncated] = useState(false);                     // window boundary warning
const [phase, setPhase] = useState<'idle'|'discovering'|'discovered'|'fetching'>('idle');
const [error, setError] = useState<string | null>(null);
const cacheRef = useRef<Map<string, CompletedCycleRow[]>>(new Map());
const sessionRef = useRef(0);
```

**Anchor-to-ISO helper:**
```ts
const anchorIso = anchor ? new Date(anchor).toISOString() : null;
// datetime-local yields local wall time; new Date(local).toISOString() converts to UTC — correct.
// Discovery and Fetch disabled when anchorIso === null or !appRole.trim().
```

**Discovery (one centered-window query):**
```ts
const discoveryStart = new Date(Date.parse(anchorIso) - 24 * 3600_000).toISOString();
// issues loadCompletedCycles({ kind:'live', port, params:{
//   appRoleNameFilter: appRole.trim(),
//   startTimeUtc: discoveryStart,
//   durationHours: 48
// }})
```
Generation-guarded (`sessionRef.current++; const gen = sessionRef.current; … if (sessionRef.current !== gen) return;`).

On resolve:
- Empty result → `setError('No cycles for this role in the ±24h window.'); setPhase('idle');`
- Else:
  - `windowStart = min(row.eventTimeUtc)`, `windowEnd = max(row.eventTimeUtc)`
  - `discoveredDuration = (Date.parse(windowEnd) − Date.parse(windowStart)) / 3_600_000` (hours)
  - `setRows(result)`, `setWindowStart(windowStart)`, `setDiscoveredDuration(discoveredDuration)`, `setDurationHours(discoveredDuration)`, `setPhase('discovered')`
  - `truncated = (Date.parse(windowStart) − Date.parse(discoveryStart)) < 3_600_000` (earliest row within 1h of query boundary)
- Discovery responses are **not cached** (key would be the synthetic anchor window, not the discovered one).

**Extend:**
- Duration input: `onChange` clamps `durationHours = Math.max(discoveredDuration, Math.min(168, next))`
- Extend enabled only when `phase === 'discovered'` and `windowStart !== null`

**Fetch:**
```ts
const cacheKey = `${appRole.trim()}|${windowStart}|${durationHours.toFixed(4)}`;
```
- Cache hit → `setRows(cacheRef.current.get(cacheKey)!)` (no network).
- Cache miss → generation-guarded `loadCompletedCycles({ kind:'live', port, params:{ appRoleNameFilter: appRole.trim(), startTimeUtc: windowStart, durationHours } })`.
  - Success → `cacheRef.current.set(cacheKey, result); setRows(result); setError(null);`
  - Failure → `setError(…)` (retain last-good rows; do not populate cache).

**Clear:**
- Reset `rows`, `error`, `windowStart`, `discoveredDuration`, `truncated`, `phase` → `'idle'`; `cacheRef.current.clear()`
- Retain `appRole` and `anchor` (controls preserved).

---

### Page: Render Layout

```
┌─ Header bar ───────────────────────────────────────────────────────────────┐
│  ◎  App Insights – Focused                                                 │
│     Window-based CursorPoll.Cycle telemetry                                │
│  [App role input]  [datetime-local "(UTC)"]  [Discover]                    │
│  ← after discovery → Window: {windowStart}  Duration: {discoveredDuration}h │
│  [Duration input ≥discoveredDuration, ≤168h]  [Fetch]  [Clear]            │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Truncation warning (if truncated) ────────────────────────────────────────┐
│  ⚠ Window start is within 1h of the query edge; the run may be truncated.  │
│  Adjust the anchor or extend backward manually.                            │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Load error (if error) ────────────────────────────────────────────────────┐
│  {error message}                                                           │
└────────────────────────────────────────────────────────────────────────────┘

[When rows.length > 0:]

┌─ Gauges (Panel: "Throughput Gauges") ──────────────────────────────────────┐
│  ThroughputGaugeGrid                                                       │
│   gauges={['kusto','cosmos','compression','checkpointVelocity']}           │
│   rangePercentile={95}                                                     │
│   metrics={computeFocusedThroughput(rows).metrics}                         │
│   iterationMetrics={computeFocusedThroughput(rows).iterationMetrics}       │
│                                                                            │
│  [Kusto rows/sec]  [Cosmos batches/sec]  [Compression rows/event]          │
│                    [Checkpoint velocity src/wall]                          │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Checkpoint Velocity (Panel) ──────────────────────────────────────────────┐
│  Level         Total Messages  Min  Mean  Median  P95  Max  Std Dev        │
│  Intra-band    {count}         …    …     …       …    …    …              │
│  Band          {count}         …    …     …       …    …    …              │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Dependency Latency (Panel) ───────────────────────────────────────────────┐
│  Iteration Speed (ms)                                                      │
│  Level     Count  Min  Mean  Median  P95  Max  Std Dev                     │
│  Intra-band …                                                              │
│  Band       …                                                              │
│                                                                            │
│  Kusto Latency (ms)  [mode-labeled rows, only present modes shown]         │
│  Level / Mode              Count  Min  Mean  Median  P95  Max  Std Dev     │
│  Intra-band (drainSafe)    …                                               │
│  Intra-band (legacy)       …                                               │
│  Band (drainSafe)          …                                               │
│  …                                                                         │
│                                                                            │
│  Cosmos Write Latency (ms)                                                 │
│  Level      Count  Min  Mean  Median  P95  Max  Std Dev                    │
│  Intra-band …                                                              │
│  Band       …                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

All numeric cells use existing `formatNumber`/`formatDuration` helpers; `null` renders as `—`. Tables use existing CSS table classes.

---

## Architecture Decisions

| ID | Decision | Rationale |
|---|---|---|
| AD1 | Discriminated union for `QueryParams`, by `startTimeUtc` presence | Keeps lookback path byte-compatible; window path is purely additive |
| AD2 | Single computed `end = startMs + durationHours·3_600_000` used for both KQL and SDK | Prevents silent row loss from diverging bounds |
| AD3 | Factor `CYCLE_PROJECTION_KQL`; vary only the time-filter line | Avoids drift between lookback/window KQL variants |
| AD4 | `gauges?: GaugeKey[]`, default = original five, Cosmos opt-in | Existing `AppInsightsPage` renders exactly five dials, no regressions |
| AD5 | Focused needle = mean of per-cycle values (not ratio-of-sums) | `computeThroughputStats` uses ratio-of-sums; the focused page requires window mean — documented clearly |
| AD6 | Never blend execution modes; Kusto latency keyed by `(level, mode)` | Honors the `types.ts` contract: `legacy`/`drainSafe` `kustoMs` have different timing boundaries |
| AD7 | Client-only in-memory cache, `role\|windowStart\|duration` key | Cheap, correct, dropped on Clear; survives tab switches via `hidden`-toggle mounting |
| AD8 | Generation guard on every async path | Reuses the proven `sessionRef` idiom for discovery, fetch, and extend |

---

## Acceptance Criteria

1. A new **Focused** tab appears; switching tabs never resets other pages (they stay mounted via `hidden`).
2. Entering a valid anchor + role and clicking **Discover** issues exactly one window query (`anchor−24h`, 48h) and populates `windowStart`, `discoveredDuration`, and initial rows.
3. Discovery with zero rows shows "no cycles" error, not a truncation warning. Discovery whose earliest row is within 1h of the query boundary shows the truncation warning.
4. Fetch and Extend are disabled until discovery succeeds. Extend input clamps to `[discoveredDuration, 168]`.
5. Fetching a `role|windowStart|duration` already in cache performs **no network call**. A failed fetch keeps last-good rows and does not populate the cache. Clear empties the cache and resets state (controls retained).
6. Four gauges render (Kusto rows/sec, Cosmos batches/sec, Compression rows/event, Checkpoint velocity src/wall sec); needle = window mean; dial range and p95 from per-cycle values; null inputs show `—`.
7. Checkpoint Velocity table has rows for Intra-band and Band; columns: Level, Total Messages, Min, Mean, Median, P95, Max, Std Dev.
8. Dependency Latency panel has three sub-tables: Iteration Speed (`totalMs`), Kusto (`kustoMs`), Cosmos (`writeMs`). Kusto rows are labeled by `(level, mode)`, only non-empty pairs shown, modes never merged; `unknown` is labeled. Cosmos has Intra-band and Band rows.
9. Existing `AppInsightsPage` is visually and numerically unchanged (still five gauges, no Cosmos dial).
10. Server accepts the window branch (`startTimeUtc` + `durationHours`), rejects bodies mixing both modes, rejects unparseable `startTimeUtc` and out-of-range `durationHours`, and still rejects arbitrary `kql`.
11. `npm test`, `npm run typecheck:test`, `npm run typecheck:server`, and `npm run build` all pass.

---

## Implementation Tasks

| ID | Task | Depends on | Files |
|---|---|---|---|
| T1 | Add `cosmosWriteThroughputBatchesPerSec` to `ThroughputGaugeMetrics`; add `GaugeKey`, `DEFAULT_GAUGE_KEYS`, per-gauge stable keys, Cosmos gauge definition, and `gauges?` prop. Update `computeThroughputStats` to set new field `null`. | — | `RunThroughputGauges.tsx` |
| T2 | Implement `describeDistribution` with exact stat rules. Unit tests. | — | `derive.ts`, `derive.test.ts` |
| T3 | Implement `computeFocusedThroughput` (mean-based `metrics`, unique `iterationId`, Cosmos per-cycle formula). Unit tests. | T1 (type) | `derive.ts`, `derive.test.ts` |
| T4 | Implement `computeFocusedKpis` (level split, `(level,mode)` Kusto with count≥1 filter, Cosmos per level). Unit tests. | T2 | `derive.ts`, `derive.test.ts` |
| T5 | Server `QueryParams` union + `validateParams` window branch (ambiguity guard, injection guard retained). Tests via fake client. | — | `queryEngine.ts`, `queryEngine.test.ts` |
| T6 | Factor `CYCLE_PROJECTION_KQL`, add `WINDOW_TIME_FILTER`, branch `queryCompletedCycles` with escaping and single computed `end`. Covered by `typecheck:server` + review. | T5 | `azureMonitorClient.ts` |
| T7 | Widen `LiveQueryParams`/live payload in `query.ts`. Tests for both payload variants. | T5 | `query.ts`, `query.test.ts` |
| T8 | Create `FocusedDashboardPage.tsx`: state, anchor-to-ISO, discovery, extend/clamp, fetch, cache, generation guard, render layout. | T1, T3, T4, T7 | `FocusedDashboardPage.tsx` |
| T9 | Register `'focused'` in `PageKey`, `PAGES`, and tabpanel in `AppShell.tsx`. Update `AppShell.test.tsx`. | T8 | `AppShell.tsx`, `AppShell.test.tsx` |
| T10 | Integration/regression: run `npm test`, `npm run typecheck:test`, `npm run typecheck:server`, `npm run build`. Fix fallout. | T1–T9 | — |

---

## Task Dependency Graph

```
T1 ──────────────────────────────────────────────────────┐
T2 ──► T4 ──────────────────────────────────────────────┐│
        T3 (needs T1) ──────────────────────────────────┤│
T5 ──► T6                                               ││
T5 ──► T7 ──────────────────────────────────────────────►T8 ──► T9 ──► T10
```

---

## Parallel Execution Strategy

| Wave | Tasks | Notes |
|---|---|---|
| A (parallel) | T1, T2, T5 | Independent files: `RunThroughputGauges.tsx`, `derive.ts` (new fns), `queryEngine.ts` |
| B (parallel) | T3 (after T1), T4 (after T2), T6 (after T5) | Can start as soon as respective dependencies land |
| C | T7 (after T6) | Server contract shapes client payload |
| D | T8 (after T1/T3/T4/T7) → T9 → T10 | Sequential page build + shell wiring + gates |

`derive.ts` hosts T2/T3/T4; sequence intra-file to avoid edit conflicts or land as one commit.

---

## Testing Strategy

All tests follow repo conventions: colocated `*.test.ts`, `vitest`, **no Azure SDK import** (tests import `queryEngine.ts` and use a hand-written fake client, never `azureMonitorClient.ts`).

**`derive.test.ts` additions:**
- `describeDistribution`: empty → all null/count 0; single value → stdDev 0, median = value; even n → midpoint median; p95 nearest-rank at expected index; `null`/`NaN` values filtered; `n=2` edge case.
- `computeFocusedThroughput`: Cosmos formula; null when `writeMs=0`/null/`outcome !== 'success'`; `metrics` equals mean of per-cycle finite values; `iterationId` uniqueness for repeated `runId`.
- `computeFocusedKpis`: `continuation` → intraBand, `bandCommit` → band; `(level, mode)` pairs never merged; empty pairs omitted; `unknown` mode surfaces when present; Cosmos per level; `noWork` rows excluded.

**`queryEngine.test.ts` additions:**
- Window branch accepted and forwarded as `{appRoleNameFilter, startTimeUtc, durationHours}`.
- Mixed body (`lookbackHours` + `startTimeUtc`) rejected.
- Non-parseable `startTimeUtc` rejected.
- `durationHours ≤ 0` and `> 168` rejected.
- Boundary values `0.25` (lookback) and `168` (both) accepted.
- Arbitrary `kql`/`query` field still rejected.
- Existing lookback path unchanged.

**`query.test.ts` additions:**
- Live window payload serializes only `appRoleNameFilter`, `startTimeUtc`, `durationHours`.
- Live lookback payload serializes only `appRoleNameFilter`, `lookbackHours`.

**`AppShell.test.tsx`:**
- Four tabs with correct IDs, labels, ARIA attributes, and `hidden` state logic.
- Keyboard nav (arrow keys, Home, End) works across four tabs.

**Validation commands (in order):**
```
npm test
npm run typecheck:test
npm run typecheck:server
npm run build
```

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Gauge default regresses existing page (renders Cosmos when not wanted) | `gauges` defaults to `DEFAULT_GAUGE_KEYS` (original five); add assertion that `AppInsightsPage` passes no `gauges` prop and renders exactly five dials |
| KQL/SDK time bounds disagree and silently drop rows | Single computed `end` value reused for both; code-review checklist item |
| KQL drift between lookback and window variants | Shared `CYCLE_PROJECTION_KQL` constant (no duplication) |
| Stale discovery or fetch response overwrites newer state | Monotonic `sessionRef` generation guard on all async paths |
| Invalid/empty anchor crashes `toISOString()` | Discovery/Fetch gated behind `anchorIso !== null` check |
| Mode blending in Kusto latency KPIs | `(level,mode)` keying; unit test asserts no blended row |
| `azureMonitorClient.ts` untestable without Azure SDK | Cover by `typecheck:server` + code review; logic is thin and the `queryEngine` tests mirror the validation path |
| Cache key collisions across roles or durations | Full triple `role|start|duration.toFixed(4)` key; roles trimmed consistently |
| "Window may be truncated" warning missed | Epoch-ms comparison both sides in UTC; tested with a row exactly 1h from query boundary |

---

## Rollout Plan

1. Land T1–T9 behind the new tab (no existing surface changes). The server change is backward-compatible (lookback callers unaffected by the union addition).
2. Run all four verification commands locally; ensure green.
3. Manual smoke test:
   - `npm run dev` + `npm run server` (with real `WORKSPACE_ID` + `az login`)
   - Discover a known run → verify `windowStart`, `discoveredDuration`, and initial rows
   - Extend duration → verify new Fetch issues a network call (not a cache hit)
   - Re-Fetch with same parameters → verify cache hit (no second network call in devtools)
   - Clear → verify state reset and next Fetch re-queries
4. Confirm existing App Insights, Poll, and Benchmark tabs are unchanged.
5. Ship. No migration, feature flag, or configuration change required.

---

## Success Metrics

- Existing suites remain green; new pure-function tests added and passing.
- Operator can go anchor → discovered window → focused gauges/KPIs with ≤ 2 network calls (discover + fetch), and 0 on cache hit.
- No mode-blended latency numbers displayed (verified by `computeFocusedKpis` tests).
- Zero changes to existing page outputs (diff-reviewed; `AppInsightsPage` passes no `gauges` prop and still renders five dials).

---

## Implementation Minimization Summary

### Files Changed
| File | Nature of change |
|---|---|
| `src/AppShell.tsx` | +3 small edits: `PageKey`, `PAGES`, tabpanel `div` |
| `src/FocusedDashboardPage.tsx` | **New file** |
| `src/components/RunThroughputGauges.tsx` | New metric field, `GaugeKey`, Cosmos gauge entry, `gauges?` prop |
| `src/appinsights/derive.ts` | Three new pure functions; set Cosmos field `null` in `computeThroughputStats` |
| `src/appinsights/query.ts` | Widen `LiveQueryParams` + live payload |
| `server/queryEngine.ts` | `QueryParams` union + `validateParams` |
| `server/azureMonitorClient.ts` | Factor KQL body, add window branch + SDK timespan |
| `src/AppShell.test.tsx` | Assert 4 tabs |
| `src/appinsights/derive.test.ts` | New distribution/throughput/kpis tests |
| `server/queryEngine.test.ts` | New window branch tests |
| `src/appinsights/query.test.ts` | New payload variant tests |
| `src/styles.css` | Minimal additions if existing table classes don't cover the new layout |

### Files Intentionally Untouched
- `src/AppInsightsPage.tsx`, `src/App.tsx`, `src/PollTelemetryPage.tsx`
- `src/appinsights/normalize.ts`, `src/appinsights/types.ts`
- `server/httpServer.ts`, `server/config.ts`, `server/appInsightsQueryServer.ts`
- `package.json`, `vite.config.ts`, `tsconfig*.json`

### Reused Components
- `ThroughputGaugeGrid` / `Gauge` SVG
- `Panel`, `formatNumber`, `formatDuration`, `formatCompactNumber`
- `loadCompletedCycles` + `normalizeRows`
- Loopback server + `classifyQueryError`
- `sessionRef` generation-guard idiom
- Existing `percentile()` helper (p95 formula kept consistent)

### Complexity Avoided
- No separate "boundaries" server endpoint
- No persistent storage (localStorage/IndexedDB)
- No KQL duplication (factored body)
- No new gauge SVG component
- No RTL/browser-automation tooling
- No ratio-of-sums reuse for the focused needle (prevents a subtle numeric mismatch)

### Rejected Designs

| Design | Rejection reason |
|---|---|
| Default gauge renders all six including Cosmos | Silently mutates existing `AppInsightsPage` output (adds a "—" Cosmos dial); Cosmos is opt-in |
| Separate copy of 100-line KQL for window variant | KQL drift risk; factored instead |
| Mean-less reuse of `computeThroughputStats` for focused needle | That function uses ratio-of-sums; the focused page requires per-window mean — they differ and must be distinct |
| Blended Kusto latency in a single distribution | Violates the `types.ts` timing-boundary contract |
| Two-flank discovery (two queries, merge, dedup) | Single centered-window query (anchor ± 24h) is simpler and correct for typical run sizes; truncation warning covers edge cases |
| `gauges` prop with generic GaugeKey[] type | Accepted — it is the minimal correct API; the subset is a named constant in the page, preventing unsupported combinations |
| Cache hit test using network spy | The page checks `cacheRef` before calling `loadCompletedCycles`; tests can assert `cache.size` and row-reference identity instead |
