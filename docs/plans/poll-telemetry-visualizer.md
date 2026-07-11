# Poll telemetry visualizer

## Decision

Add a **Poll Telemetry** page to the existing Kusto benchmark visualizer. Keep the benchmark page and its parser unchanged, and share only generic UI primitives, formatting, file-picker patterns, and chart styles.

The raw `PollTelemetry__Sink=jsonl` stream is a different contract from benchmark JSONL: it is an append-only mixture of `stage` and `cycle` records, and each `runId` identifies one poll cycle. The new page therefore uses an isolated poll parser and data model.

## Scope

- Load a static poll telemetry `.jsonl` file.
- Optionally live-poll a file selected through the File System Access API.
- Group completed cycles by `source`; buffer unmatched stage records by `runId`.
- Show only supported metrics:
  - cycle count and success/skipped/failed outcomes
  - total records and users
  - average cycle duration
  - average records/sec for successful cycles
  - latest cursor lag
  - average Kusto, map, write, and advance duration when present
  - total write RU when present
- Show wall-clock throughput trends for records/sec and records/cycle.
- Select a cycle and interactively scrub, play, pause, restart, and change playback speed for its stage timeline.
- Surface malformed/unknown lines as non-fatal warnings.

## Acceptance criteria

1. Loading valid mixed `stage` and `cycle` NDJSON produces source-specific dashboards without changing the benchmark page.
2. Dashboard totals and averages use completed cycle records only; stage-only cycles do not affect them.
3. Optional metrics omit missing values rather than displaying `NaN`, zero-shaped fallbacks, or misleading averages.
4. Successful-cycle throughput is plotted by cycle completion time. Skipped and failed cycle counts remain visible but do not reduce the throughput average.
5. Interleaved sources can be selected independently, filtering metrics, trends, cycle selection, and replay.
6. Malformed JSON, unknown record types, and invalid records increment a visible warning count while valid lines continue loading.
7. A partial trailing JSON line is retained and parsed after the remaining bytes arrive, without duplicate records.
8. The timeline renders the selected cycle's stages from the final `cycle.timeline`, falling back to matched stage events for incomplete cycles.
9. Timeline playback supports play/pause, restart, scrubbing, and speed selection, and exposes the active stage and elapsed time.
10. Existing benchmark tests plus new poll parser, incremental reader, and derivation tests pass; production and test TypeScript builds succeed.

## Implementation tasks

1. **Telemetry contract developer**
   - Add poll-specific types, permissive line validation, batch parsing, and synthetic fixtures.
   - Test success, skipped, failed, malformed, unknown, optional fields, and multi-source records.
2. **Streaming and analytics developer**
   - Add incremental NDJSON chunk parsing with trailing-line carryover.
   - Derive source series, guarded aggregates, trends, cycle selection, and timeline frames.
   - Test partial lines, no duplication, optional-field denominators, and stage/cycle joining.
3. **Visualization developer**
   - Add key metric cards, throughput charts, cycle selector/table, and interactive timeline replay using existing `Panel`, `LineChart`, formatting, and SVG styling.
4. **Integration developer**
   - Add the Poll Telemetry page, static/live file loading, source selection, warnings, and a dependency-free two-page app shell.
   - Update tool documentation.
5. **Dev Team Manager**
   - Review every change against these criteria, run targeted and full validation, return defects for correction, and audit the final diff for unnecessary changes.

## Test plan

- Parser: valid stage/cycle lines; minimal skipped cycle; partial failed cycle; malformed JSON; unknown type; invalid required fields.
- Incremental reader: complete chunks, split JSON across chunks, multiple lines plus carryover, final carry flush, and no duplicate emission.
- Derivation: source grouping, stage-to-cycle joining, successful-only throughput, guarded optional averages/totals, outcome counts, and timeline fallback.
- UI/build: render through normal TypeScript/Vite compilation; use pure derived-model tests for playback data and keep component state minimal.
- Regression: run the existing benchmark parser, derive, and drop-zone tests unchanged.

## Review-cycle resolutions

- `runId` is modeled as a cycle identifier, never as a benchmark run.
- The benchmark JSONL loader is not reused because it intentionally reads only the latest iteration snapshot.
- Stage records are joined by `runId`; source is assigned only after a matching cycle arrives.
- Failed-cycle `failingStage` is treated as optional because producer disposal can clear the active stage; replay uses recorded stages and the error type without inventing a fault location.
- Throughput uses wall-clock cycle completion time, not source window time.
- No router or chart dependency is added.
- Producer telemetry limitations are represented as missing data rather than fixed in this separate repository.

## Final rubber-duck result

No major architecture gaps remain. The minimal safe design is an isolated poll data path behind a simple page switch, with completed-cycle analytics and per-cycle replay. The principal data-quality limitations are handled explicitly through optional metrics and warning states.
