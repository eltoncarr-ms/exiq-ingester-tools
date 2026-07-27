# Kusto Benchmark Queue Visualization Plan

## Goal

Replace the current "Ingestion stage timeline" with two compact panels that explain where each Kusto client is in the virtual shard processing pipeline:

1. A processing-window panel showing shard/window boundaries, current observation time, watermark/checkpoint state, current-window message count, total shard message count, and backlog.
2. A queue visualization panel showing messages in the current processing window, their status transitions, flush/checkpoint events, blocking state, and live additions as `kusto-benchmark-run.json` refreshes.

The memory profile chart also needs an inline legend/labels so each line is self-identifying.

## Scope and repository rules

- Kusto benchmark visualizer changes are made locally in this repository under `tools\kusto-benchmark-visualizer`.
- Ingestion client producer changes are required for the full live queue feature and must be made in a separate worktree rooted from `D:\azure-portal\exiq-ingester-client1`.
- No commits are created.
- Existing local changes must not be reverted or overwritten.
- Existing benchmark artifacts remain supported through additive optional schema fields; `schemaVersion` stays `1` unless a breaking change is introduced.

## Current-state findings

- Existing visualizer artifacts contain per-iteration `windowStartUtc`, `windowEndUtc`, aggregate counts, final checkpoint fields, and memory samples.
- Existing live snapshots are written only after `CompleteIterationAsync`, and live snapshots exclude incomplete iterations. That cannot show in-flight message additions or moving checkpoint/watermark state.
- Existing aggregate counts cannot truthfully reconstruct per-message state transitions. Old artifacts can only support an explicit aggregate fallback view.
- Ingestion client has access to real message state through `PartitionBatchOrchestrator.Messages`, `BatchStats`, `PartitionMessage.Status`, and Kusto lease/window metadata.

## Additive artifact model

Add optional per-iteration pipeline data to the run artifact:

```ts
interface BenchmarkIteration {
  // Existing fields omitted.
  pipeline?: IterationPipeline;
}

interface IterationPipeline {
  snapshotAtUtc: string;
  shardId: string;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  currentTimeUtc: string;
  watermarkUtc: string | null;
  candidateWatermarkUtc: string | null;
  checkpointAdvancedToUtc: string | null;
  totalShardMessages: number;
  currentWindowMessages: number;
  backlogMessages: number;
  blockedMessages: number;
  statusCounts: {
    pending: number;
    done: number;
    skipped: number;
    duplicateAcknowledged: number;
    poisoned: number;
  };
  messages: PipelineMessageSample[];
  events: PipelineEvent[];
}

interface PipelineMessageSample {
  ordinal: number;
  rowId: string | null; // PartitionMessage.Offset for Kusto row id when available.
  sessionId: string | null; // PartitionMessage.PartitionKey.
  enqueuedTimeUtc: string;
  status: 'pending' | 'done' | 'skipped' | 'duplicateAcknowledged' | 'poisoned';
  skipReason?: string | null;
}

interface PipelineEvent {
  atUtc: string;
  kind: 'read' | 'rehydrate' | 'process' | 'flush' | 'checkpoint' | 'blocked';
  label: string;
  messageCount?: number;
  watermarkUtc?: string | null;
}
```

Producer cap: retain at most 500 sampled messages per iteration snapshot, ordered by source ordinal, while status counts and aggregate totals always reflect the full window.

## Acceptance criteria

1. The "Ingestion stage timeline" panel is no longer rendered in the Kusto benchmark visualizer.
2. A processing-window panel renders for the selected run and shows shard id, window start, window end, current observation time, watermark/checkpoint state, current-window message count, total shard message count, and backlog count.
3. The processing-window panel visualizes the timeline with the current window highlighted and markers for current time and checkpoint/watermark. For old artifacts, the watermark marker is static and derived only from `checkpoint.advancedTo`; null is shown as "not advanced".
4. When a live artifact has multiple active shards, the visualizer provides a shard selector and does not flicker between shards on refresh. The default selection remains stable when possible and otherwise chooses the most recent active shard.
5. Within the selected shard, the current processing window is the latest incomplete iteration when present; otherwise it is the most recent completed iteration. A queue visualization panel renders that selected shard/window. With pipeline samples it shows sampled messages colorized by status, capped/virtualized for performance, plus event markers for read/process/flush/checkpoint/blocked. With old artifacts it shows an explicitly labeled aggregate fallback, not fabricated per-message cells.
6. Live refreshes update the selected shard's window, queue status counts, sampled message states, flush events, checkpoint marker, and backlog as the JSON file changes.
7. Ingestion client live snapshots include incomplete iterations and are triggered after meaningful phase events, not only after iteration completion.
8. Additive producer fields are optional; old run and summary artifacts continue to parse and display.
9. The memory profile chart includes a visible legend/labels for Managed, Working set, and GC heap.
10. Targeted tests cover optional schema parsing/derivation, old-artifact fallback, shard selection stability, producer serialization, live incomplete snapshot inclusion, and message sample cap.
11. Validation passes for the Kusto visualizer build/tests and targeted ingestion-client tests in the worktree.

## Task breakdown for parallel execution

### Developer A: Visualizer data model and derivation

- Extend `tools\kusto-benchmark-visualizer\src\benchmark\types.ts` with optional pipeline interfaces.
- Update `parse.ts` with tolerant optional validation for pipeline fields.
- Update `derive.ts` to produce:
  - `pipelineSnapshots`
  - `selected/default shard options`
  - aggregate fallback snapshots for old artifacts
  - stable latest-shard selection inputs
- Add tests for new optional fields, fallback derivation, and time-range filtering behavior.

### Developer B: Visualizer panels

- Add `ProcessingWindowPanel.tsx`.
- Add `QueueVisualizationPanel.tsx`.
- Reuse replay-visualizer color semantics for statuses:
  - pending: cyan/blue
  - done: green
  - skipped: amber/muted
  - duplicate acknowledged: purple
  - poisoned/blocked: rose/orange
- Replace `<Timeline />` usage in `App.tsx` with the two new panels.
- Add shard selector state in `App.tsx` that remains stable across live refreshes.
- Add CSS for compact timeline, queue grid, event markers, legends, and fallback aggregate bars.

### Developer C: Memory profile labeling

- Add a reusable chart legend or per-chart legend markup to `MetricCharts.tsx`/`Charts.tsx`.
- Ensure the memory chart visibly maps line color to Managed, Working set, and GC heap without relying only on hover titles.
- Add or update CSS for legends.

### Developer D: Ingestion client producer worktree

- Create a worktree for `D:\azure-portal\exiq-ingester-client1` before editing.
- Extend benchmark artifact records with optional pipeline snapshot records.
- Extend `IIngestionBenchmarkMetrics` and null recorder with safe no-op methods for:
  - read page/window observation
  - repository/message status snapshot
  - phase event recording
  - flush/checkpoint/blocking observation
- Instrument `KustoWorkUnitLease`, `PartitionBatchOrchestrator`, `PartitionBatchRunner`, and checkpoint/flush paths using real `PartitionMessage` and `BatchStats` data.
- Change live snapshot writing so it both includes incomplete iterations and is triggered after meaningful phase events.
- Verify `IterationBuilder.Build()` returns coherent partial iterations before wiring phase-event live snapshots.
- Cap sampled messages to 500 while keeping aggregate totals exact.
- Add targeted unit tests for serialization shape, incomplete live snapshots, phase-event snapshots, status counts, and sample cap.

### Dev Team Manager

- Coordinate implementation sequence:
  1. Visualizer fallback/data model can start immediately.
  2. Producer worktree starts in parallel after current client branch/worktree state is recorded.
  3. Visualizer pipeline-sample rendering integrates once the producer schema shape is stable.
- Review all changed files against acceptance criteria.
- Run targeted validations.
- Confirm no commits were created.
- Run a final local pending-change review. If a `pr-lifecycle` agent is unavailable, use the available code-review agent against the local diff.

## Review cycle notes

### Review cycle 1 findings and resolutions

- Producer instrumentation is required, not optional. Resolved by making Developer D a required workstream.
- Live motion requires both incomplete iterations and phase-event snapshot triggers. Resolved in acceptance criteria and Developer D tasks.
- Fallback watermark semantics were misleading. Resolved by showing only `advancedTo` as a static marker for old artifacts.
- Multiple active shards need deterministic selection. Resolved by adding a shard selector and stable selection acceptance criterion.
- Aggregate counts must not be rendered as fake messages. Resolved by requiring an aggregate fallback.

## Test plan

### Visualizer

- `npm --prefix .\tools\kusto-benchmark-visualizer run test`
- `npm --prefix .\tools\kusto-benchmark-visualizer run build`

Coverage targets:

- Parse accepts artifacts with and without optional pipeline data.
- Derive chooses stable shard options and fallback snapshots.
- Queue fallback is labeled aggregate-only.
- Time range filtering does not drop currently selected pipeline context unexpectedly.

### Ingestion client worktree

- Run targeted unit tests covering benchmark artifacts and affected ingestion pipeline metrics.
- Escalate to broader test selection only if targeted tests expose integration gaps.

Coverage targets:

- Live snapshot includes incomplete active iteration after a phase event.
- Pipeline status counts reflect `BatchStats` and `PartitionMessage.Status`.
- Message sample cap limits sampled messages while totals stay exact.
- Additive JSON remains deserializable through existing serializer options.

## Risks and mitigations

- JSON growth: cap sampled messages at 500 and store aggregate totals separately.
- Live write frequency: trigger on meaningful phase transitions, not every message mutation.
- Old artifact ambiguity: render old data as aggregate fallback and label it clearly.
- Multi-shard refresh flicker: stable selected shard id with explicit selector.
- Producer worktree safety: do not edit `D:\azure-portal\exiq-ingester-client1` directly.
- Visualizer performance: virtualize/slice queue cells and avoid rendering every message when samples are capped.

## Finalized implementation stance

The full feature requires both visualizer and ingestion-client work. The visualizer will remain backward compatible with existing artifacts, but the live queue/state-transition experience is accepted only when the ingestion client emits pipeline snapshots in live `kusto-benchmark-run.json` updates.
