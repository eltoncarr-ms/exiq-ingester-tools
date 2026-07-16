import { describe, expect, it } from 'vitest';
import { flushPollTail, INITIAL_POLL_TAIL_STATE, pushPollTailChunk } from './tail';
import { cycleEventLine, stageEventLine } from './sample';
import type { PollCycleEvent, PollStageEvent } from './types';

describe('pushPollTailChunk', () => {
  it('parses one or more complete lines delivered in a single newline-terminated chunk', () => {
    const chunk = `${stageEventLine({ runId: 'r1' })}\n${cycleEventLine({ runId: 'r1' })}\n`;
    const result = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, chunk);

    expect(result.events).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
    expect(result.state.carry).toBe('');
    expect(result.state.nextLine).toBe(3);
  });

  it('retains a partial trailing line across a chunk boundary without parsing it early', () => {
    const line = cycleEventLine({ runId: 'r1' });
    const splitAt = Math.floor(line.length / 2);
    const first = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, line.slice(0, splitAt));

    expect(first.events).toHaveLength(0);
    expect(first.warnings).toHaveLength(0);
    expect(first.state.carry).toBe(line.slice(0, splitAt));
    expect(first.state.nextLine).toBe(1);

    const second = pushPollTailChunk(first.state, `${line.slice(splitAt)}\n`);

    expect(second.events).toHaveLength(1);
    expect(second.warnings).toHaveLength(0);
    expect((second.events[0] as PollCycleEvent).runId).toBe('r1');
    expect(second.state.carry).toBe('');
    expect(second.state.nextLine).toBe(2);
  });

  it('never duplicates a line reassembled from a split chunk boundary', () => {
    const line = cycleEventLine({ runId: 'only-once' });
    const splitAt = 17;
    const state1 = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, line.slice(0, splitAt)).state;
    const step2 = pushPollTailChunk(state1, `${line.slice(splitAt)}\n`);

    const allRunIds = step2.events.map((event) => event.runId);
    expect(allRunIds).toEqual(['only-once']);
  });

  it('parses multiple complete lines plus a retained carry within one chunk', () => {
    const partial = cycleEventLine({ runId: 'r3' }).slice(0, 10);
    const chunk = `${stageEventLine({ runId: 'r1' })}\n${stageEventLine({ runId: 'r2', atMs: 20 })}\n${partial}`;
    const result = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, chunk);

    expect(result.events).toHaveLength(2);
    expect(result.events.every((event) => event.type === 'stage')).toBe(true);
    expect(result.state.carry).toBe(partial);
    expect(result.state.nextLine).toBe(3);
  });

  it('assigns absolute line numbers across chunks, skipping blank lines without warning', () => {
    const state1 = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, `${stageEventLine()}\n\n`).state;
    const result = pushPollTailChunk(state1, '{not valid json\n');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].line).toBe(3);
    expect(result.state.nextLine).toBe(4);
  });

  it('reports a warning (not a thrown error) for a malformed complete line, and keeps reading after it', () => {
    const chunk = `{not valid json\n${cycleEventLine({ runId: 'ok-after-malformed' })}\n`;
    const result = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, chunk);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].line).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runId).toBe('ok-after-malformed');
  });

  it('handles a chunk boundary that falls exactly on a newline character', () => {
    const first = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, `${stageEventLine({ runId: 'r1' })}\n`);
    expect(first.state.carry).toBe('');

    const second = pushPollTailChunk(first.state, `${stageEventLine({ runId: 'r2', atMs: 5 })}\n`);
    expect(second.events).toHaveLength(1);
    expect((second.events[0] as PollStageEvent).runId).toBe('r2');
    expect(second.state.nextLine).toBe(3);
  });
});

describe('flushPollTail', () => {
  it('parses a final carry line that never received a trailing newline', () => {
    const line = cycleEventLine({ runId: 'final-line' });
    const afterChunk = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, line);
    expect(afterChunk.events).toHaveLength(0);

    const flushed = flushPollTail(afterChunk.state);

    expect(flushed.events).toHaveLength(1);
    expect(flushed.warnings).toHaveLength(0);
    expect((flushed.events[0] as PollCycleEvent).runId).toBe('final-line');
    expect(flushed.state.carry).toBe('');
  });

  it('reports a warning when the final carry is malformed', () => {
    const afterChunk = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, '{not valid json');
    const flushed = flushPollTail(afterChunk.state);

    expect(flushed.events).toHaveLength(0);
    expect(flushed.warnings).toHaveLength(1);
    expect(flushed.warnings[0].raw).toBe('{not valid json');
  });

  it('produces neither an event nor a warning when there is no carry to flush', () => {
    const state = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, `${stageEventLine()}\n`).state;
    const flushed = flushPollTail(state);

    expect(flushed.events).toHaveLength(0);
    expect(flushed.warnings).toHaveLength(0);
    expect(flushed.state).toEqual(state);
  });

  it('is safe to call again after flushing, without re-emitting the same line', () => {
    const afterChunk = pushPollTailChunk(INITIAL_POLL_TAIL_STATE, cycleEventLine({ runId: 'once-only' }));
    const firstFlush = flushPollTail(afterChunk.state);
    const secondFlush = flushPollTail(firstFlush.state);

    expect(firstFlush.events).toHaveLength(1);
    expect(secondFlush.events).toHaveLength(0);
    expect(secondFlush.warnings).toHaveLength(0);
  });

  it('treats a blank-only carry as nothing to flush', () => {
    const state = { carry: '   ', nextLine: 5 };
    const flushed = flushPollTail(state);

    expect(flushed.events).toHaveLength(0);
    expect(flushed.warnings).toHaveLength(0);
    expect(flushed.state).toEqual({ carry: '', nextLine: 5 });
  });
});
