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
