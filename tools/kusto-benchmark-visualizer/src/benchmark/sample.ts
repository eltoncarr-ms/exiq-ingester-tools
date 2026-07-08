import type { BenchmarkArtifact, BenchmarkIteration, MemorySample, TimingMetrics } from './types';

const MIB = 1024 * 1024;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function timingsFor(index: number, multiplier: number): TimingMetrics {
  const timings = {
    leaseAcquire: 28 + index * 2,
    pollKusto: 210 * multiplier + index * 12,
    messageStoreSetup: 34 + index,
    rehydrateMessageState: 48 + index * 4,
    processMessagesToEvents: 340 * multiplier + index * 18,
    flush: 150 * multiplier + (index % 3) * 24,
    advanceCheckpoint: 62 + index * 3,
    total: 0,
  };

  timings.total =
    timings.leaseAcquire +
    timings.pollKusto +
    timings.messageStoreSetup +
    timings.rehydrateMessageState +
    timings.processMessagesToEvents +
    timings.flush +
    timings.advanceCheckpoint;

  return timings;
}

function makeIteration(index: number, runStart: number, multiplier: number, clientCount: number): BenchmarkIteration {
  const startedAt = runStart + index * 42_000;
  const timingsMs = timingsFor(index, multiplier);
  const completedAt = startedAt + timingsMs.total;
  const eventsFinalized = Math.round((900 + index * 85) * multiplier);
  const partialFlushes = index % 3 === 0 ? 2 : 1;
  const fullFlushes = index % 4 === 0 ? 1 : 0;
  const previous = 1_000_000 + index * 1_000;
  const upper = previous + 1_000;
  const advancedTo = upper - (index % 4 === 2 ? 140 : 0);

  return {
    iterationId: `iter-${String(index + 1).padStart(2, '0')}`,
    clientId: `client-${(index % clientCount) + 1}`,
    shardId: `shard-${(index % 4) + 1}`,
    windowStartUtc: iso(startedAt - 10 * 60_000),
    windowEndUtc: iso(startedAt - 9 * 60_000),
    startedAtUtc: iso(startedAt),
    completedAtUtc: iso(completedAt),
    timingsMs,
    counts: {
      rowsFetched: Math.round(eventsFinalized * 1.08),
      messagesProcessed: Math.round(eventsFinalized * 1.02),
      eventsFinalized,
      flushDocuments: partialFlushes * 175 + fullFlushes * 620,
      fullFlushes,
      partialFlushes,
      checkpointAdvancements: advancedTo === upper ? 1 : 0,
      blockedMessages: advancedTo === upper ? 0 : 3 + index,
      backlogMessages: Math.max(0, Math.round((index - 2) * 24 * multiplier)),
    },
    memory: {
      managedBytes: (148 + index * 5 * multiplier) * MIB,
      workingSetBytes: (360 + index * 11 * multiplier) * MIB,
      gcHeapBytes: (96 + index * 4 * multiplier) * MIB,
    },
    checkpoint: {
      previous,
      upper,
      advancedTo,
      blockedDurationMs: advancedTo === upper ? index * 4 : 380 + index * 30,
    },
  };
}

function summarize(iterations: BenchmarkIteration[], startedAtUtc: string, completedAtUtc: string) {
  const durationMs = Date.parse(completedAtUtc) - Date.parse(startedAtUtc);
  const averageTiming = (key: keyof TimingMetrics) =>
    iterations.reduce((sum, iteration) => sum + iteration.timingsMs[key], 0) / iterations.length;
  const averageTimingsMs: TimingMetrics = {
    leaseAcquire: averageTiming('leaseAcquire'),
    pollKusto: averageTiming('pollKusto'),
    messageStoreSetup: averageTiming('messageStoreSetup'),
    rehydrateMessageState: averageTiming('rehydrateMessageState'),
    processMessagesToEvents: averageTiming('processMessagesToEvents'),
    flush: averageTiming('flush'),
    advanceCheckpoint: averageTiming('advanceCheckpoint'),
    total: averageTiming('total'),
  };

  const total = (selector: (iteration: BenchmarkIteration) => number) =>
    iterations.reduce((sum, iteration) => sum + selector(iteration), 0);

  return {
    iterationCount: iterations.length,
    rowsFetched: total((iteration) => iteration.counts.rowsFetched),
    messagesProcessed: total((iteration) => iteration.counts.messagesProcessed),
    eventsFinalized: total((iteration) => iteration.counts.eventsFinalized),
    flushDocuments: total((iteration) => iteration.counts.flushDocuments),
    fullFlushes: total((iteration) => iteration.counts.fullFlushes),
    partialFlushes: total((iteration) => iteration.counts.partialFlushes),
    checkpointAdvancements: total((iteration) => iteration.counts.checkpointAdvancements),
    durationMs,
    throughputEventsPerSecond: total((iteration) => iteration.counts.eventsFinalized) / (durationMs / 1000),
    averageTimingsMs,
    averageBacklogMessages: total((iteration) => iteration.counts.backlogMessages) / iterations.length,
    maxBacklogMessages: Math.max(...iterations.map((iteration) => iteration.counts.backlogMessages)),
    blockedDurationMs: total((iteration) => iteration.checkpoint.blockedDurationMs),
  };
}

function memorySamplesFor(iterations: BenchmarkIteration[]): MemorySample[] {
  return iterations.flatMap((iteration) => {
    const started = Date.parse(iteration.startedAtUtc);
    const completed = Date.parse(iteration.completedAtUtc);
    const mid = started + (completed - started) / 2;

    return [
      {
        timestampUtc: iso(started),
        iterationId: iteration.iterationId,
        managedBytes: Math.round(iteration.memory.managedBytes * 0.92),
        workingSetBytes: Math.round(iteration.memory.workingSetBytes * 0.95),
        gcHeapBytes: Math.round(iteration.memory.gcHeapBytes * 0.88),
      },
      {
        timestampUtc: iso(mid),
        iterationId: iteration.iterationId,
        managedBytes: iteration.memory.managedBytes,
        workingSetBytes: iteration.memory.workingSetBytes,
        gcHeapBytes: iteration.memory.gcHeapBytes,
      },
    ];
  });
}

function makeArtifact(label: string, runId: string, multiplier: number, clientCount: number): BenchmarkArtifact {
  const runStart = Date.UTC(2026, 0, 15, 17, 0, 0) + (clientCount - 1) * 3_600_000;
  const iterations = Array.from({ length: 10 }, (_, index) => makeIteration(index, runStart, multiplier, clientCount));
  const startedAtUtc = iterations[0].startedAtUtc;
  const completedAtUtc = iterations.at(-1)!.completedAtUtc;

  return {
    schemaVersion: 1,
    run: {
      runId,
      label,
      source: 'Kusto',
      startedAtUtc,
      completedAtUtc,
      clientId: 'synthetic',
      clientCount,
      partitionScope: clientCount === 1 ? '1/500' : '5/500',
      configuration: {
        maxConcurrentShards: clientCount,
        windowSeconds: 60,
        ingestionLagSeconds: 600,
      },
    },
    iterations,
    memorySamples: memorySamplesFor(iterations),
    summary: summarize(iterations, startedAtUtc, completedAtUtc),
  };
}

export const SYNTHETIC_ARTIFACTS: BenchmarkArtifact[] = [
  makeArtifact('Synthetic baseline · 1 client', 'synthetic-baseline-1-client', 1, 1),
  makeArtifact('Synthetic comparison · 5 clients', 'synthetic-comparison-5-clients', 1.42, 5),
];
