import type {
  BenchmarkArtifact,
  BenchmarkIteration,
  BenchmarkSummary,
  BenchmarkSummaryArtifact,
  MemoryMetrics,
  PipelineEvent,
  PipelineMessageSample,
  PipelineStatusCounts,
  StageTimingKey,
  TimingMetrics,
} from './types';

export const STAGE_DEFINITIONS: ReadonlyArray<{ key: StageTimingKey; label: string; color: string }> = [
  { key: 'leaseAcquire', label: 'Lease acquire', color: '#8b5cf6' },
  { key: 'pollKusto', label: 'Poll Kusto', color: '#22d3ee' },
  { key: 'messageStoreSetup', label: 'Store setup', color: '#38bdf8' },
  { key: 'rehydrateMessageState', label: 'Rehydrate state', color: '#60a5fa' },
  { key: 'duplicateSourceRows', label: 'Dup source rows', color: '#2dd4bf' },
  { key: 'processMessagesToEvents', label: 'Process events', color: '#34d399' },
  { key: 'flush', label: 'Flush', color: '#f59e0b' },
  { key: 'advanceCheckpoint', label: 'Advance checkpoint', color: '#f472b6' },
];

export const UNACCOUNTED_STAGE = {
  key: 'unaccounted',
  label: 'Unaccounted',
  color: '#64748b',
} as const;

export type TimelineStageKey = StageTimingKey | typeof UNACCOUNTED_STAGE.key;

export const TIMELINE_STAGE_DEFINITIONS: ReadonlyArray<{ key: TimelineStageKey; label: string; color: string }> = [
  ...STAGE_DEFINITIONS,
  UNACCOUNTED_STAGE,
];

export const TIME_RANGES = [
  { key: 'all', label: 'All', durationMs: null },
  { key: 'last-5m', label: 'Last 5 min', durationMs: 5 * 60 * 1000 },
  { key: 'last-15m', label: 'Last 15 min', durationMs: 15 * 60 * 1000 },
] as const;

export type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

const TIMING_KEYS: Array<keyof TimingMetrics> = [
  'leaseAcquire',
  'pollKusto',
  'messageStoreSetup',
  'rehydrateMessageState',
  'duplicateSourceRows',
  'processMessagesToEvents',
  'flush',
  'advanceCheckpoint',
  'total',
];

export interface TimelineSegment {
  iterationId: string;
  clientId: string;
  shardId: string;
  stageKey: TimelineStageKey;
  stageLabel: string;
  color: string;
  startMs: number;
  endMs: number;
  startAtMs: number;
  endAtMs: number;
  durationMs: number;
  originalDurationMs: number;
}

export interface SeriesPoint {
  iterationId: string;
  label: string;
  xMs: number;
  xAtMs: number;
  value: number;
}

export interface CheckpointPoint {
  iterationId: string;
  label: string;
  xMs: number;
  xAtMs: number;
  advancedTo: number | null;
  upper: number | null;
  rawAdvancedTo: unknown;
  rawUpper: unknown;
}

export interface FlushPoint {
  iterationId: string;
  label: string;
  xMs: number;
  xAtMs: number;
  fullFlushes: number;
  partialFlushes: number;
  flushDocuments: number;
}

export interface MemoryPoint {
  iterationId: string;
  label: string;
  xMs: number;
  xAtMs: number;
  managedMiB: number;
  workingSetMiB: number;
  gcHeapMiB: number;
}

export interface SummaryRow {
  id: string;
  label: string;
  source: string;
  iterationCount: number;
  durationMs: number;
  throughputEventsPerSecond: number;
  eventsFinalized: number;
  flushDocuments: number;
  fullFlushes: number;
  partialFlushes: number;
  averageTotalMs: number;
  averageBacklogMessages: number;
  maxBacklogMessages: number;
  blockedDurationMs: number;
}

export interface RunThroughputMetrics {
  kustoReadThroughputRowsPerSec: number;
  processingThroughputRowsPerSec: number;
  eventThroughputEventsPerSec: number;
  compressionRateRowsPerEvent: number | null;
  checkpointAdvanceSeconds: number;
  checkpointVelocitySourcePerWall: number;
  cosmosWriteThroughputBatchesPerSec: number | null;
}

export interface IterationThroughputMetrics extends RunThroughputMetrics {
  iterationId: string;
}

export interface PipelineWindowSnapshot {
  source: 'pipeline' | 'aggregate';
  iterationId: string;
  clientId: string;
  shardId: string;
  observedAtUtc: string;
  observedAtMs: number;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  currentTimeUtc: string;
  watermarkUtc: string | null;
  candidateWatermarkUtc: string | null;
  checkpointAdvancedToUtc: string | null;
  rawCheckpointAdvancedTo: unknown;
  currentWindowMessages: number;
  totalShardMessages: number;
  backlogMessages: number;
  blockedMessages: number;
  statusCounts: PipelineStatusCounts;
  messages: PipelineMessageSample[];
  events: PipelineEvent[];
  isIncomplete: boolean;
}

export interface PipelineShardOption {
  shardId: string;
  label: string;
  iterationCount: number;
  latestObservedAtMs: number;
  hasPipeline: boolean;
  hasIncompletePipeline: boolean;
}

export interface RunAnalysis {
  id: string;
  label: string;
  sourceName: string;
  runId: string;
  artifact: BenchmarkArtifact;
  startedAtMs: number;
  completedAtMs: number;
  durationMs: number;
  timelineEndMs: number;
  timelineStartAtMs: number;
  timelineEndAtMs: number;
  latestObservedAtMs: number;
  timelineSegments: TimelineSegment[];
  throughputPoints: SeriesPoint[];
  backlogPoints: SeriesPoint[];
  blockerPoints: SeriesPoint[];
  checkpointPoints: CheckpointPoint[];
  flushPoints: FlushPoint[];
  memoryPoints: MemoryPoint[];
  pipelineSnapshots: PipelineWindowSnapshot[];
  shardOptions: PipelineShardOption[];
  throughputMetrics: RunThroughputMetrics;
  iterationThroughputMetrics: IterationThroughputMetrics[];
  summaryRow: SummaryRow;
}

export interface LoadedRun {
  id: string;
  fileName: string;
  artifact: BenchmarkArtifact;
  analysis: RunAnalysis;
}

export interface LoadedSummary {
  id: string;
  fileName: string;
  artifact: BenchmarkSummaryArtifact;
  summaryRow: SummaryRow;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toEpochMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);

  return Number.isFinite(ms) ? ms : null;
}

function firstFinite(values: Array<number | null | undefined>, fallback: number): number {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? fallback;
}

function coerceComparable(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const timestamp = Date.parse(trimmed);
      return Number.isFinite(timestamp) ? timestamp : null;
    }

    const numeric = Number(trimmed.replaceAll(',', ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function relativeMs(value: unknown, originMs: number, fallback: number): number {
  const epoch = toEpochMs(value);
  if (epoch === null) return fallback;

  return Math.max(0, epoch - originMs);
}

function finiteMax(values: number[], fallback: number): number {
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value > result) {
      result = value;
    }
  }

  return result === Number.NEGATIVE_INFINITY ? fallback : result;
}

function finiteMin(values: number[], fallback: number): number {
  let result = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value < result) {
      result = value;
    }
  }

  return result === Number.POSITIVE_INFINITY ? fallback : result;
}

function iterationDurationMs(iteration: BenchmarkIteration): number {
  const explicit = asNumber(iteration.timingsMs?.total);
  if (explicit > 0) return explicit;

  const startedAt = toEpochMs(iteration.startedAtUtc);
  const completedAt = toEpochMs(iteration.completedAtUtc);
  if (startedAt !== null && completedAt !== null && completedAt >= startedAt) {
    return completedAt - startedAt;
  }

  return STAGE_DEFINITIONS.reduce((sum, stage) => sum + asNumber(iteration.timingsMs?.[stage.key]), 0);
}

function kustoReadMs(iteration: BenchmarkIteration): number {
  const kustoRead = iteration.timingsMs?.kustoRead;
  if (!kustoRead) return 0;

  return (
    asNumber(kustoRead.queryBuild) +
    asNumber(kustoRead.executeToFirstRow) +
    asNumber(kustoRead.streamRows) +
    asNumber(kustoRead.mapRows)
  );
}

function checkpointAdvanceSeconds(iteration: BenchmarkIteration): number {
  const previous = coerceComparable(iteration.checkpoint?.previous);
  const advancedTo = coerceComparable(iteration.checkpoint?.advancedTo);
  if (previous === null || advancedTo === null) return 0;

  return Math.max(0, (advancedTo - previous) / 1000);
}

function buildThroughputMetrics(iterations: BenchmarkIteration[]): RunThroughputMetrics {
  let rowsFetched = 0;
  let eventsFinalized = 0;
  let totalMs = 0;
  let totalKustoReadMs = 0;
  let totalAdvanceSeconds = 0;

  for (const iteration of iterations) {
    rowsFetched += asNumber(iteration.counts?.rowsFetched);
    eventsFinalized += asNumber(iteration.counts?.eventsFinalized);
    totalMs += asNumber(iteration.timingsMs?.total);
    totalKustoReadMs += kustoReadMs(iteration);
    totalAdvanceSeconds += checkpointAdvanceSeconds(iteration);
  }

  return {
    kustoReadThroughputRowsPerSec: totalKustoReadMs > 0 ? rowsFetched / (totalKustoReadMs / 1000) : 0,
    processingThroughputRowsPerSec: totalMs > 0 ? rowsFetched / (totalMs / 1000) : 0,
    eventThroughputEventsPerSec: totalMs > 0 ? eventsFinalized / (totalMs / 1000) : 0,
    compressionRateRowsPerEvent: eventsFinalized > 0 ? rowsFetched / eventsFinalized : null,
    checkpointAdvanceSeconds: totalAdvanceSeconds,
    checkpointVelocitySourcePerWall: totalMs > 0 ? totalAdvanceSeconds / (totalMs / 1000) : 0,
    cosmosWriteThroughputBatchesPerSec: null,
  };
}

function buildIterationThroughputMetrics(iterations: BenchmarkIteration[]): IterationThroughputMetrics[] {
  return iterations.map((iteration) => {
    const rowsFetched = asNumber(iteration.counts?.rowsFetched);
    const eventsFinalized = asNumber(iteration.counts?.eventsFinalized);
    const totalMs = asNumber(iteration.timingsMs?.total);
    const readMs = kustoReadMs(iteration);
    const advanceSeconds = checkpointAdvanceSeconds(iteration);

    return {
      iterationId: iteration.iterationId,
      kustoReadThroughputRowsPerSec: readMs > 0 ? rowsFetched / (readMs / 1000) : 0,
      processingThroughputRowsPerSec: totalMs > 0 ? rowsFetched / (totalMs / 1000) : 0,
      eventThroughputEventsPerSec: totalMs > 0 ? eventsFinalized / (totalMs / 1000) : 0,
      compressionRateRowsPerEvent: eventsFinalized > 0 ? rowsFetched / eventsFinalized : null,
      checkpointAdvanceSeconds: advanceSeconds,
      checkpointVelocitySourcePerWall: totalMs > 0 ? advanceSeconds / (totalMs / 1000) : 0,
      cosmosWriteThroughputBatchesPerSec: null,
    };
  });
}

function bytesToMiB(value: number): number {
  return value / 1024 / 1024;
}

function buildMemoryFallback(iteration: BenchmarkIteration, xMs: number): MemoryPoint {
  const memory = iteration.memory ?? ({} as MemoryMetrics);
  const completedAt = toEpochMs(iteration.completedAtUtc);

  return {
    iterationId: iteration.iterationId,
    label: iteration.iterationId,
    xMs,
    xAtMs: completedAt ?? xMs,
    managedMiB: bytesToMiB(asNumber(memory.managedBytes)),
    workingSetMiB: bytesToMiB(asNumber(memory.workingSetBytes)),
    gcHeapMiB: bytesToMiB(asNumber(memory.gcHeapBytes)),
  };
}

function fallbackStatusCounts(iteration: BenchmarkIteration): PipelineStatusCounts {
  const rowsFetched = asNumber(iteration.counts?.rowsFetched);
  const processed = asNumber(iteration.counts?.messagesProcessed);

  return {
    pending: asNumber(iteration.counts?.backlogMessages),
    done: processed,
    skipped: Math.max(0, rowsFetched - processed),
    duplicateAcknowledged: 0,
    poisoned: 0,
  };
}

function isPipelineIncomplete(iteration: BenchmarkIteration): boolean {
  const pipeline = iteration.pipeline;
  if (!pipeline) return false;

  const pendingOrBlocked = asNumber(pipeline.statusCounts.pending) > 0 || asNumber(pipeline.blockedMessages) > 0;
  if (pendingOrBlocked || pipeline.checkpointAdvancedToUtc === null) return true;

  const checkpointAt = toEpochMs(pipeline.checkpointAdvancedToUtc);
  const windowEndAt = toEpochMs(pipeline.windowEndUtc);
  if (checkpointAt !== null && windowEndAt !== null) return checkpointAt < windowEndAt;

  const completedAt = toEpochMs(iteration.completedAtUtc);
  const observedAt = toEpochMs(pipeline.snapshotAtUtc) ?? toEpochMs(pipeline.currentTimeUtc);

  return completedAt !== null && observedAt !== null && observedAt < completedAt;
}

function buildPipelineSnapshot(iteration: BenchmarkIteration, totalShardMessages: number): PipelineWindowSnapshot {
  const pipeline = iteration.pipeline;
  if (pipeline) {
    const observedAtUtc = pipeline.snapshotAtUtc;
    const observedAtMs = toEpochMs(observedAtUtc) ?? toEpochMs(pipeline.currentTimeUtc) ?? toEpochMs(iteration.completedAtUtc) ?? 0;

    return {
      source: 'pipeline',
      iterationId: iteration.iterationId,
      clientId: iteration.clientId,
      shardId: iteration.shardId,
      observedAtUtc,
      observedAtMs,
      windowStartUtc: pipeline.windowStartUtc,
      windowEndUtc: pipeline.windowEndUtc,
      currentTimeUtc: pipeline.currentTimeUtc,
      watermarkUtc: pipeline.watermarkUtc,
      candidateWatermarkUtc: pipeline.candidateWatermarkUtc,
      checkpointAdvancedToUtc: pipeline.checkpointAdvancedToUtc,
      rawCheckpointAdvancedTo: pipeline.checkpointAdvancedToUtc,
      currentWindowMessages: asNumber(pipeline.currentWindowMessages),
      totalShardMessages: asNumber(pipeline.totalShardMessages),
      backlogMessages: asNumber(pipeline.backlogMessages),
      blockedMessages: asNumber(pipeline.blockedMessages),
      statusCounts: pipeline.statusCounts,
      messages: pipeline.messages,
      events: pipeline.events,
      isIncomplete: isPipelineIncomplete(iteration),
    };
  }

  const observedAtUtc = iteration.completedAtUtc || iteration.startedAtUtc;
  const observedAtMs = toEpochMs(observedAtUtc) ?? toEpochMs(iteration.startedAtUtc) ?? 0;

  return {
    source: 'aggregate',
    iterationId: iteration.iterationId,
    clientId: iteration.clientId,
    shardId: iteration.shardId,
    observedAtUtc,
    observedAtMs,
    windowStartUtc: iteration.windowStartUtc,
    windowEndUtc: iteration.windowEndUtc,
    currentTimeUtc: observedAtUtc,
    watermarkUtc: null,
    candidateWatermarkUtc: null,
    checkpointAdvancedToUtc: typeof iteration.checkpoint?.advancedTo === 'string' ? iteration.checkpoint.advancedTo : null,
    rawCheckpointAdvancedTo: iteration.checkpoint?.advancedTo ?? null,
    currentWindowMessages: asNumber(iteration.counts?.rowsFetched),
    totalShardMessages,
    backlogMessages: asNumber(iteration.counts?.backlogMessages),
    blockedMessages: asNumber(iteration.counts?.blockedMessages),
    statusCounts: fallbackStatusCounts(iteration),
    messages: [],
    events: [],
    isIncomplete: false,
  };
}

function buildShardOptions(snapshots: PipelineWindowSnapshot[]): PipelineShardOption[] {
  const groups = new Map<string, PipelineWindowSnapshot[]>();
  for (const snapshot of snapshots) {
    groups.set(snapshot.shardId, [...(groups.get(snapshot.shardId) ?? []), snapshot]);
  }

  return [...groups.entries()]
    .map(([shardId, shardSnapshots]) => ({
      shardId,
      label: shardId,
      iterationCount: shardSnapshots.length,
      latestObservedAtMs: finiteMax(shardSnapshots.map((snapshot) => snapshot.observedAtMs), 0),
      hasPipeline: shardSnapshots.some((snapshot) => snapshot.source === 'pipeline'),
      hasIncompletePipeline: shardSnapshots.some((snapshot) => snapshot.source === 'pipeline' && snapshot.isIncomplete),
    }))
    .sort((left, right) => left.shardId.localeCompare(right.shardId, undefined, { numeric: true }));
}

function summaryToRow(id: string, label: string, source: string, summary: BenchmarkSummary): SummaryRow {
  return {
    id,
    label,
    source,
    iterationCount: asNumber(summary.iterationCount),
    durationMs: asNumber(summary.durationMs),
    throughputEventsPerSecond: asNumber(summary.throughputEventsPerSecond),
    eventsFinalized: asNumber(summary.eventsFinalized),
    flushDocuments: asNumber(summary.flushDocuments),
    fullFlushes: asNumber(summary.fullFlushes),
    partialFlushes: asNumber(summary.partialFlushes),
    averageTotalMs: asNumber(summary.averageTimingsMs?.total),
    averageBacklogMessages: asNumber(summary.averageBacklogMessages),
    maxBacklogMessages: asNumber(summary.maxBacklogMessages),
    blockedDurationMs: asNumber(summary.blockedDurationMs),
  };
}

export function buildRunAnalysis(artifact: BenchmarkArtifact, sourceName: string, id = artifact.run.runId): RunAnalysis {
  const sortedIterations = [...artifact.iterations].sort((left, right) => {
    const leftStart = toEpochMs(left.startedAtUtc) ?? 0;
    const rightStart = toEpochMs(right.startedAtUtc) ?? 0;
    return leftStart - rightStart;
  });

  const startedAtMs = firstFinite(
    [
      toEpochMs(artifact.run.startedAtUtc),
      ...sortedIterations.map((iteration) => toEpochMs(iteration.startedAtUtc)),
      ...sortedIterations.map((iteration) => toEpochMs(iteration.windowStartUtc)),
    ],
    0,
  );
  const completedAtMs = firstFinite(
    [
      toEpochMs(artifact.run.completedAtUtc),
      ...sortedIterations.map((iteration) => toEpochMs(iteration.completedAtUtc)),
      ...sortedIterations.map((iteration) => toEpochMs(iteration.windowEndUtc)),
    ],
    startedAtMs,
  );

  const timelineSegments: TimelineSegment[] = [];
  const throughputPoints: SeriesPoint[] = [];
  const backlogPoints: SeriesPoint[] = [];
  const blockerPoints: SeriesPoint[] = [];
  const checkpointPoints: CheckpointPoint[] = [];
  const flushPoints: FlushPoint[] = [];
  const memoryFallback: MemoryPoint[] = [];
  const shardMessageTotals = new Map<string, number>();

  for (const iteration of sortedIterations) {
    shardMessageTotals.set(iteration.shardId, (shardMessageTotals.get(iteration.shardId) ?? 0) + asNumber(iteration.counts?.rowsFetched));
  }

  for (const iteration of sortedIterations) {
    const iterationStart = relativeMs(iteration.startedAtUtc, startedAtMs, timelineSegments.at(-1)?.endMs ?? 0);
    const iterationStartAt = toEpochMs(iteration.startedAtUtc) ?? startedAtMs + iterationStart;
    const totalMs = iterationDurationMs(iteration);
    const completedRelative = relativeMs(iteration.completedAtUtc, startedAtMs, iterationStart + totalMs);
    const completedAt = toEpochMs(iteration.completedAtUtc) ?? startedAtMs + completedRelative;
    const metricAt = toEpochMs(iteration.windowEndUtc) ?? completedAt;
    const metricRelative = Math.max(0, metricAt - startedAtMs);
    let cursor = iterationStart;
    let measuredDurationMs = 0;

    for (const stage of STAGE_DEFINITIONS) {
      const durationMs = asNumber(iteration.timingsMs?.[stage.key]);
      measuredDurationMs += durationMs;
      timelineSegments.push({
        iterationId: iteration.iterationId,
        clientId: iteration.clientId,
        shardId: iteration.shardId,
        stageKey: stage.key,
        stageLabel: stage.label,
        color: stage.color,
        startMs: cursor,
        endMs: cursor + durationMs,
        startAtMs: iterationStartAt + (cursor - iterationStart),
        endAtMs: iterationStartAt + (cursor - iterationStart) + durationMs,
        durationMs,
        originalDurationMs: durationMs,
      });
      cursor += durationMs;
    }

    const unaccountedMs = Math.max(0, totalMs - measuredDurationMs);
    if (unaccountedMs > 0.5) {
      timelineSegments.push({
        iterationId: iteration.iterationId,
        clientId: iteration.clientId,
        shardId: iteration.shardId,
        stageKey: UNACCOUNTED_STAGE.key,
        stageLabel: UNACCOUNTED_STAGE.label,
        color: UNACCOUNTED_STAGE.color,
        startMs: iterationStart + measuredDurationMs,
        endMs: iterationStart + totalMs,
        startAtMs: iterationStartAt + measuredDurationMs,
        endAtMs: iterationStartAt + totalMs,
        durationMs: unaccountedMs,
        originalDurationMs: unaccountedMs,
      });
    }

    const label = `${iteration.iterationId} · ${iteration.shardId}`;
    const safeTotalSeconds = Math.max(totalMs / 1000, 0.001);

    throughputPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: metricRelative,
      xAtMs: metricAt,
      value: asNumber(iteration.counts?.eventsFinalized) / safeTotalSeconds,
    });
    backlogPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: metricRelative,
      xAtMs: metricAt,
      value: asNumber(iteration.counts?.backlogMessages),
    });
    blockerPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: metricRelative,
      xAtMs: metricAt,
      value: asNumber(iteration.checkpoint?.blockedDurationMs),
    });
    checkpointPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: metricRelative,
      xAtMs: metricAt,
      advancedTo: coerceComparable(iteration.checkpoint?.advancedTo),
      upper: coerceComparable(iteration.checkpoint?.upper),
      rawAdvancedTo: iteration.checkpoint?.advancedTo,
      rawUpper: iteration.checkpoint?.upper,
    });
    flushPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: metricRelative,
      xAtMs: metricAt,
      fullFlushes: asNumber(iteration.counts?.fullFlushes),
      partialFlushes: asNumber(iteration.counts?.partialFlushes),
      flushDocuments: asNumber(iteration.counts?.flushDocuments),
    });
    memoryFallback.push(buildMemoryFallback(iteration, completedRelative));
  }

  const pipelineSnapshots = sortedIterations.map((iteration) =>
    buildPipelineSnapshot(iteration, shardMessageTotals.get(iteration.shardId) ?? asNumber(iteration.counts?.rowsFetched)));
  const shardOptions = buildShardOptions(pipelineSnapshots);

  const memoryPoints =
    artifact.memorySamples.length > 0
      ? artifact.memorySamples
          .map((sample) => ({
            iterationId: sample.iterationId,
            label: sample.iterationId,
            xMs: relativeMs(sample.timestampUtc, startedAtMs, 0),
            xAtMs: toEpochMs(sample.timestampUtc) ?? startedAtMs,
            managedMiB: bytesToMiB(asNumber(sample.managedBytes)),
            workingSetMiB: bytesToMiB(asNumber(sample.workingSetBytes)),
            gcHeapMiB: bytesToMiB(asNumber(sample.gcHeapBytes)),
          }))
          .sort((left, right) => left.xMs - right.xMs)
      : memoryFallback;

  const timelineEndMs = finiteMax(
    [
      asNumber(artifact.summary.durationMs),
      completedAtMs - startedAtMs,
      ...timelineSegments.map((segment) => segment.endMs),
      ...throughputPoints.map((point) => point.xMs),
    ],
    0,
  );
  const timelineStartAtMs = finiteMin(
    [
      startedAtMs,
      ...timelineSegments.map((segment) => segment.startAtMs),
      ...throughputPoints.map((point) => point.xAtMs),
      ...memoryPoints.map((point) => point.xAtMs),
      ...pipelineSnapshots.map((snapshot) => toEpochMs(snapshot.windowStartUtc) ?? snapshot.observedAtMs),
    ],
    startedAtMs,
  );
  const latestObservedAtMs = finiteMax(
    [
      completedAtMs,
      ...timelineSegments.map((segment) => segment.endAtMs),
      ...throughputPoints.map((point) => point.xAtMs),
      ...memoryPoints.map((point) => point.xAtMs),
      ...pipelineSnapshots.map((snapshot) => snapshot.observedAtMs),
    ],
    completedAtMs,
  );

  const label = artifact.run.label || artifact.run.runId || sourceName;

  return {
    id,
    label,
    sourceName,
    runId: artifact.run.runId,
    artifact,
    startedAtMs,
    completedAtMs,
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    timelineEndMs,
    timelineStartAtMs,
    timelineEndAtMs: latestObservedAtMs,
    latestObservedAtMs,
    timelineSegments,
    throughputPoints,
    backlogPoints,
    blockerPoints,
    checkpointPoints,
    flushPoints,
    memoryPoints,
    pipelineSnapshots,
    shardOptions,
    throughputMetrics: buildThroughputMetrics(sortedIterations),
    iterationThroughputMetrics: buildIterationThroughputMetrics(sortedIterations),
    summaryRow: summaryToRow(id, label, artifact.run.source, artifact.summary),
  };
}

export function makeLoadedRun(artifact: BenchmarkArtifact, fileName: string, ordinal: number): LoadedRun {
  const safeRunId = artifact.run.runId || fileName.replace(/\.json$/i, '') || 'run';
  const id = `${safeRunId}-${ordinal}`;

  return {
    id,
    fileName,
    artifact,
    analysis: buildRunAnalysis(artifact, fileName, id),
  };
}

export function makeLoadedRunWithId(artifact: BenchmarkArtifact, fileName: string, id: string): LoadedRun {
  return {
    id,
    fileName,
    artifact,
    analysis: buildRunAnalysis(artifact, fileName, id),
  };
}

export function upsertLoadedRun(runs: LoadedRun[], next: LoadedRun): LoadedRun[] {
  const existingIndex = runs.findIndex((run) => run.id === next.id);
  if (existingIndex === -1) return [...runs, next];

  return runs.map((run, index) => (index === existingIndex ? next : run));
}

export function makeLoadedSummary(artifact: BenchmarkSummaryArtifact, fileName: string, ordinal: number): LoadedSummary {
  const safeLabel = artifact.label || fileName.replace(/\.json$/i, '') || 'summary';
  const id = `${safeLabel}-${ordinal}`;

  return {
    id,
    fileName,
    artifact,
    summaryRow: summaryToRow(
      id,
      `${safeLabel} (${artifact.runCount} run${artifact.runCount === 1 ? '' : 's'} average)`,
      'summary',
      artifact.averages,
    ),
  };
}

export function makeLoadedSummaryWithId(artifact: BenchmarkSummaryArtifact, fileName: string, id: string): LoadedSummary {
  const safeLabel = artifact.label || fileName.replace(/\.json$/i, '') || 'summary';

  return {
    id,
    fileName,
    artifact,
    summaryRow: summaryToRow(
      id,
      `${safeLabel} (${artifact.runCount} run${artifact.runCount === 1 ? '' : 's'} average)`,
      'summary',
      artifact.averages,
    ),
  };
}

export function upsertLoadedSummary(summaries: LoadedSummary[], next: LoadedSummary): LoadedSummary[] {
  const existingIndex = summaries.findIndex((summary) => summary.id === next.id);
  if (existingIndex === -1) return [...summaries, next];

  return summaries.map((summary, index) => (index === existingIndex ? next : summary));
}

export function buildAverageSummaryRow(runs: RunAnalysis[]): SummaryRow | null {
  if (runs.length === 0) return null;

  const sum = (selector: (run: RunAnalysis) => number) => runs.reduce((total, run) => total + selector(run), 0);
  const count = runs.length;

  return {
    id: 'average-baseline',
    label: `Average baseline (${count} run${count === 1 ? '' : 's'})`,
    source: 'average',
    iterationCount: sum((run) => run.summaryRow.iterationCount) / count,
    durationMs: sum((run) => run.summaryRow.durationMs) / count,
    throughputEventsPerSecond: sum((run) => run.summaryRow.throughputEventsPerSecond) / count,
    eventsFinalized: sum((run) => run.summaryRow.eventsFinalized) / count,
    flushDocuments: sum((run) => run.summaryRow.flushDocuments) / count,
    fullFlushes: sum((run) => run.summaryRow.fullFlushes) / count,
    partialFlushes: sum((run) => run.summaryRow.partialFlushes) / count,
    averageTotalMs: sum((run) => run.summaryRow.averageTotalMs) / count,
    averageBacklogMessages: sum((run) => run.summaryRow.averageBacklogMessages) / count,
    maxBacklogMessages: finiteMax(runs.map((run) => run.summaryRow.maxBacklogMessages), 0),
    blockedDurationMs: sum((run) => run.summaryRow.blockedDurationMs) / count,
  };
}

export function percentDelta(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline === 0) return null;

  return (value - baseline) / baseline;
}

export function totalTiming(timings: TimingMetrics): number {
  return TIMING_KEYS.reduce((sum, key) => sum + asNumber(timings[key]), 0);
}

export function selectStableShardId(options: PipelineShardOption[], selectedShardId: string | null): string | null {
  if (selectedShardId && options.some((option) => option.shardId === selectedShardId)) return selectedShardId;
  if (options.length === 0) return null;

  const byRecentActivity = [...options].sort((left, right) => {
    if (left.hasIncompletePipeline !== right.hasIncompletePipeline) return left.hasIncompletePipeline ? -1 : 1;
    if (right.latestObservedAtMs !== left.latestObservedAtMs) return right.latestObservedAtMs - left.latestObservedAtMs;
    return left.shardId.localeCompare(right.shardId, undefined, { numeric: true });
  });

  return byRecentActivity[0].shardId;
}

export function selectPipelineSnapshotForShard(analysis: RunAnalysis, shardId: string | null): PipelineWindowSnapshot | null {
  const selectedShardId = selectStableShardId(analysis.shardOptions, shardId);
  if (!selectedShardId) return null;

  const snapshots = analysis.pipelineSnapshots
    .filter((snapshot) => snapshot.shardId === selectedShardId)
    .sort((left, right) => right.observedAtMs - left.observedAtMs);
  const latestIncomplete = snapshots.find((snapshot) => snapshot.source === 'pipeline' && snapshot.isIncomplete);

  return latestIncomplete ?? snapshots[0] ?? null;
}

export function filterRunAnalysisByRange(analysis: RunAnalysis, rangeKey: TimeRangeKey): RunAnalysis {
  const range = TIME_RANGES.find((candidate) => candidate.key === rangeKey) ?? TIME_RANGES[0];
  if (range.durationMs === null) return analysis;

  const endAtMs = analysis.latestObservedAtMs;
  const startAtMs = Math.max(analysis.timelineStartAtMs, endAtMs - range.durationMs);
  const includePoint = (point: { xAtMs: number }) => point.xAtMs >= startAtMs && point.xAtMs <= endAtMs;

  const timelineSegments = analysis.timelineSegments
    .filter((segment) => segment.endAtMs >= startAtMs && segment.startAtMs <= endAtMs)
    .map((segment) => {
      const clippedStartAt = Math.max(segment.startAtMs, startAtMs);
      const clippedEndAt = Math.min(segment.endAtMs, endAtMs);
      const startOffset = clippedStartAt - analysis.startedAtMs;
      const endOffset = clippedEndAt - analysis.startedAtMs;

      return {
        ...segment,
        startAtMs: clippedStartAt,
        endAtMs: clippedEndAt,
        startMs: startOffset,
        endMs: endOffset,
        durationMs: Math.max(0, clippedEndAt - clippedStartAt),
      };
    });

  return {
    ...analysis,
    timelineStartAtMs: startAtMs,
    timelineEndAtMs: endAtMs,
    timelineEndMs: Math.max(1, endAtMs - startAtMs),
    timelineSegments,
    throughputPoints: analysis.throughputPoints.filter(includePoint),
    backlogPoints: analysis.backlogPoints.filter(includePoint),
    blockerPoints: analysis.blockerPoints.filter(includePoint),
    checkpointPoints: analysis.checkpointPoints.filter(includePoint),
    flushPoints: analysis.flushPoints.filter(includePoint),
    memoryPoints: analysis.memoryPoints.filter(includePoint),
  };
}
