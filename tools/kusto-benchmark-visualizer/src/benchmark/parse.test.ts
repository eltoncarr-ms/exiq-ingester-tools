import { describe, expect, it } from 'vitest';
import { parseBenchmarkArtifactText, parseBenchmarkFileText, BenchmarkLoadError } from './parse';
import { SYNTHETIC_ARTIFACTS } from './sample';

describe('parseBenchmarkArtifactText', () => {
  it('accepts schemaVersion 1 benchmark artifacts', () => {
    const artifact = parseBenchmarkArtifactText(JSON.stringify(SYNTHETIC_ARTIFACTS[0]), 'sample.json');

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.run.runId).toBe('synthetic-baseline-1-client');
    expect(artifact.iterations).toHaveLength(10);
  });

  it('accepts optional pipeline data when it is present', () => {
    const source = structuredClone(SYNTHETIC_ARTIFACTS[0]);
    source.iterations[0].pipeline = {
      snapshotAtUtc: '2026-01-15T17:01:00.000Z',
      shardId: source.iterations[0].shardId,
      windowStartUtc: source.iterations[0].windowStartUtc,
      windowEndUtc: source.iterations[0].windowEndUtc,
      currentTimeUtc: '2026-01-15T17:00:45.000Z',
      watermarkUtc: '2026-01-15T16:51:00.000Z',
      candidateWatermarkUtc: null,
      checkpointAdvancedToUtc: null,
      totalShardMessages: 42,
      currentWindowMessages: 3,
      backlogMessages: 2,
      blockedMessages: 1,
      statusCounts: {
        pending: 1,
        done: 1,
        skipped: 0,
        duplicateAcknowledged: 1,
        poisoned: 0,
      },
      messages: [
        {
          ordinal: 0,
          rowId: 'row-0',
          sessionId: 'session-0',
          enqueuedTimeUtc: '2026-01-15T16:50:00.000Z',
          status: 'duplicateAcknowledged',
          skipReason: null,
        },
      ],
      events: [
        {
          atUtc: '2026-01-15T17:00:40.000Z',
          kind: 'checkpoint',
          label: 'Checkpoint blocked',
          messageCount: 1,
          watermarkUtc: null,
        },
      ],
    };

    const artifact = parseBenchmarkArtifactText(JSON.stringify(source), 'pipeline.json');

    expect(artifact.iterations[0].pipeline?.statusCounts.duplicateAcknowledged).toBe(1);
    expect(artifact.iterations[0].pipeline?.events[0].kind).toBe('checkpoint');
  });

  it('rejects malformed optional pipeline fields with the field path', () => {
    const source = structuredClone(SYNTHETIC_ARTIFACTS[0]);
    source.iterations[0].pipeline = {
      snapshotAtUtc: '2026-01-15T17:01:00.000Z',
      shardId: source.iterations[0].shardId,
      windowStartUtc: source.iterations[0].windowStartUtc,
      windowEndUtc: source.iterations[0].windowEndUtc,
      currentTimeUtc: '2026-01-15T17:00:45.000Z',
      watermarkUtc: null,
      candidateWatermarkUtc: null,
      checkpointAdvancedToUtc: null,
      totalShardMessages: 42,
      currentWindowMessages: 3,
      backlogMessages: 2,
      blockedMessages: 1,
      statusCounts: {
        pending: 1,
        done: 1,
        skipped: 0,
        duplicateAcknowledged: 0,
        poisoned: 0,
      },
      messages: [{ ordinal: 0, rowId: null, sessionId: null, enqueuedTimeUtc: '2026-01-15T16:50:00.000Z', status: 'pending' }],
      events: [],
    };
    (source.iterations[0].pipeline!.messages[0] as { status: unknown }).status = 'unknown';

    expect(() => parseBenchmarkArtifactText(JSON.stringify(source), 'bad-pipeline.json')).toThrow(
      /bad-pipeline\.json: artifact\.iterations\[0\]\.pipeline\.messages\[0\]\.status/,
    );
  });

  it('accepts schemaVersion 1 benchmark summary artifacts', () => {
    const summaryArtifact = {
      schemaVersion: 1,
      label: 'baseline-1-client-1-of-500',
      generatedAtUtc: '2026-01-15T17:30:00.000Z',
      runCount: 1,
      runs: [
        {
          runId: SYNTHETIC_ARTIFACTS[0].run.runId,
          startedAtUtc: SYNTHETIC_ARTIFACTS[0].run.startedAtUtc,
          completedAtUtc: SYNTHETIC_ARTIFACTS[0].run.completedAtUtc,
          clientId: SYNTHETIC_ARTIFACTS[0].run.clientId,
          iterationCount: SYNTHETIC_ARTIFACTS[0].summary.iterationCount,
          summary: SYNTHETIC_ARTIFACTS[0].summary,
        },
      ],
      averages: SYNTHETIC_ARTIFACTS[0].summary,
    };

    const parsed = parseBenchmarkFileText(JSON.stringify(summaryArtifact), 'kusto-benchmark-summary.json');

    expect(parsed.kind).toBe('summary');
    if (parsed.kind === 'summary') {
      expect(parsed.artifact.runCount).toBe(1);
    }
  });

  it('rejects unsupported schemas', () => {
    expect(() => parseBenchmarkArtifactText(JSON.stringify({ schemaVersion: 2 }), 'bad.json')).toThrow(BenchmarkLoadError);
  });

  it('adds the source name to JSON errors', () => {
    expect(() => parseBenchmarkArtifactText('{', 'broken.json')).toThrow(/broken\.json: invalid JSON/);
  });
});
