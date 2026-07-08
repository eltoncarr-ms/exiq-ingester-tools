import { describe, expect, it } from 'vitest';
import { buildAverageSummaryRow, buildRunAnalysis, makeLoadedSummary, percentDelta, STAGE_DEFINITIONS } from './derive';
import { SYNTHETIC_ARTIFACTS } from './sample';

describe('buildRunAnalysis', () => {
  it('creates stage segments and chart series from a benchmark artifact', () => {
    const analysis = buildRunAnalysis(SYNTHETIC_ARTIFACTS[0], 'sample.json');

    expect(analysis.timelineSegments).toHaveLength(SYNTHETIC_ARTIFACTS[0].iterations.length * STAGE_DEFINITIONS.length);
    expect(analysis.throughputPoints[0].value).toBeGreaterThan(0);
    expect(analysis.checkpointPoints.some((point) => point.upper !== null && point.advancedTo !== null && point.upper > point.advancedTo)).toBe(true);
    expect(analysis.memoryPoints.length).toBeGreaterThan(SYNTHETIC_ARTIFACTS[0].iterations.length);
  });
});

describe('buildAverageSummaryRow', () => {
  it('averages comparable summary metrics across runs', () => {
    const rows = SYNTHETIC_ARTIFACTS.map((artifact, index) => buildRunAnalysis(artifact, `sample-${index}.json`));
    const average = buildAverageSummaryRow(rows);

    expect(average?.label).toBe('Average baseline (2 runs)');
    expect(average?.throughputEventsPerSecond).toBeGreaterThan(0);
    expect(average?.maxBacklogMessages).toBe(Math.max(...rows.map((row) => row.summaryRow.maxBacklogMessages)));
  });

  describe('makeLoadedSummary', () => {
    it('creates comparison rows from generated summary artifacts', () => {
      const loaded = makeLoadedSummary(
        {
          schemaVersion: 1,
          label: 'baseline-1-client-1-of-500',
          generatedAtUtc: '2026-01-15T17:30:00.000Z',
          runCount: 2,
          runs: [],
          averages: SYNTHETIC_ARTIFACTS[0].summary,
        },
        'kusto-benchmark-summary.json',
        1,
      );

      expect(loaded.summaryRow.source).toBe('summary');
      expect(loaded.summaryRow.label).toContain('2 runs average');
      expect(loaded.summaryRow.throughputEventsPerSecond).toBe(SYNTHETIC_ARTIFACTS[0].summary.throughputEventsPerSecond);
    });
  });

  it('returns null deltas when the baseline is zero', () => {
    expect(percentDelta(10, 0)).toBeNull();
  });
});
