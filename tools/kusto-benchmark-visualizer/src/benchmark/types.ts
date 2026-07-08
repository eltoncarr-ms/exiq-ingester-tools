export type TimingKey =
  | 'leaseAcquire'
  | 'pollKusto'
  | 'messageStoreSetup'
  | 'rehydrateMessageState'
  | 'processMessagesToEvents'
  | 'flush'
  | 'advanceCheckpoint'
  | 'total';

export type StageTimingKey = Exclude<TimingKey, 'total'>;

export interface TimingMetrics {
  leaseAcquire: number;
  pollKusto: number;
  messageStoreSetup: number;
  rehydrateMessageState: number;
  processMessagesToEvents: number;
  flush: number;
  advanceCheckpoint: number;
  total: number;
}

export interface CountMetrics {
  rowsFetched: number;
  messagesProcessed: number;
  eventsFinalized: number;
  flushDocuments: number;
  fullFlushes: number;
  partialFlushes: number;
  checkpointAdvancements: number;
  blockedMessages: number;
  backlogMessages: number;
}

export interface MemoryMetrics {
  managedBytes: number;
  workingSetBytes: number;
  gcHeapBytes: number;
}

export interface RunMetadata {
  runId: string;
  label: string;
  source: string;
  startedAtUtc: string;
  completedAtUtc: string;
  clientId: string;
  clientCount: number;
  partitionScope: string;
  configuration: unknown;
}

export interface IterationCheckpoint {
  previous: unknown;
  upper: unknown;
  advancedTo: unknown;
  blockedDurationMs: number;
}

export interface BenchmarkIteration {
  iterationId: string;
  clientId: string;
  shardId: string;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  startedAtUtc: string;
  completedAtUtc: string;
  timingsMs: TimingMetrics;
  counts: CountMetrics;
  memory: MemoryMetrics;
  checkpoint: IterationCheckpoint;
}

export interface MemorySample {
  timestampUtc: string;
  iterationId: string;
  managedBytes: number;
  workingSetBytes: number;
  gcHeapBytes: number;
}

export interface BenchmarkSummary {
  iterationCount: number;
  rowsFetched: number;
  messagesProcessed: number;
  eventsFinalized: number;
  flushDocuments: number;
  fullFlushes: number;
  partialFlushes: number;
  checkpointAdvancements: number;
  durationMs: number;
  throughputEventsPerSecond: number;
  averageTimingsMs: TimingMetrics;
  averageBacklogMessages: number;
  maxBacklogMessages: number;
  blockedDurationMs: number;
}

export interface BenchmarkArtifact {
  schemaVersion: 1;
  run: RunMetadata;
  iterations: BenchmarkIteration[];
  memorySamples: MemorySample[];
  summary: BenchmarkSummary;
}

export interface BenchmarkSummaryRun {
  runId: string;
  startedAtUtc: string;
  completedAtUtc: string;
  clientId: string;
  iterationCount: number;
  summary: BenchmarkSummary;
}

export type BenchmarkAveragedSummary = Omit<BenchmarkSummary, 'maxBacklogMessages'> & {
  maxBacklogMessages: number;
};

export interface BenchmarkSummaryArtifact {
  schemaVersion: 1;
  label: string;
  generatedAtUtc: string;
  runCount: number;
  runs: BenchmarkSummaryRun[];
  averages: BenchmarkAveragedSummary;
}
