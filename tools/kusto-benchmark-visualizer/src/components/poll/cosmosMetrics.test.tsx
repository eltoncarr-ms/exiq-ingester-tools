import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildPollAnalysis } from '../../poll/derive';
import { parsePollJsonlText } from '../../poll/parse';
import { cycleEventLine, SAMPLE_SKIPPED_CYCLE_LINE } from '../../poll/sample';
import { PollMetricDashboard } from './PollMetricDashboard';
import { PollTimelineReplay } from './PollTimelineReplay';

function sourceFor(line: string) {
  const source = buildPollAnalysis(parsePollJsonlText(line).events).sources[0];
  if (!source) throw new Error('expected a source');
  return source;
}

describe('Cosmos metric UI', () => {
  it('renders source totals as counts and keeps verified zero visible', () => {
    const source = sourceFor(
      cycleEventLine({
        cosmosRetryCount: 0,
        cosmos429Count: 2,
        cosmosWriteAttempted: 4,
        cosmosWriteSucceeded: 4,
        cosmosWriteFailed: 0,
        cosmosWriteCancelled: 0,
      }),
    );

    const markup = renderToStaticMarkup(<PollMetricDashboard source={source} />);

    expect(markup).toContain('Cosmos retries</div><div class="metric-card__value">0</div>');
    expect(markup).toContain('Cosmos 429s</div><div class="metric-card__value">2</div>');
    expect(markup).toContain('Writes attempted</div><div class="metric-card__value">4</div>');
    expect(markup).toContain('Affected cycles</div><div class="metric-card__value">1</div>');
    expect(markup).not.toContain('Cosmos retries</div><div class="metric-card__value">0 ms</div>');
  });

  it('renders absent source and selected-cycle values as em dashes', () => {
    const source = sourceFor(SAMPLE_SKIPPED_CYCLE_LINE);

    const dashboard = renderToStaticMarkup(<PollMetricDashboard source={source} />);
    const replay = renderToStaticMarkup(
      <PollTimelineReplay cycles={source.cycles} selectedRunId={source.cycles[0].runId} onSelect={() => undefined} />,
    );

    expect(dashboard).toContain('Cosmos retries</div><div class="metric-card__value">—</div>');
    expect(dashboard).toContain('Affected cycles</div><div class="metric-card__value">—</div>');
    expect(replay).toContain('Retries · —');
    expect(replay).toContain('Attempted · —');
  });

  it('includes selected-cycle Cosmos counts in compact pills and the write-stage tooltip', () => {
    const source = sourceFor(
      cycleEventLine({
        cosmosRetryCount: 3,
        cosmos429Count: 2,
      }),
    );
    const markup = renderToStaticMarkup(
      <PollTimelineReplay cycles={source.cycles} selectedRunId={source.cycles[0].runId} onSelect={() => undefined} />,
    );

    expect(markup).toContain('Retries · 3');
    expect(markup).toContain('429s · 2');
    expect(markup).toContain('Attempted · 42');
    expect(markup).toContain('Succeeded · 42');
    expect(markup).toContain('Failed · 0');
    expect(markup).toContain('Cancelled · 0');
    expect(markup).toContain('Cosmos counts for this cycle: retries 3; 429s 2; attempted 42; succeeded 42; failed 0; cancelled 0.');
  });
});
