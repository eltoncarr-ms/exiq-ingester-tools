/**
 * Pure incremental NDJSON decoder for the poll telemetry stream. Consumers
 * (static file loads chunked for large files, or a live File System Access
 * API poll) feed arbitrary text chunks in order; a chunk boundary may split a
 * line anywhere, including mid-JSON-value. The decoder never mutates its
 * input, holds no hidden state, and is deterministic for a given
 * (state, chunk) pair, so it is trivial to unit test and to run inside a
 * component without re-parsing bytes that were already emitted.
 */
import { parsePollLine } from './parse';
import type { PollEvent, PollParseWarning } from './types';

/** Carried state between chunks: the partial trailing line and next line number. */
export interface PollTailState {
  /** Text after the last complete line boundary seen so far; may be empty. */
  readonly carry: string;
  /** The 1-based absolute line number that will be assigned to the next complete line. */
  readonly nextLine: number;
}

/** The decoder starts with no carry and line numbering beginning at 1. */
export const INITIAL_POLL_TAIL_STATE: PollTailState = { carry: '', nextLine: 1 };

export interface PollTailStepResult {
  /** The decoder state to pass into the next `pushPollTailChunk`/`flushPollTail` call. */
  state: PollTailState;
  /** Events parsed from lines completed by this step, in stream order. */
  events: PollEvent[];
  /** Warnings for lines that failed to parse, in stream order. */
  warnings: PollParseWarning[];
}

/**
 * Feeds one text chunk into the decoder. Every complete (newline-terminated)
 * line accumulated since the last call — including any carry retained from a
 * line split across chunk boundaries — is parsed exactly once via
 * `parsePollLine`. Any trailing partial line (no terminating newline yet) is
 * retained in the returned state's `carry` and is not parsed, so it is never
 * duplicated once the rest of it arrives in a later chunk.
 */
export function pushPollTailChunk(state: PollTailState, chunk: string): PollTailStepResult {
  const events: PollEvent[] = [];
  const warnings: PollParseWarning[] = [];

  const combined = state.carry + chunk;
  const parts = combined.split(/\r?\n/);
  // split() always yields at least one element; the last element is the new
  // carry — it is '' when `combined` ended with a newline, or the partial
  // trailing line otherwise.
  const carry = parts.pop() ?? '';

  let nextLine = state.nextLine;
  for (const rawLine of parts) {
    const lineNumber = nextLine;
    nextLine += 1;
    if (rawLine.trim().length === 0) continue;

    const result = parsePollLine(rawLine, lineNumber);
    if (result.ok) {
      events.push(result.event);
    } else {
      warnings.push(result.warning);
    }
  }

  return { state: { carry, nextLine }, events, warnings };
}

/**
 * Flushes any carry retained from the final chunk (e.g. when a static file
 * load or a live poll's underlying stream ends without a trailing newline).
 * The carry is parsed as one final line via `parsePollLine`, producing either
 * an event or a warning; a blank or empty carry produces neither. Safe to
 * call more than once — after flushing, the carry is cleared.
 */
export function flushPollTail(state: PollTailState): PollTailStepResult {
  if (state.carry.trim().length === 0) {
    return { state: { carry: '', nextLine: state.nextLine }, events: [], warnings: [] };
  }

  const lineNumber = state.nextLine;
  const result = parsePollLine(state.carry, lineNumber);
  const events: PollEvent[] = [];
  const warnings: PollParseWarning[] = [];

  if (result.ok) {
    events.push(result.event);
  } else {
    warnings.push(result.warning);
  }

  return { state: { carry: '', nextLine: lineNumber + 1 }, events, warnings };
}
