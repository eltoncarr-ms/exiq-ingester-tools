import { describe, expect, it } from 'vitest';
import { parsePollJsonlText, parsePollLine } from './parse';
import {
  SAMPLE_FAILED_CYCLE_LINE,
  SAMPLE_OTHER_SOURCE_CYCLE_LINE,
  SAMPLE_POLL_JSONL,
  SAMPLE_SKIPPED_CYCLE_LINE,
  cycleEventLine,
  stageEventLine,
} from './sample';
import type { PollCycleEvent, PollStageEvent } from './types';

describe('parsePollLine', () => {
  it('parses a valid stage start event', () => {
    const result = parsePollLine(stageEventLine({ ev: 'start', atMs: 5, durMs: undefined }), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.type).toBe('stage');
    const stage = result.event as PollStageEvent;
    expect(stage.stage).toBe('seal');
    expect(stage.ev).toBe('start');
    expect(stage.durMs).toBeUndefined();
  });

  it('parses a valid stage end event with durMs', () => {
    const result = parsePollLine(stageEventLine({ ev: 'end', atMs: 20, durMs: 8 }), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stage = result.event as PollStageEvent;
    expect(stage.ev).toBe('end');
    expect(stage.durMs).toBe(8);
  });

  it('rejects a stage end event missing durMs', () => {
    const raw = JSON.stringify({ type: 'stage', ts: '2026-02-01T00:00:00.000Z', runId: 'r1', stage: 'seal', ev: 'end', atMs: 20 });
    const result = parsePollLine(raw, 3);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 3\.durMs must be a finite number/);
  });

  it('parses a successful cycle event and keeps optional producer facts', () => {
    const result = parsePollLine(cycleEventLine(), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.type).toBe('cycle');
    const cycle = result.event as PollCycleEvent;
    expect(cycle.outcome).toBe('success');
    expect(cycle.users).toBe(42);
    expect(cycle.kustoMs).toBe(3100);
    expect(cycle.writeMs).toBe(1700);
    expect(cycle.advanceMs).toBe(90);
    expect(cycle.writeInteractionsRu).toBeCloseTo(615.2);
    expect(cycle.timeline).toHaveLength(4);
    expect(cycle.facts.selectivity).toBeUndefined();
    expect(cycle.facts.source).toBe('portal-firehose');
  });

  it('parses a minimal skipped cycle without optional stage facts', () => {
    const result = parsePollLine(SAMPLE_SKIPPED_CYCLE_LINE, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cycle = result.event as PollCycleEvent;
    expect(cycle.outcome).toBe('skipped');
    expect(cycle.records).toBe(0);
    expect(cycle.users).toBeUndefined();
    expect(cycle.kustoMs).toBeUndefined();
    expect(cycle.writeMs).toBeUndefined();
    expect(cycle.failingStage).toBeUndefined();
  });

  it('parses a partial failed cycle with failingStage and error but no write/advance facts', () => {
    const result = parsePollLine(SAMPLE_FAILED_CYCLE_LINE, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cycle = result.event as PollCycleEvent;
    expect(cycle.outcome).toBe('failed');
    expect(cycle.failingStage).toBe('seal');
    expect(cycle.error).toBe('KustoServiceException');
    expect(cycle.users).toBeUndefined();
    expect(cycle.writeMs).toBeUndefined();
    expect(cycle.advanceMs).toBeUndefined();
  });

  it('reports malformed JSON as a warning without throwing', () => {
    const result = parsePollLine('{not valid json', 7);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.line).toBe(7);
    expect(result.warning.message).toBe('line 7: invalid JSON.');
    expect(result.warning.raw).toBe('{not valid json');
  });

  it('reports an unknown record type as a warning', () => {
    const raw = JSON.stringify({ type: 'heartbeat', ts: '2026-02-01T00:00:00.000Z' });
    const result = parsePollLine(raw, 9);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toBe('line 9: unknown event type "heartbeat".');
  });

  it('reports a missing required field with a field-level path', () => {
    const raw = JSON.stringify({ type: 'cycle', ts: '2026-02-01T00:00:00.000Z', runId: 'r1' });
    const result = parsePollLine(raw, 2);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 2\.source must be a non-empty string/);
  });

  it('rejects an invalid outcome enum value', () => {
    const raw = JSON.stringify(JSON.parse(cycleEventLine({ outcome: 'partial' })));
    const result = parsePollLine(raw, 4);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 4\.outcome must be one of: success, skipped, failed/);
  });

  it('rejects a stage event with an unparsable ts as a warning, not a throw', () => {
    const result = parsePollLine(stageEventLine({ ts: 'not-a-timestamp' }), 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 5\.ts must be a valid ISO timestamp/);
  });

  it('rejects a cycle event with an unparsable ts', () => {
    const result = parsePollLine(cycleEventLine({ ts: 'not-a-timestamp' }), 6);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 6\.ts must be a valid ISO timestamp/);
  });

  it('rejects a cycle event with an unparsable startedAtUtc', () => {
    const result = parsePollLine(cycleEventLine({ startedAtUtc: 'yesterday' }), 7);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 7\.startedAtUtc must be a valid ISO timestamp/);
  });

  it('rejects a cycle event with an unparsable completedAtUtc', () => {
    const result = parsePollLine(cycleEventLine({ completedAtUtc: 'never' }), 8);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 8\.completedAtUtc must be a valid ISO timestamp/);
  });

  it('rejects an empty-string timestamp the same as a missing one', () => {
    const result = parsePollLine(cycleEventLine({ startedAtUtc: '' }), 9);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning.message).toMatch(/line 9\.startedAtUtc must be a non-empty string/);
  });

  it('still parses a cycle event whose timestamps are valid ISO strings without milliseconds', () => {
    const result = parsePollLine(
      cycleEventLine({
        ts: '2026-02-01T00:00:05Z',
        startedAtUtc: '2026-02-01T00:00:00Z',
        completedAtUtc: '2026-02-01T00:00:05Z',
      }),
      10,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cycle = result.event as PollCycleEvent;
    expect(cycle.ts).toBe('2026-02-01T00:00:05Z');
    expect(cycle.startedAtUtc).toBe('2026-02-01T00:00:00Z');
    expect(cycle.completedAtUtc).toBe('2026-02-01T00:00:05Z');
  });

  it('still parses a stage event whose ts is a valid ISO string with a numeric offset', () => {
    const result = parsePollLine(stageEventLine({ ts: '2026-02-01T00:00:00.000+00:00' }), 11);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stage = result.event as PollStageEvent;
    expect(stage.ts).toBe('2026-02-01T00:00:00.000+00:00');
  });
});

describe('parsePollJsonlText', () => {
  it('parses the mixed sample stream, joining stage and cycle events without a broad fallback shape', () => {
    const { events, warnings } = parsePollJsonlText(SAMPLE_POLL_JSONL);

    const stageEvents = events.filter((event): event is PollStageEvent => event.type === 'stage');
    const cycleEvents = events.filter((event): event is PollCycleEvent => event.type === 'cycle');

    expect(stageEvents).toHaveLength(4);
    expect(cycleEvents).toHaveLength(4);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((warning) => warning.message.includes('invalid JSON'))).toBe(true);
    expect(warnings.some((warning) => warning.message.includes('unknown event type'))).toBe(true);
  });

  it('continues parsing valid lines after a malformed line and an unknown type', () => {
    const { events } = parsePollJsonlText(SAMPLE_POLL_JSONL);
    const runIds = events.map((event) => event.runId);

    expect(runIds).toContain('run-skipped-1');
    expect(runIds).toContain('run-failed-1');
    expect(runIds).toContain('run-success-2');
  });

  it('supports multiple sources in one stream', () => {
    const { events } = parsePollJsonlText(SAMPLE_POLL_JSONL);
    const cycleEvents = events.filter((event): event is PollCycleEvent => event.type === 'cycle');
    const sources = new Set(cycleEvents.map((cycle) => cycle.source));

    expect(sources).toEqual(new Set(['portal-firehose', 'audit-firehose']));
  });

  it('reports the outcome mix across success, skipped, and failed cycles', () => {
    const { events } = parsePollJsonlText(SAMPLE_POLL_JSONL);
    const outcomes = events.filter((event): event is PollCycleEvent => event.type === 'cycle').map((cycle) => cycle.outcome);

    expect(outcomes).toEqual(expect.arrayContaining(['success', 'skipped', 'failed', 'success']));
  });

  it('skips blank lines silently', () => {
    const { events, warnings } = parsePollJsonlText(`\n${cycleEventLine()}\n\n`);

    expect(events).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('parses an independently-authored second-source cycle correctly', () => {
    const { events } = parsePollJsonlText(SAMPLE_OTHER_SOURCE_CYCLE_LINE);
    const cycle = events[0] as PollCycleEvent;

    expect(cycle.source).toBe('audit-firehose');
    expect(cycle.users).toBe(7);
  });
});
