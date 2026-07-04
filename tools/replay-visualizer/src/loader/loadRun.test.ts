import { describe, expect, it } from 'vitest';
import { buildRawRun, RunLoadError } from './loadRun';

function makeFiles(extra: Record<string, string> = {}): Map<string, string> {
  const messages = JSON.stringify({
    count: 1,
    messages: [
      {
        partitionId: '1',
        sequenceNumber: 11,
        status: 'Pending',
        enqueuedTimeUtc: '2026-06-28T04:29:09.398+00:00',
        record: { sessionId: 's-aaaa', payload: { action: 'X', actionModifier: 'open' } },
      },
    ],
  });
  const composed = JSON.stringify({
    sessionId: 's-aaaa',
    count: 1,
    events: [{ kind: 'Emit', seal: 'Idle', lastActivityUtc: '2026', sourceCount: 1, sources: ['1/11'], document: { id: 'x', type: 'BladeInteraction' } }],
  });
  const flush = JSON.stringify({
    summary: { eventsWritten: 1, eventsFailed: 0, acknowledged: 0, messagesMarkedDone: 1, checkpointSequenceNumber: 11 },
    markedDone: { count: 1, messages: [] },
    written: { count: 1, events: [] },
  });
  return new Map<string, string>([
    ['run-x/00-messages.json', messages],
    ['run-x/01-composed/s-aaaa.json', composed],
    ['run-x/02-flush.json', flush],
    ...Object.entries(extra),
  ]);
}

describe('buildRawRun', () => {
  it('loads a legacy run from the three required artifacts', () => {
    const run = buildRawRun(makeFiles());
    expect(run.enhanced).toBe(false);
    expect(run.messages.count).toBe(1);
    expect(run.composed).toHaveLength(1);
    expect(run.partitionId).toBe('1');
  });

  it('throws a labeled error when 00-messages.json is missing', () => {
    const files = makeFiles();
    files.delete('run-x/00-messages.json');
    expect(() => buildRawRun(files)).toThrow(RunLoadError);
    expect(() => buildRawRun(files)).toThrow(/00-messages\.json/);
  });

  it('throws a labeled error when no composed files are present', () => {
    const files = makeFiles();
    files.delete('run-x/01-composed/s-aaaa.json');
    expect(() => buildRawRun(files)).toThrow(/01-composed/);
  });

  it('detects enhanced mode from run-meta.json with a recognized schema version', () => {
    const run = buildRawRun(
      makeFiles({
        'run-x/run-meta.json': JSON.stringify({ dumpSchemaVersion: 1, partitionId: '7', startingCheckpoint: 10, finalCheckpoint: 11 }),
      }),
    );
    expect(run.enhanced).toBe(true);
    expect(run.partitionId).toBe('7');
  });

  it('degrades to legacy when run-meta.json has an unrecognized schema version', () => {
    const run = buildRawRun(
      makeFiles({ 'run-x/run-meta.json': JSON.stringify({ dumpSchemaVersion: 999 }) }),
    );
    expect(run.enhanced).toBe(false);
  });

  it('treats a present-but-corrupt enhanced artifact as a hard, labeled error', () => {
    const files = makeFiles({ 'run-x/run-meta.json': '{ not json' });
    expect(() => buildRawRun(files)).toThrow(/run-meta\.json/);
  });

  it('treats a corrupt required artifact as a labeled error', () => {
    const files = makeFiles();
    files.set('run-x/02-flush.json', '{ broken');
    expect(() => buildRawRun(files)).toThrow(/02-flush\.json/);
  });
});
