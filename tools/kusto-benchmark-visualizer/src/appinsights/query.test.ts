import { describe, expect, it } from 'vitest';
import { loadCompletedCycles } from './query';
import { SAMPLE_RAW_ROWS, singletonLaneRow } from './sample';
import type { TabularQueryExport } from './types';

describe('loadCompletedCycles — fixture mode', () => {
  it('loads the checked-in fixture sample and returns normalized rows', async () => {
    const rows = await loadCompletedCycles({ kind: 'fixture' });
    expect(rows.length).toBe(SAMPLE_RAW_ROWS.length);
    // All rows have a rowKind
    for (const row of rows) {
      expect(['laneAttempt', 'shardSetValidationFailedSweep']).toContain(row.rowKind);
    }
  });

  it('returns typed CompletedCycleRow with correct field names (camelCase)', async () => {
    const rows = await loadCompletedCycles({ kind: 'fixture' });
    const row = rows[0]!;
    expect(typeof row.rowKind).toBe('string');
    expect(typeof row.eventTimeUtc).toBe('string');
    expect(typeof row.appRoleName).toBe('string');
    // PascalCase keys should NOT appear at the top level
    expect((row as unknown as Record<string, unknown>)['RowKind']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['EventTimeUtc']).toBeUndefined();
  });
});

describe('loadCompletedCycles — file mode', () => {
  function makeFile(content: string, name = 'export.json'): File {
    return new File([content], name, { type: 'application/json' });
  }

  it('loads a flat array of raw objects (same shape as fixture)', async () => {
    const raw = [singletonLaneRow()];
    const file = makeFile(JSON.stringify(raw));
    const rows = await loadCompletedCycles({ kind: 'file', file });
    expect(rows.length).toBe(1);
    expect(rows[0]!.rowKind).toBe('laneAttempt');
  });

  it('loads a tabular Azure Monitor export', async () => {
    const raw = singletonLaneRow();
    const tabular: TabularQueryExport = {
      tables: [
        {
          name: 'PrimaryResult',
          columns: Object.keys(raw).map((name) => ({ name })),
          rows: [Object.values(raw)],
        },
      ],
    };
    const file = makeFile(JSON.stringify(tabular));
    const rows = await loadCompletedCycles({ kind: 'file', file });
    expect(rows.length).toBe(1);
    expect(rows[0]!.source).toBe('portal-firehose');
  });

  it('fixture and file modes converge on the same normalized shape', async () => {
    const fixtureRows = await loadCompletedCycles({ kind: 'fixture' });
    const fileRows = await loadCompletedCycles({
      kind: 'file',
      file: makeFile(JSON.stringify(SAMPLE_RAW_ROWS)),
    });
    expect(fileRows.length).toBe(fixtureRows.length);
    expect(fileRows[0]!.rowKind).toBe(fixtureRows[0]!.rowKind);
    expect(fileRows[0]!.shardId).toBe(fixtureRows[0]!.shardId);
    expect(fileRows[0]!.records).toBe(fixtureRows[0]!.records);
  });

  it('throws a descriptive error for malformed JSON', async () => {
    const file = makeFile('{bad json', 'bad.json');
    await expect(loadCompletedCycles({ kind: 'file', file })).rejects.toThrow(
      /Failed to parse JSON from file "bad.json"/,
    );
  });

  it('throws a descriptive error for an unsupported JSON shape', async () => {
    const file = makeFile(JSON.stringify({ unexpected: true }));
    await expect(loadCompletedCycles({ kind: 'file', file })).rejects.toThrow(
      /unsupported input shape/i,
    );
  });
});
