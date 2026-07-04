import { describe, expect, it } from 'vitest';
import { buildReplay, parseSourceSeq } from './buildReplay';
import { syntheticRun } from '../fixtures/syntheticRun';

describe('parseSourceSeq', () => {
  it('extracts the sequence number from a partition/sequence ref', () => {
    expect(parseSourceSeq('1/3332')).toBe(3332);
    expect(parseSourceSeq('17/0')).toBe(0);
  });
});

describe('buildReplay', () => {
  const model = buildReplay(syntheticRun());

  it('orders messages chronologically by event time (seq tie-break; timeless last)', () => {
    // The synthetic rows share one timestamp, so equal times tie-break on ascending seq, and the
    // record-less Skipped message (14, no timestamp) sorts last.
    expect(model.messages.map((m) => m.seq)).toEqual([11, 12, 13, 15, 14]);
  });

  it('renders by browser-event time, not Event Hub sequence, when they disagree', () => {
    // Mirror the real-world inversion: ascending seq maps to descending event time. Rendering must
    // recover chronological order regardless of the (publisher-controlled) sequence order.
    const run = syntheticRun();
    const times: Record<number, string> = {
      11: '2026-06-26T17:54:27.641+00:00', // latest
      12: '2026-06-26T17:54:00.000+00:00',
      13: '2026-06-26T17:53:00.000+00:00',
      15: '2026-06-26T17:52:00.000+00:00', // earliest
    };
    for (const m of run.messages.messages) {
      if (m.record && times[m.sequenceNumber]) m.record.timestampUtc = times[m.sequenceNumber];
    }
    const reordered = buildReplay(run);
    expect(reordered.messages.map((m) => m.seq)).toEqual([15, 13, 12, 11, 14]);
    // Sequence extents stay correct even though the array is no longer seq-sorted.
    expect(reordered.sequenceRange).toEqual({ min: 11, max: 15 });
  });

  it('derives a label from payload action/actionModifier when eventType is null', () => {
    expect(model.messageBySeq.get(11)?.label).toBe('BladeFullReady/open');
    expect(model.messageBySeq.get(13)?.label).toBe('FrameworkNoise/mark');
  });

  it('parses the blade ref from the context string', () => {
    expect(model.messageBySeq.get(11)?.bladeInstanceId).toBe('Blade_s-aaaa_11');
  });

  it('derives disposition: emitted, acknowledged, skipped, pending', () => {
    expect(model.messageBySeq.get(11)?.disposition).toBe('emitted');
    expect(model.messageBySeq.get(12)?.disposition).toBe('emitted');
    expect(model.messageBySeq.get(13)?.disposition).toBe('acknowledged');
    expect(model.messageBySeq.get(14)?.disposition).toBe('skipped');
    expect(model.messageBySeq.get(15)?.disposition).toBe('pending');
  });

  it('derives approximate session groups from pending mapped messages', () => {
    // s-aaaa (11,12) and s-cccc (15). s-bbbb's only message is the unknown-session ack source but
    // its record sessionId is s-bbbb, so it forms a group too. Order by min seq.
    const ids = model.groups.map((g) => g.sessionId);
    expect(ids).toContain('s-aaaa');
    expect(ids).toContain('s-cccc');
    expect(model.groups.every((g) => g.authoritative === false)).toBe(true);
  });

  it('builds occurrences with stable ids and parsed sources', () => {
    expect(model.occurrences).toHaveLength(2);
    const emit = model.occurrences.find((o) => o.kind === 'Emit')!;
    expect(emit.sources).toEqual([11, 12]);
    expect(emit.perf).toEqual({ timeToSettledMs: 1699 });
    const ack = model.occurrences.find((o) => o.kind === 'Acknowledge')!;
    expect(ack.sources).toEqual([13]);
  });

  it('anchors checkpoints: starting = min-1, final from flush summary', () => {
    expect(model.startingCheckpoint).toBe(10);
    expect(model.finalCheckpoint).toBe(14);
    expect(model.sequenceRange).toEqual({ min: 11, max: 15 });
  });

  it('batches the load phase into at most 4 bulk-fill steps', () => {
    const { load } = model.phaseOffsets;
    expect(load.count).toBeLessThanOrEqual(4);
    expect(load.count).toBeGreaterThanOrEqual(1);
    // 5 messages over <=4 batches of ceil(5/4)=2 -> 3 steps.
    expect(load.count).toBe(3);
    // Every message is still covered exactly once across the batches (chronological fill order).
    const loadSeqs = model.steps
      .filter((s) => s.phase === 'load')
      .flatMap((s) => s.seqs ?? []);
    expect(loadSeqs).toEqual([11, 12, 13, 15, 14]);
  });

  it('produces load+group+compose+flush steps with contiguous phase offsets', () => {
    const { load, group, compose, flush } = model.phaseOffsets;
    expect(compose.count).toBe(2);
    expect(flush.count).toBe(2);
    expect(load.start).toBe(0);
    expect(group.start).toBe(load.count);
    expect(compose.start).toBe(load.count + group.count);
    expect(flush.start).toBe(load.count + group.count + compose.count);
    expect(model.steps).toHaveLength(load.count + group.count + compose.count + flush.count);
  });
});
