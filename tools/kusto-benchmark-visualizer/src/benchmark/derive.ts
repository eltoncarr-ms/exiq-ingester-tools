import type {
  BenchmarkArtifact,
  BenchmarkIteration,
  BenchmarkSummary,
  BenchmarkSummaryArtifact,
  MemoryMetrics,
  StageTimingKey,
  TimingMetrics,
} from './types';

export const STAGE_DEFINITIONS: ReadonlyArray<{ key: StageTimingKey; label: string; color: string }> = [
  { key: 'leaseAcquire', label: 'Lease acquire', color: '#8b5cf6' },
  { key: 'pollKusto', label: 'Poll Kusto', color: '#22d3ee' },
  { key: 'messageStoreSetup', label: 'Store setup', color: '#38bdf8' },
  { key: 'rehydrateMessageState', label: 'Rehydrate state', color: '#60a5fa' },
  { key: 'processMessagesToEvents', label: 'Process events', color: '#34d399' },
  { key: 'flush', label: 'Flush', color: '#f59e0b' },
  { key: 'advanceCheckpoint', label: 'Advance checkpoint', color: '#f472b6' },
];

const TIMING_KEYS: Array<keyof TimingMetrics> = [
  'leaseAcquire',
  'pollKusto',
  'messageStoreSetup',
  'rehydrateMessageState',
  'processMessagesToEvents',
  'flush',
  'advanceCheckpoint',
  'total',
];

export interface TimelineSegment {
  iterationId: string;
  clientId: string;
  shardId: string;
  stageKey: StageTimingKey;
  stageLabel: string;
  color: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SeriesPoint {
  iterationId: string;
  label: string;
  xMs: number;
  value: number;
}

export interface CheckpointPoint {
  iterationId: string;
  label: string;
  xMs: number;
  advancedTo: number | null;
  upper: number | null;
  rawAdvancedTo: unknown;
  rawUpper: unknown;
}

export interface FlushPoint {
  iterationId: string;
  label: string;
  xMs: number;
  fullFlushes: number;
  partialFlushes: number;
  flushDocuments: number;
}

export interface MemoryPoint {
  iterationId: string;
  label: string;
  xMs: number;
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
  timelineSegments: TimelineSegment[];
  throughputPoints: SeriesPoint[];
  backlogPoints: SeriesPoint[];
  blockerPoints: SeriesPoint[];
  checkpointPoints: CheckpointPoint[];
  flushPoints: FlushPoint[];
  memoryPoints: MemoryPoint[];
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

function bytesToMiB(value: number): number {
  return value / 1024 / 1024;
}

function buildMemoryFallback(iteration: BenchmarkIteration, xMs: number): MemoryPoint {
  const memory = iteration.memory ?? ({} as MemoryMetrics);

  return {
    iterationId: iteration.iterationId,
    label: iteration.iterationId,
    xMs,
    managedMiB: bytesToMiB(asNumber(memory.managedBytes)),
    workingSetMiB: bytesToMiB(asNumber(memory.workingSetBytes)),
    gcHeapMiB: bytesToMiB(asNumber(memory.gcHeapBytes)),
  };
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

  for (const iteration of sortedIterations) {
    const iterationStart = relativeMs(iteration.startedAtUtc, startedAtMs, timelineSegments.at(-1)?.endMs ?? 0);
    const totalMs = iterationDurationMs(iteration);
    const completedRelative = relativeMs(iteration.completedAtUtc, startedAtMs, iterationStart + totalMs);
    let cursor = iterationStart;

    for (const stage of STAGE_DEFINITIONS) {
      const durationMs = asNumber(iteration.timingsMs?.[stage.key]);
      timelineSegments.push({
        iterationId: iteration.iterationId,
        clientId: iteration.clientId,
        shardId: iteration.shardId,
        stageKey: stage.key,
        stageLabel: stage.label,
        color: stage.color,
        startMs: cursor,
        endMs: cursor + durationMs,
        durationMs,
      });
      cursor += durationMs;
    }

    const label = `${iteration.iterationId} · ${iteration.shardId}`;
    const safeTotalSeconds = Math.max(totalMs / 1000, 0.001);

    throughputPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: completedRelative,
      value: asNumber(iteration.counts?.eventsFinalized) / safeTotalSeconds,
    });
    backlogPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: completedRelative,
      value: asNumber(iteration.counts?.backlogMessages),
    });
    blockerPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: completedRelative,
      value: asNumber(iteration.checkpoint?.blockedDurationMs),
    });
    checkpointPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: completedRelative,
      advancedTo: coerceComparable(iteration.checkpoint?.advancedTo),
      upper: coerceComparable(iteration.checkpoint?.upper),
      rawAdvancedTo: iteration.checkpoint?.advancedTo,
      rawUpper: iteration.checkpoint?.upper,
    });
    flushPoints.push({
      iterationId: iteration.iterationId,
      label,
      xMs: completedRelative,
      fullFlushes: asNumber(iteration.counts?.fullFlushes),
      partialFlushes: asNumber(iteration.counts?.partialFlushes),
      flushDocuments: asNumber(iteration.counts?.flushDocuments),
    });
    memoryFallback.push(buildMemoryFallback(iteration, completedRelative));
  }

  const memoryPoints =
    artifact.memorySamples.length > 0
      ? artifact.memorySamples
          .map((sample) => ({
            iterationId: sample.iterationId,
            label: sample.iterationId,
            xMs: relativeMs(sample.timestampUtc, startedAtMs, 0),
            managedMiB: bytesToMiB(asNumber(sample.managedBytes)),
            workingSetMiB: bytesToMiB(asNumber(sample.workingSetBytes)),
            gcHeapMiB: bytesToMiB(asNumber(sample.gcHeapBytes)),
          }))
          .sort((left, right) => left.xMs - right.xMs)
      : memoryFallback;

  const timelineEndMs = Math.max(
    asNumber(artifact.summary.durationMs),
    completedAtMs - startedAtMs,
    ...timelineSegments.map((segment) => segment.endMs),
    ...throughputPoints.map((point) => point.xMs),
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
    timelineSegments,
    throughputPoints,
    backlogPoints,
    blockerPoints,
    checkpointPoints,
    flushPoints,
    memoryPoints,
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
    maxBacklogMessages: Math.max(...runs.map((run) => run.summaryRow.maxBacklogMessages)),
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
