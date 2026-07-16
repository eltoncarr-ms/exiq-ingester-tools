# Kusto benchmark visualizer live run stats plan

## Scope

Improve `tools/kusto-benchmark-visualizer` so benchmark artifacts are easier to interpret during and after a Kusto ingestion run. The visualizer should use real wall-clock timestamps, support last-window filters, emphasize selected-run stats instead of comparison-first UX, explain and improve the ingestion stage timeline, clarify flush volume rendering, and support a local live-file workflow where the browser polls a selected `kusto-benchmark-run.json` while `ExIQ.Ingestion.Client` continues writing incremental metrics.

Changes may span:

- `D:\azure-portal\exiq-ingester-tools-kusto-benchmark\tools\kusto-benchmark-visualizer`
- `D:\azure-portal\exiq-ingester-client1\src\ExIQ.Ingestion.Hosting\Benchmarking`
- `D:\azure-portal\exiq-ingester-client1\src\ExIQ.Ingestion.Client\appsettings.Kusto.json`

## Non-goals

- Do not introduce a backend service for the visualizer.
- Do not send benchmark artifacts outside the browser.
- Do not require Azure, Kusto, or Cosmos access for visualizer tests.
- Do not commit changes.

## Desired user workflow

1. Start `ExIQ.Ingestion.Client` with Kusto benchmark collection enabled.
2. Open `kusto-benchmark-visualizer`.
3. Select `kusto-benchmark-run.json` with the live-watch picker.
4. As the client completes more iterations and rewrites the artifact, the visualizer polls the selected file and refreshes charts without a page reload.

## Acceptance criteria

1. **Wall-clock x-axes:** Timeline and metric charts display local date/time ticks derived from artifact timestamps instead of relative labels like `0 ms` and `14.5 min`.
2. **Time filter:** The selected run can be filtered to at least `All`, `Last 5 min`, and `Last 15 min`. Filtering updates stage timeline, throughput, checkpoint, blocker, backlog, memory, and flush visualizations.
3. **Run stats orientation:** The top panel is labeled and structured as selected-run statistics. Multi-run support remains available, but single-run usage no longer presents as comparison-first.
4. **Stage timeline clarity:** The ingestion stage timeline includes explanatory copy and renders each measured stage by wall-clock position. Uninstrumented elapsed time is visible as an explicit "Unaccounted" lane when `total` exceeds the sum of named stages.
5. **Flush visualization clarity:** Flush rendering uses flush document volume as the primary visual value and shows full/partial flush counts as markers/labels, avoiding a stacked bar that mixes flush counts with document counts.
6. **Live file polling:** On browsers with File System Access API support, users can pick and watch a benchmark JSON file. The app polls the file in the background, replaces the existing loaded run on successful parse, keeps the previous valid run on transient parse errors, and surfaces live status.
7. **Manual fallback:** Drag/drop and standard file picker continue to load static artifacts on browsers without live-file support.
8. **Incremental artifact writing:** When configured, `ExIQ.Ingestion.Client` writes a complete, atomically replaced `kusto-benchmark-run.json` after each completed benchmark iteration, not only at run completion.
9. **Final artifact compatibility:** Final run artifacts remain schemaVersion `1` and continue to load in the visualizer.
10. **Tests:** Visualizer derivation/parsing tests cover wall-clock filtering and live replacement behavior. ExIQ benchmark tests cover incremental snapshot writing and atomic writer behavior where practical.
11. **Benchmark honesty:** Live run snapshot writes do not rebuild averaged summary artifacts after every iteration; summary recomputation remains final-only unless explicitly requested later.
12. **Stable live identity:** A watched file updates one stable loaded-run slot keyed by the file handle/source label, preserving selection and avoiding duplicate rows.

## Task breakdown for parallel execution

### Developer A - Visualizer data model and charts

- Add wall-clock timestamps to derived series and timeline segments.
- Add range filtering helpers for `All`, `Last 5 min`, and `Last 15 min`.
- Update chart x-axis formatting to local date/time.
- Add an "Unaccounted" stage lane when named stage timings do not fill `timingsMs.total`.

### Developer B - Visualizer UX and live file loading

- Replace comparison-first top panel with a selected-run stats panel.
- Add time filter controls and live status indicators.
- Add File System Access API watch mode with polling.
- Preserve static drag/drop and picker behavior.

### Developer C - Flush visualization

- Replace confusing stacked full/partial flush chart with a document-volume chart.
- Use flush documents as the primary bar height.
- Show full/partial flush counts as badges/tooltips and support filtering.

### Developer D - ExIQ incremental artifact writing

- Add a Kusto benchmark option to write live run snapshots as iterations complete.
- Update recorder and scheduler to await per-iteration snapshot writes.
- Write JSON artifacts atomically to reduce partial-read failures while the visualizer polls.
- Keep final summary behavior unchanged.

### Dev Team Manager

- Validate task integration against acceptance criteria.
- Run targeted tests/builds.
- Perform local pending-change review.
- Ensure no commits are created.

## Test plan

Visualizer:

- `parseBenchmarkFileText` still accepts existing schemaVersion `1` run and summary artifacts.
- Derived analysis produces absolute x-axis timestamps from `startedAtUtc`, iteration completion times, and memory sample timestamps.
- `filterRunAnalysisByRange` returns only points/segments within the last 5 or 15 minutes relative to the selected run's latest timestamp.
- Flush volume points use `flushDocuments` for primary value and retain full/partial counts.
- Live file replacement updates the existing loaded run instead of appending duplicate rows.

ExIQ benchmark writer:

- Incremental snapshot writing is disabled by default unless configured.
- When enabled, completing an iteration writes a valid run artifact with completed iterations and current summary.
- Final completion still writes the final run artifact and summary.
- Atomic write path leaves a readable final JSON file.

## Review cycle

### Review 1 - Gaps found

- Browser drag/drop `File` objects are snapshots and cannot be reread as the underlying file changes.
- Live polling could read during a write and briefly see invalid JSON.
- Current artifact writer only writes on `CompleteRunAsync`, so visualizer polling alone is insufficient.
- The current timeline hides unaccounted elapsed time between measured stages and `total`.
- Existing flush chart uses full/partial flush counts for bar height but includes document count in tooltip, mixing units.

### Review 1 - Corrections

- Add live-watch mode based on the File System Access API and keep drag/drop as static fallback.
- Keep the last valid artifact on transient parse failure and surface the error in live status.
- Add client-side incremental snapshot writes after iteration completion.
- Make artifact writes atomic with temp-file replace.
- Add "Unaccounted" as an explicit timeline lane.
- Rework flush chart around document volume, with full/partial counts as metadata.

### Review 2 - Gaps found

- Time filters need a deterministic anchor for static and live artifacts.
- Multi-run support should not disappear when reorienting to run stats.
- The visualizer should remain dependency-light and not introduce a charting framework for this incremental UX change.

### Review 2 - Corrections

- Anchor filters to the selected run's latest observed timestamp (`completedAtUtc`, point timestamps, or memory samples), which naturally advances during live refresh.
- Keep a compact loaded-runs selector/table below the run stats cards.
- Continue using existing SVG components and React state only.

### Review 3 - Gaps found

- Reusing the existing artifact writer `WriteAsync` for every live snapshot would also rebuild the averaged summary by rescanning run files after each iteration, adding avoidable benchmark overhead.
- Live file replacement needs a stable identity to prevent duplicate rows and preserve selection.
- Time-filtered charts and top-level stat cards could disagree if one is filtered and the other is not.
- The "Unaccounted" stage must be explained geometrically to avoid implying it is a real ingestion stage.

### Review 3 - Corrections

- Split run-artifact snapshot writing from summary rebuilding. Per-iteration live snapshots write only `kusto-benchmark-run.json`; final completion continues writing the run artifact and optional summary.
- Key watched artifacts with a stable `live:<sourceName>` id and upsert that loaded run in place.
- Keep headline run stats full-run by default and label them "Full run"; add a small selected-window summary near the time filter for filtered chart scope.
- Render "Unaccounted" as a residual tail segment per iteration from the end of the last measured stage to `timingsMs.total`; label it as "elapsed time not attributed to named benchmark stages."

## Rubber-duck notes

- If the visualizer watches a file that is rewritten atomically, polling every 2-3 seconds is enough for human feedback and avoids excessive reads.
- The live artifact represents completed iterations, not in-flight sub-stage telemetry; this is acceptable for the current workflow because the recorder does not expose a streaming event protocol.
- A future enhancement could add NDJSON or websocket-style streaming, but this plan avoids backend infrastructure and preserves the static artifact contract.

## Final readiness

No major planning gaps remain. The feature is ready for local implementation with the task split above.
