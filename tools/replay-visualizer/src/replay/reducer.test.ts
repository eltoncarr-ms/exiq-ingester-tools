import { describe, expect, it } from 'vitest';
import { buildReplay } from './buildReplay';
import { computeCheckpoint, reduceToStep } from './reducer';
import { syntheticRun } from '../fixtures/syntheticRun';
import type { MessageStatus } from './types';

describe('computeCheckpoint', () => {
  const seqs = [11, 12, 13, 14, 15];

  it('does not advance while messages are pending', () => {
    const status = new Map<number, MessageStatus>([[11, 'Pending']]);
    expect(computeCheckpoint(seqs, status, 10)).toBe(10);
  });

  it('advances across a contiguous done/skipped prefix and stops at the first pending', () => {
    const status = new Map<number, MessageStatus>([
      [11, 'Done'],
      [12, 'Done'],
      [13, 'Done'],
      [14, 'Skipped'],
      [15, 'Pending'],
    ]);
    // Skipped does not block; pending at 15 stops advancement.
    expect(computeCheckpoint(seqs, status, 10)).toBe(14);
  });

  it('never regresses below the starting checkpoint', () => {
    const status = new Map<number, MessageStatus>([[11, 'Pending']]);
    expect(computeCheckpoint(seqs, status, 12)).toBe(12);
  });

  it('reaches the final sequence when everything terminal', () => {
    const status = new Map<number, MessageStatus>(seqs.map((s) => [s, 'Done']));
    expect(computeCheckpoint(seqs, status, 10)).toBe(15);
  });
});

describe('reduceToStep', () => {
  const model = buildReplay(syntheticRun());
  const last = model.steps.length - 1;

  it('starts empty before any step', () => {
    const s = reduceToStep(model, -1);
    expect(s.loadedSeqs.size).toBe(0);
    expect(s.cosmosDocs).toHaveLength(0);
    expect(s.checkpoint).toBe(model.startingCheckpoint);
  });

  it('is deterministic: folding to i equals a fresh fold to i', () => {
    for (let i = 0; i <= last; i++) {
      const a = reduceToStep(model, i);
      const b = reduceToStep(model, i);
      expect([...a.status.entries()].sort()).toEqual([...b.status.entries()].sort());
      expect(a.checkpoint).toBe(b.checkpoint);
      expect(a.cosmosDocs.length).toBe(b.cosmosDocs.length);
    }
  });

  it('after load phase, all messages loaded and none done', () => {
    const s = reduceToStep(model, model.phaseOffsets.load.count - 1);
    expect(s.loadedSeqs.size).toBe(5);
    expect([...s.status.values()].filter((v) => v === 'Done')).toHaveLength(0);
    expect(s.checkpoint).toBe(model.startingCheckpoint);
  });

  it('final state: one cosmos doc, one drained, checkpoint at final', () => {
    const s = reduceToStep(model, last);
    expect(s.cosmosDocs).toHaveLength(1);
    expect(s.cosmosDocs[0].eventType).toBe('BladeInteraction');
    expect(s.drainedCount).toBe(1);
    expect(s.drainedOccurrenceIds.size).toBe(1);
    // The drained occurrence must not be reported as a Cosmos write.
    const drainedId = [...s.drainedOccurrenceIds][0];
    expect(s.cosmosDocs.some((d) => d.occurrenceId === drainedId)).toBe(false);
    // 11,12 (emit) and 13 (ack) done; 14 skipped; 15 still pending -> checkpoint stops at 14.
    expect(s.checkpoint).toBe(model.finalCheckpoint);
  });

  it('monotonic non-regressing checkpoint across the whole replay', () => {
    let prev = model.startingCheckpoint;
    for (let i = 0; i <= last; i++) {
      const cp = reduceToStep(model, i).checkpoint;
      expect(cp).toBeGreaterThanOrEqual(prev);
      prev = cp;
    }
  });

  it('computes the same checkpoint regardless of message render order', () => {
    // model.messages is sorted by event time; the reducer must still walk the seq frontier correctly.
    const run = syntheticRun();
    const times: Record<number, string> = {
      11: '2026-06-26T17:54:27.641+00:00',
      12: '2026-06-26T17:54:00.000+00:00',
      13: '2026-06-26T17:53:00.000+00:00',
      15: '2026-06-26T17:52:00.000+00:00',
    };
    for (const m of run.messages.messages) {
      if (m.record && times[m.sequenceNumber]) m.record.timestampUtc = times[m.sequenceNumber];
    }
    const reordered = buildReplay(run);
    const s = reduceToStep(reordered, reordered.steps.length - 1);
    expect(s.checkpoint).toBe(reordered.finalCheckpoint);
  });

  it('highlights the sources touched by a flush step', () => {
    const flushStart = model.phaseOffsets.flush.start;
    const s = reduceToStep(model, flushStart);
    expect(s.activePhase).toBe('flush');
    expect(s.highlightSeqs.size).toBeGreaterThan(0);
  });
});
