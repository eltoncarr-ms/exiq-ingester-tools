import { describe, expect, it } from 'vitest';
import { normalizeRows } from './normalize';
import {
  SAMPLE_RAW_ROWS,
  bandCommitRow,
  bulkWriteModeRow,
  cancelledRow,
  continuedBandFirstPageRow,
  continuedBandResumedRow,
  leaseContentionRow,
  missingOptionalFieldsRow,
  mixedSchemaRow,
  observedZeroRow,
  shardValidationFailureRow,
  shardedLaneRow,
  singletonLaneRow,
  unknownAdditiveFact,
} from './sample';
import type { TabularQueryExport } from './types';

describe('normalizeRows — shape convergence', () => {
  it('accepts a flat array of PascalCase raw objects (fixture shape)', () => {
    const rows = normalizeRows(SAMPLE_RAW_ROWS);
    expect(rows.length).toBe(SAMPLE_RAW_ROWS.length);
  });

  it('accepts Azure Monitor tabular export shape and produces the same row count', () => {
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

    const fromFlat = normalizeRows([raw]);
    const fromTabular = normalizeRows(tabular);

    expect(fromFlat.length).toBe(1);
    expect(fromTabular.length).toBe(1);
    expect(fromFlat[0].rowKind).toBe(fromTabular[0].rowKind);
    expect(fromFlat[0].eventTimeUtc).toBe(fromTabular[0].eventTimeUtc);
    expect(fromFlat[0].shardId).toBe(fromTabular[0].shardId);
    expect(fromFlat[0].records).toBe(fromTabular[0].records);
  });

  it('throws a descriptive error for an unsupported input shape (plain string)', () => {
    expect(() => normalizeRows('not-a-valid-shape')).toThrow(/unsupported input shape/i);
  });

  it('throws a descriptive error for null input', () => {
    expect(() => normalizeRows(null)).toThrow(/unsupported input shape/i);
  });

  it('throws a descriptive error for a plain object (not array, not tabular)', () => {
    expect(() => normalizeRows({ foo: 'bar' })).toThrow(/unsupported input shape/i);
  });
});

describe('normalizeRows — missing vs zero', () => {
  it('preserves null for missing numeric fields (never coerces to 0)', () => {
    const row = normalizeRows([missingOptionalFieldsRow()])[0]!;
    expect(row.kustoMs).toBeNull();
    expect(row.mapMs).toBeNull();
    expect(row.records).toBeNull();
    expect(row.backlogAfterSeconds).toBeNull();
    expect(row.rawScanRows).toBeNull();
    expect(row.rawBandRows).toBeNull();
    expect(row.cursorLagAfterSeconds).toBeNull();
    expect(row.interactionWriteRu).toBeNull();
    expect(row.totalCosmosRu).toBeNull();
  });

  it('preserves 0 as an observed zero — distinct from null', () => {
    const row = normalizeRows([observedZeroRow()])[0]!;
    expect(row.records).toBe(0);
    expect(row.backlogBeforeSeconds).toBe(0);
    expect(row.backlogAfterSeconds).toBe(0);
    expect(row.committedProgressSeconds).toBe(0);
    expect(row.rawScanRows).toBe(0);
    expect(row.rawBandRows).toBe(0);
    expect(row.cursorLagAfterSeconds).toBe(0);
    expect(row.interactionWriteRu).toBe(0);
    expect(row.cosmosAttempted).toBe(0);
    expect(row.sdkFailedServiceRequestCount).toBe(0);
    expect(row.terminal429OperationCount).toBe(0);
  });

  it('preserves null booleans without coercing to false', () => {
    const row = normalizeRows([leaseContentionRow()])[0]!;
    expect(row.leaseLost).toBeNull();
  });

  it('preserves false booleans as false (not null)', () => {
    const row = normalizeRows([singletonLaneRow()])[0]!;
    expect(row.leaseLost).toBe(false);
    expect(row.leaseAcquired).toBe(true);
  });
});

describe('normalizeRows — shardId/shardCount distinguishing', () => {
  it('singleton row has empty shardId and null shardCount', () => {
    const row = normalizeRows([singletonLaneRow()])[0]!;
    expect(row.shardId).toBe('');
    expect(row.shardCount).toBeNull();
  });

  it('sharded row has non-empty shardId and non-null shardCount', () => {
    const row = normalizeRows([shardedLaneRow({ ShardId: '1', ShardCount: 3 })])[0]!;
    expect(row.shardId).toBe('1');
    expect(row.shardCount).toBe(3);
  });

  it('sharded shard-0 is distinguishable from singleton (shardCount differentiates)', () => {
    const sharded0 = normalizeRows([shardedLaneRow({ ShardId: '0', ShardCount: 3 })])[0]!;
    const singleton = normalizeRows([singletonLaneRow()])[0]!;
    expect(sharded0.shardId).toBe('0');
    expect(sharded0.shardCount).toBe(3);
    expect(singleton.shardId).toBe('');
    expect(singleton.shardCount).toBeNull();
  });

  it('validation-failure row has empty shardId (no shard for sweep rows)', () => {
    const row = normalizeRows([shardValidationFailureRow()])[0]!;
    expect(row.rowKind).toBe('shardSetValidationFailedSweep');
    expect(row.shardId).toBe('');
  });
});

describe('normalizeRows — mixed schema', () => {
  it('maps blank schemaVersion to "pre-schema" sentinel and executionMode to "unknown"', () => {
    const row = normalizeRows([mixedSchemaRow()])[0]!;
    expect(row.schemaVersion).toBe('pre-schema');
    expect(row.executionMode).toBe('unknown');
    expect(row.progressKind).toBe('');
  });

  it('null fields on pre-schema row remain null', () => {
    const row = normalizeRows([mixedSchemaRow()])[0]!;
    expect(row.kustoMs).toBeNull();
    expect(row.rowsScanned).toBeNull();
    expect(row.rawScanRows).toBeNull();
    expect(row.rawBandRows).toBeNull();
    expect(row.cursorLagAfterSeconds).toBeNull();
    expect(row.interactionWriteRu).toBeNull();
    expect(row.cosmosAttempted).toBeNull();
  });
});

describe('normalizeRows — new poll telemetry contract fields', () => {
  it('normalizes band/page, raw rows, cursor lag, progress kind, and interaction RU', () => {
    const row = normalizeRows([bandCommitRow()])[0]!;
    expect(row.bandId).toBe('3/2/h2:638844372000000000:638844378000000000');
    expect(row.pageNumber).toBe(1);
    expect(row.rawScanRows).toBe(1500);
    expect(row.rawBandRows).toBe(1450);
    expect(row.cursorLagAfterSeconds).toBe(12);
    expect(row.progressKind).toBe('bandCommit');
    expect(row.interactionWriteRu).toBe(4100);
    expect(row.interactionWriteRuComplete).toBe('complete');
  });

  it('preserves shared band identity across resumed pages and keeps rawBandRows absent on resumes', () => {
    const [first, resumed] = normalizeRows([
      continuedBandFirstPageRow(),
      continuedBandResumedRow(),
    ]);
    expect(first.bandId).toBe(resumed.bandId);
    expect(first.pageNumber).toBe(1);
    expect(resumed.pageNumber).toBe(2);
    expect(first.rawBandRows).toBe(880);
    expect(resumed.rawBandRows).toBeNull();
    expect(resumed.progressKind).toBe('continuation');
  });

  it('maps absent progressKind on cancelled rows to the empty-string string contract', () => {
    const row = normalizeRows([cancelledRow()])[0]!;
    expect(row.outcome).toBe('cancelled');
    expect(row.progressKind).toBe('');
    expect(row.interactionWriteRuComplete).toBe('partial');
  });
});

describe('normalizeRows — unknown additive facts', () => {
  it('preserves unknown additive keys in the facts bag', () => {
    const row = normalizeRows([unknownAdditiveFact()])[0]!;
    expect(row.facts).toBeDefined();
    expect(row.facts!['ExperimentalThrottleScore']).toBe(0.72);
    expect(row.facts!['AnotherUnknownFact']).toBe('some-value');
  });

  it('does not elevate unknown facts to typed fields', () => {
    const row = normalizeRows([unknownAdditiveFact()])[0]!;
    // Typed fields should not be contaminated
    expect((row as unknown as Record<string, unknown>)['ExperimentalThrottleScore']).toBeUndefined();
  });

  it('does not create a facts bag for rows with only known keys', () => {
    const row = normalizeRows([singletonLaneRow()])[0]!;
    expect(row.facts).toBeUndefined();
  });
});

describe('normalizeRows — cancelled and contention rows', () => {
  it('normalizes cancelled row correctly', () => {
    const row = normalizeRows([cancelledRow()])[0]!;
    expect(row.outcome).toBe('cancelled');
    expect(row.failingStage).toBe('write');
    expect(row.cosmosFailed).toBe(10);
    expect(row.cosmosCancelled).toBe(35);
  });

  it('normalizes lease-contention (skipped) row correctly', () => {
    const row = normalizeRows([leaseContentionRow()])[0]!;
    expect(row.outcome).toBe('skipped');
    expect(row.skipReason).toBe('leaseContention');
    expect(row.leaseAcquired).toBe(false);
    expect(row.records).toBeNull();
  });
});

describe('normalizeRows — bulk write mode', () => {
  it('normalizes bulk write row with writeInteractionsSuccessRu', () => {
    const row = normalizeRows([bulkWriteModeRow()])[0]!;
    expect(row.activeWriteMode).toBe('bulk');
    expect(row.enableBulkInteractionWrites).toBe(true);
    expect(row.writeInteractionsSuccessRu).toBe(4200.0);
    expect(row.executionMode).toBe('drainSafe');
    expect(row.mapMs).not.toBeNull(); // drain-safe has mapMs
    expect(row.rowsScanned).not.toBeNull(); // drain-safe has rowsScanned
  });
});

describe('normalizeRows — tabular export edge cases', () => {
  it('handles an empty table (zero rows)', () => {
    const tabular: TabularQueryExport = {
      tables: [{ columns: [{ name: 'RowKind' }, { name: 'EventTimeUtc' }], rows: [] }],
    };
    const result = normalizeRows(tabular);
    expect(result).toHaveLength(0);
  });

  it('handles null values in tabular rows as null fields', () => {
    const tabular: TabularQueryExport = {
      tables: [
        {
          columns: [{ name: 'RowKind' }, { name: 'EventTimeUtc' }, { name: 'Records' }],
          rows: [['laneAttempt', '2026-01-01T00:00:00Z', null]],
        },
      ],
    };
    const result = normalizeRows(tabular);
    expect(result[0]!.records).toBeNull();
  });
});
