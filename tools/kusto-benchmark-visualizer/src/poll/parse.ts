import type {
  PollCycleEvent,
  PollEvent,
  PollOutcome,
  PollParseResult,
  PollParseWarning,
  PollStageEvent,
  PollStageEventKind,
  PollTimelineEntry,
} from './types';

const POLL_OUTCOMES: readonly PollOutcome[] = ['success', 'skipped', 'failed'];
const STAGE_EVENT_KINDS: readonly PollStageEventKind[] = ['start', 'end'];

/** Internal control-flow error for one line's field validation; never exported. */
class PollLineError extends Error {}

function fail(message: string): never {
  throw new PollLineError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string.`);
  }

  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;

  return requireString(value, path);
}

/**
 * Validates a required timestamp field: must be a non-empty string that
 * `Date.parse` resolves to a finite epoch ms value. Rejects unparsable
 * strings (e.g. `"not-a-date"`, `""`) as a normal field-validation failure
 * so the line is reported as a warning rather than silently accepted with a
 * downstream `NaN`/`Invalid Date`.
 */
function requireTimestamp(value: unknown, path: string): string {
  const raw = requireString(value, path);
  if (!Number.isFinite(Date.parse(raw))) {
    fail(`${path} must be a valid ISO timestamp.`);
  }

  return raw;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} must be a finite number.`);
  }

  return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;

  return requireNumber(value, path);
}

function requireEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T;
}

function parseTimelineEntry(value: unknown, path: string): PollTimelineEntry {
  if (!isRecord(value)) fail(`${path} must be an object.`);

  return {
    stage: requireString(value.stage, `${path}.stage`),
    startMs: requireNumber(value.startMs, `${path}.startMs`),
    durMs: requireNumber(value.durMs, `${path}.durMs`),
  };
}

function parseStageEvent(root: Record<string, unknown>, path: string): PollStageEvent {
  const ts = requireTimestamp(root.ts, `${path}.ts`);
  const runId = requireString(root.runId, `${path}.runId`);
  const stage = requireString(root.stage, `${path}.stage`);
  const ev = requireEnum(root.ev, `${path}.ev`, STAGE_EVENT_KINDS);
  const atMs = requireNumber(root.atMs, `${path}.atMs`);
  // durMs is only emitted when the stage closes ("end"); require it there so a
  // truncated end record still surfaces as a warning instead of a silent gap.
  const durMs = ev === 'end' ? requireNumber(root.durMs, `${path}.durMs`) : optionalNumber(root.durMs, `${path}.durMs`);

  return {
    type: 'stage',
    ts,
    runId,
    stage,
    ev,
    atMs,
    ...(durMs !== undefined ? { durMs } : {}),
  };
}

function parseCycleEvent(root: Record<string, unknown>, path: string): PollCycleEvent {
  const ts = requireTimestamp(root.ts, `${path}.ts`);
  const runId = requireString(root.runId, `${path}.runId`);
  const source = requireString(root.source, `${path}.source`);
  const outcome = requireEnum(root.outcome, `${path}.outcome`, POLL_OUTCOMES);
  const startedAtUtc = requireTimestamp(root.startedAtUtc, `${path}.startedAtUtc`);
  const completedAtUtc = requireTimestamp(root.completedAtUtc, `${path}.completedAtUtc`);
  const totalMs = requireNumber(root.totalMs, `${path}.totalMs`);
  const records = requireNumber(root.records, `${path}.records`);
  const recordsPerSec = requireNumber(root.recordsPerSec, `${path}.recordsPerSec`);
  if (!Array.isArray(root.timeline)) fail(`${path}.timeline must be an array.`);

  const timeline = root.timeline.map((entry, index) => parseTimelineEntry(entry, `${path}.timeline[${index}]`));

  // Every field below is a producer fact that may legitimately be absent
  // (skipped cycles never reach the seal/write/advance stages; a cycle that
  // faults before a stat is computed never sets it). None fall back to a
  // success-shaped default — they are omitted entirely when not present.
  const users = optionalNumber(root.users, `${path}.users`);
  const cursorLagSec = optionalNumber(root.cursorLagSec, `${path}.cursorLagSec`);
  const kustoMs = optionalNumber(root.kustoMs, `${path}.kustoMs`);
  const mapMs = optionalNumber(root.mapMs, `${path}.mapMs`);
  const writeMs = optionalNumber(root.writeMs, `${path}.writeMs`);
  const advanceMs = optionalNumber(root.advanceMs, `${path}.advanceMs`);
  const writeInteractionsRu = optionalNumber(root.writeInteractionsRu, `${path}.writeInteractionsRu`);
  const failingStage = optionalString(root.failingStage, `${path}.failingStage`);
  const error = optionalString(root.error, `${path}.error`);

  return {
    type: 'cycle',
    ts,
    runId,
    source,
    outcome,
    startedAtUtc,
    completedAtUtc,
    totalMs,
    records,
    recordsPerSec,
    timeline,
    ...(users !== undefined ? { users } : {}),
    ...(cursorLagSec !== undefined ? { cursorLagSec } : {}),
    ...(kustoMs !== undefined ? { kustoMs } : {}),
    ...(mapMs !== undefined ? { mapMs } : {}),
    ...(writeMs !== undefined ? { writeMs } : {}),
    ...(advanceMs !== undefined ? { advanceMs } : {}),
    ...(writeInteractionsRu !== undefined ? { writeInteractionsRu } : {}),
    ...(failingStage !== undefined ? { failingStage } : {}),
    ...(error !== undefined ? { error } : {}),
    facts: root,
  };
}

export type PollLineResult = { ok: true; event: PollEvent } | { ok: false; warning: PollParseWarning };

/**
 * Parses one JSONL line into a `stage` or `cycle` event. Never throws: JSON
 * errors, unknown `type` values, and invalid/missing required fields are all
 * reported as a warning result so a caller (batch or incremental) can keep
 * reading subsequent lines.
 */
export function parsePollLine(raw: string, line: number): PollLineResult {
  const trimmed = raw.trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, warning: { line, message: `line ${line}: invalid JSON.`, raw } };
  }

  try {
    if (!isRecord(value)) fail('event must be an object.');

    const path = `line ${line}`;
    const type = value.type;
    if (type === 'stage') return { ok: true, event: parseStageEvent(value, path) };
    if (type === 'cycle') return { ok: true, event: parseCycleEvent(value, path) };

    const label = typeof type === 'string' ? `"${type}"` : 'missing';
    return { ok: false, warning: { line, message: `line ${line}: unknown event type ${label}.`, raw } };
  } catch (error) {
    // PollLineError messages already carry the `line N.field` path (see
    // `path` above); only the generic fallback needs a manual line prefix.
    const message = error instanceof PollLineError ? error.message : `line ${line}: invalid event.`;
    return { ok: false, warning: { line, message, raw } };
  }
}

/**
 * Parses a full poll JSONL document. Malformed JSON, unknown record types,
 * and records that fail required-field validation are collected as warnings;
 * every other valid line is still parsed and returned. Blank lines are
 * skipped silently (not warned).
 */
export function parsePollJsonlText(text: string): PollParseResult {
  const events: PollEvent[] = [];
  const warnings: PollParseWarning[] = [];

  text.split(/\r?\n/).forEach((rawLine, index) => {
    if (rawLine.trim().length === 0) return;

    const result = parsePollLine(rawLine, index + 1);
    if (result.ok) {
      events.push(result.event);
    } else {
      warnings.push(result.warning);
    }
  });

  return { events, warnings };
}
