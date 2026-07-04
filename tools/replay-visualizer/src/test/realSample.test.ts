import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRawRun, type RunFileMap } from '../loader/loadRun';
import { buildReplay } from '../replay/buildReplay';
import { reduceToStep } from '../replay/reducer';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(HERE, '..', '..', 'public', 'sample-run');

function loadSampleFiles(): RunFileMap {
  const files: RunFileMap = new Map();
  const add = (rel: string) => files.set(rel, readFileSync(join(SAMPLE_DIR, rel), 'utf8'));
  add('00-messages.json');
  add('02-flush.json');
  for (const f of readdirSync(join(SAMPLE_DIR, '01-composed'))) {
    if (f.endsWith('.json')) add(`01-composed/${f}`);
  }
  return files;
}

// End-to-end validation against the real captured dump (run-20260628-043048-650-p1).
describe('real sample run', () => {
  const run = buildRawRun(loadSampleFiles());
  const model = buildReplay(run);

  it('loads all 390 messages on partition 1', () => {
    expect(run.partitionId).toBe('1');
    expect(model.messages).toHaveLength(390);
  });

  it('matches the captured flush summary (8 written, 390 marked done, checkpoint 3577)', () => {
    expect(model.flushSummary.eventsWritten).toBe(8);
    expect(model.flushSummary.messagesMarkedDone).toBe(390);
    expect(model.finalCheckpoint).toBe(3577);
  });

  it('emits exactly 8 BladeInteraction cosmos docs at the end of the replay', () => {
    const final = reduceToStep(model, model.steps.length - 1);
    expect(final.cosmosDocs).toHaveLength(8);
    expect(final.cosmosDocs.every((d) => d.eventType === 'BladeInteraction')).toBe(true);
    expect(final.checkpoint).toBe(3577);
  });

  it('loads all 390 messages across at most 4 batched load steps', () => {
    const loadSteps = model.steps.filter((s) => s.phase === 'load');
    expect(loadSteps.length).toBeLessThanOrEqual(4);
    const loaded = loadSteps.flatMap((s) => s.seqs ?? []);
    expect(loaded).toHaveLength(390);
    expect(new Set(loaded).size).toBe(390);
  });

  it('renders messages in non-decreasing browser-event time despite reverse-chronological seq', () => {
    // The captured dump's Event Hub sequence is anti-correlated with event time (newest-first
    // publish). The store must render chronologically: each message's timestamp >= its predecessor.
    const times = model.messages
      .map((m) => (m.timestampUtc ? Date.parse(m.timestampUtc) : Number.NaN))
      .filter((t) => !Number.isNaN(t));
    expect(times.length).toBe(390);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
    // Sanity: the seq order is NOT the same as the render order (the bug this guards against).
    const seqs = model.messages.map((m) => m.seq);
    const seqSorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).not.toEqual(seqSorted);
  });

  it('produces a non-trivial, ordered step timeline', () => {
    expect(model.steps.length).toBeGreaterThan(10);
    const phases = model.steps.map((s) => s.phase);
    expect(phases.indexOf('load')).toBe(0);
    expect(phases.lastIndexOf('flush')).toBe(model.steps.length - 1);
  });

  it('animates the checkpoint as a multi-step sweep, not a single jump', () => {
    const finalizeSteps = model.steps.filter((s) => s.phase === 'flush' && s.finalizes);
    // A chunked sweep plus a resting frame — never one all-at-once finalize.
    expect(finalizeSteps.length).toBeGreaterThan(3);

    // The checkpoint must climb monotonically across the finalize steps (sync with the slider),
    // taking several intermediate values before settling at 3577.
    const checkpoints = finalizeSteps.map((s) => reduceToStep(model, s.index).checkpoint);
    for (let i = 1; i < checkpoints.length; i++) {
      expect(checkpoints[i]).toBeGreaterThanOrEqual(checkpoints[i - 1]);
    }
    expect(new Set(checkpoints).size).toBeGreaterThan(2);
    expect(checkpoints[checkpoints.length - 1]).toBe(3577);
  });

  it('ends on a settled frame: checkpoint final, all done, nothing highlighted', () => {
    const final = reduceToStep(model, model.steps.length - 1);
    expect(final.checkpoint).toBe(3577);
    // Every message marked done by the flush is coloured Done at rest.
    const done = [...final.status.values()].filter((v) => v === 'Done').length;
    expect(done).toBe(390);
    // The replay must not end on an all-highlighted frame.
    expect(final.highlightSeqs.size).toBe(0);
  });

  it('never highlights the entire done-set on any single finalize step', () => {
    const finalizeSteps = model.steps.filter((s) => s.phase === 'flush' && s.finalizes);
    for (const step of finalizeSteps) {
      const highlighted = reduceToStep(model, step.index).highlightSeqs.size;
      // Each step lights up only the band the frontier swept — a fraction of all 390.
      expect(highlighted).toBeLessThan(390);
    }
  });
});
