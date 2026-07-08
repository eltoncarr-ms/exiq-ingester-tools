import type { BenchmarkArtifact, BenchmarkSummaryArtifact } from './types';

export type ParsedBenchmarkFile =
  | { kind: 'run'; artifact: BenchmarkArtifact }
  | { kind: 'summary'; artifact: BenchmarkSummaryArtifact };

export class BenchmarkLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkLoadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BenchmarkLoadError(`${path} must be an object.`);
  }

  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BenchmarkLoadError(`${path} must be an array.`);
  }

  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BenchmarkLoadError(`${path} must be a non-empty string.`);
  }

  return value;
}

function requireOptionalString(value: unknown, path: string): string | null {
  if (value === null) return null;

  return requireString(value, path);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BenchmarkLoadError(`${path} must be a finite number.`);
  }

  return value;
}

function requireOptionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;

  return requireNumber(value, path);
}

function requireEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BenchmarkLoadError(`${path} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T;
}

const PIPELINE_MESSAGE_STATUSES = ['pending', 'done', 'skipped', 'duplicateAcknowledged', 'poisoned'] as const;
const PIPELINE_EVENT_KINDS = ['read', 'rehydrate', 'process', 'flush', 'checkpoint', 'blocked'] as const;

export function parseBenchmarkArtifact(value: unknown): BenchmarkArtifact {
  const root = requireRecord(value, 'artifact');

  if (root.schemaVersion !== 1) {
    throw new BenchmarkLoadError('Only benchmark artifact schemaVersion 1 is supported.');
  }

  const run = requireRecord(root.run, 'artifact.run');
  requireString(run.runId, 'artifact.run.runId');
  requireString(run.label, 'artifact.run.label');
  requireString(run.source, 'artifact.run.source');
  requireString(run.startedAtUtc, 'artifact.run.startedAtUtc');
  requireString(run.completedAtUtc, 'artifact.run.completedAtUtc');
  requireString(run.clientId, 'artifact.run.clientId');
  requireNumber(run.clientCount, 'artifact.run.clientCount');
  requireString(run.partitionScope, 'artifact.run.partitionScope');
  requireRecord(run.configuration, 'artifact.run.configuration');

  requireArray(root.iterations, 'artifact.iterations').forEach((iteration, index) =>
    validateIteration(iteration, `artifact.iterations[${index}]`));
  requireArray(root.memorySamples, 'artifact.memorySamples').forEach((sample, index) =>
    validateMemorySample(sample, `artifact.memorySamples[${index}]`));
  validateSummary(root.summary, 'artifact.summary');

  return root as unknown as BenchmarkArtifact;
}

export function parseBenchmarkFile(value: unknown): ParsedBenchmarkFile {
  const root = requireRecord(value, 'artifact');

  if (isRecord(root.run)) {
    return { kind: 'run', artifact: parseBenchmarkArtifact(root) };
  }

  if (isRecord(root.averages) && Array.isArray(root.runs)) {
    return { kind: 'summary', artifact: parseBenchmarkSummaryArtifact(root) };
  }

  throw new BenchmarkLoadError('Artifact must be a benchmark run or benchmark summary schemaVersion 1 object.');
}

export function parseBenchmarkArtifactText(text: string, sourceName = 'benchmark artifact'): BenchmarkArtifact {
  try {
    return parseBenchmarkArtifact(JSON.parse(text));
  } catch (error) {
    if (error instanceof BenchmarkLoadError) {
      throw new BenchmarkLoadError(`${sourceName}: ${error.message}`);
    }

    throw new BenchmarkLoadError(`${sourceName}: invalid JSON.`);
  }
}

export function parseBenchmarkFileText(text: string, sourceName = 'benchmark artifact'): ParsedBenchmarkFile {
  try {
    return parseBenchmarkFile(JSON.parse(text));
  } catch (error) {
    if (error instanceof BenchmarkLoadError) {
      throw new BenchmarkLoadError(`${sourceName}: ${error.message}`);
    }

    throw new BenchmarkLoadError(`${sourceName}: invalid JSON.`);
  }
}

function parseBenchmarkSummaryArtifact(value: unknown): BenchmarkSummaryArtifact {
  const root = requireRecord(value, 'artifact');

  if (root.schemaVersion !== 1) {
    throw new BenchmarkLoadError('Only benchmark artifact schemaVersion 1 is supported.');
  }

  requireString(root.label, 'artifact.label');
  requireString(root.generatedAtUtc, 'artifact.generatedAtUtc');
  requireNumber(root.runCount, 'artifact.runCount');
  requireArray(root.runs, 'artifact.runs').forEach((run, index) => validateSummaryRun(run, `artifact.runs[${index}]`));
  validateSummary(root.averages, 'artifact.averages');

  return root as unknown as BenchmarkSummaryArtifact;
}

function validateIteration(value: unknown, path: string): void {
  const iteration = requireRecord(value, path);
  requireString(iteration.iterationId, `${path}.iterationId`);
  requireString(iteration.clientId, `${path}.clientId`);
  requireString(iteration.shardId, `${path}.shardId`);
  requireOptionalString(iteration.windowStartUtc, `${path}.windowStartUtc`);
  requireOptionalString(iteration.windowEndUtc, `${path}.windowEndUtc`);
  requireString(iteration.startedAtUtc, `${path}.startedAtUtc`);
  requireString(iteration.completedAtUtc, `${path}.completedAtUtc`);
  validateTimings(iteration.timingsMs, `${path}.timingsMs`);
  validateCounts(iteration.counts, `${path}.counts`);
  validateMemory(iteration.memory, `${path}.memory`);
  validateCheckpoint(iteration.checkpoint, `${path}.checkpoint`);
  if (iteration.pipeline !== undefined) {
    validatePipeline(iteration.pipeline, `${path}.pipeline`);
  }
}

function validateSummary(value: unknown, path: string): void {
  const summary = requireRecord(value, path);
  requireNumber(summary.iterationCount, `${path}.iterationCount`);
  requireNumber(summary.rowsFetched, `${path}.rowsFetched`);
  requireNumber(summary.messagesProcessed, `${path}.messagesProcessed`);
  requireNumber(summary.eventsFinalized, `${path}.eventsFinalized`);
  requireNumber(summary.flushDocuments, `${path}.flushDocuments`);
  requireNumber(summary.fullFlushes, `${path}.fullFlushes`);
  requireNumber(summary.partialFlushes, `${path}.partialFlushes`);
  requireNumber(summary.checkpointAdvancements, `${path}.checkpointAdvancements`);
  requireNumber(summary.durationMs, `${path}.durationMs`);
  requireNumber(summary.throughputEventsPerSecond, `${path}.throughputEventsPerSecond`);
  validateTimings(summary.averageTimingsMs, `${path}.averageTimingsMs`);
  requireNumber(summary.averageBacklogMessages, `${path}.averageBacklogMessages`);
  requireNumber(summary.maxBacklogMessages, `${path}.maxBacklogMessages`);
  requireNumber(summary.blockedDurationMs, `${path}.blockedDurationMs`);
}

function validateSummaryRun(value: unknown, path: string): void {
  const run = requireRecord(value, path);
  requireString(run.runId, `${path}.runId`);
  requireString(run.startedAtUtc, `${path}.startedAtUtc`);
  requireString(run.completedAtUtc, `${path}.completedAtUtc`);
  requireString(run.clientId, `${path}.clientId`);
  requireNumber(run.iterationCount, `${path}.iterationCount`);
  validateSummary(run.summary, `${path}.summary`);
}

function validateTimings(value: unknown, path: string): void {
  const timings = requireRecord(value, path);
  for (const key of [
    'leaseAcquire',
    'pollKusto',
    'messageStoreSetup',
    'rehydrateMessageState',
    'processMessagesToEvents',
    'flush',
    'advanceCheckpoint',
    'total',
  ]) {
    requireNumber(timings[key], `${path}.${key}`);
  }
}

function validateCounts(value: unknown, path: string): void {
  const counts = requireRecord(value, path);
  for (const key of [
    'rowsFetched',
    'messagesProcessed',
    'eventsFinalized',
    'flushDocuments',
    'fullFlushes',
    'partialFlushes',
    'checkpointAdvancements',
    'blockedMessages',
    'backlogMessages',
  ]) {
    requireNumber(counts[key], `${path}.${key}`);
  }
}

function validateMemory(value: unknown, path: string): void {
  const memory = requireRecord(value, path);
  requireNumber(memory.managedBytes, `${path}.managedBytes`);
  requireNumber(memory.workingSetBytes, `${path}.workingSetBytes`);
  requireNumber(memory.gcHeapBytes, `${path}.gcHeapBytes`);
}

function validateMemorySample(value: unknown, path: string): void {
  const sample = requireRecord(value, path);
  requireString(sample.timestampUtc, `${path}.timestampUtc`);
  requireString(sample.iterationId, `${path}.iterationId`);
  requireNumber(sample.managedBytes, `${path}.managedBytes`);
  requireNumber(sample.workingSetBytes, `${path}.workingSetBytes`);
  requireNumber(sample.gcHeapBytes, `${path}.gcHeapBytes`);
}

function validateCheckpoint(value: unknown, path: string): void {
  const checkpoint = requireRecord(value, path);
  requireNumber(checkpoint.blockedDurationMs, `${path}.blockedDurationMs`);
}

function validatePipeline(value: unknown, path: string): void {
  const pipeline = requireRecord(value, path);
  requireString(pipeline.snapshotAtUtc, `${path}.snapshotAtUtc`);
  requireString(pipeline.shardId, `${path}.shardId`);
  requireOptionalString(pipeline.windowStartUtc, `${path}.windowStartUtc`);
  requireOptionalString(pipeline.windowEndUtc, `${path}.windowEndUtc`);
  requireString(pipeline.currentTimeUtc, `${path}.currentTimeUtc`);
  requireOptionalString(pipeline.watermarkUtc, `${path}.watermarkUtc`);
  requireOptionalString(pipeline.candidateWatermarkUtc, `${path}.candidateWatermarkUtc`);
  requireOptionalString(pipeline.checkpointAdvancedToUtc, `${path}.checkpointAdvancedToUtc`);
  requireNumber(pipeline.totalShardMessages, `${path}.totalShardMessages`);
  requireNumber(pipeline.currentWindowMessages, `${path}.currentWindowMessages`);
  requireNumber(pipeline.backlogMessages, `${path}.backlogMessages`);
  requireNumber(pipeline.blockedMessages, `${path}.blockedMessages`);
  validatePipelineStatusCounts(pipeline.statusCounts, `${path}.statusCounts`);
  requireArray(pipeline.messages, `${path}.messages`).forEach((message, index) =>
    validatePipelineMessage(message, `${path}.messages[${index}]`));
  requireArray(pipeline.events, `${path}.events`).forEach((event, index) => validatePipelineEvent(event, `${path}.events[${index}]`));
}

function validatePipelineStatusCounts(value: unknown, path: string): void {
  const counts = requireRecord(value, path);
  for (const key of PIPELINE_MESSAGE_STATUSES) {
    requireNumber(counts[key], `${path}.${key}`);
  }
}

function validatePipelineMessage(value: unknown, path: string): void {
  const message = requireRecord(value, path);
  requireNumber(message.ordinal, `${path}.ordinal`);
  requireOptionalString(message.rowId, `${path}.rowId`);
  requireOptionalString(message.sessionId, `${path}.sessionId`);
  requireString(message.enqueuedTimeUtc, `${path}.enqueuedTimeUtc`);
  requireEnum(message.status, `${path}.status`, PIPELINE_MESSAGE_STATUSES);
  if (message.skipReason !== undefined) {
    requireOptionalString(message.skipReason, `${path}.skipReason`);
  }
}

function validatePipelineEvent(value: unknown, path: string): void {
  const event = requireRecord(value, path);
  requireString(event.atUtc, `${path}.atUtc`);
  requireEnum(event.kind, `${path}.kind`, PIPELINE_EVENT_KINDS);
  requireString(event.label, `${path}.label`);
  requireOptionalNumber(event.messageCount, `${path}.messageCount`);
  if (event.watermarkUtc !== undefined) {
    requireOptionalString(event.watermarkUtc, `${path}.watermarkUtc`);
  }
}
