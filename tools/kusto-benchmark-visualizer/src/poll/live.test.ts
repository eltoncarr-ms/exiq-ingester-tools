import { describe, expect, it } from 'vitest';
import {
  bytesEqual,
  decideLiveReadStep,
  EMPTY_LIVE_ANCHOR,
  LIVE_ANCHOR_BYTES,
  liveAnchorRange,
  nextAnchor,
} from './live';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('bytesEqual', () => {
  it('treats two empty arrays as equal', () => {
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('is false for different lengths', () => {
    expect(bytesEqual(bytesOf('abc'), bytesOf('ab'))).toBe(false);
  });

  it('is false when any byte differs', () => {
    expect(bytesEqual(bytesOf('abc'), bytesOf('abd'))).toBe(false);
  });

  it('is true for identical content', () => {
    expect(bytesEqual(bytesOf('abc'), bytesOf('abc'))).toBe(true);
  });
});

describe('liveAnchorRange', () => {
  it('clamps to byte zero when the offset is smaller than the anchor size', () => {
    expect(liveAnchorRange(5, 16)).toEqual({ start: 0, length: 5 });
  });

  it('is empty at offset zero', () => {
    expect(liveAnchorRange(0, 16)).toEqual({ start: 0, length: 0 });
  });

  it('is a fixed-size window once the offset exceeds the anchor size', () => {
    expect(liveAnchorRange(100, 16)).toEqual({ start: 84, length: 16 });
  });
});

describe('nextAnchor', () => {
  it('is fully replaced by appended bytes at least as long as the anchor size', () => {
    const appended = bytesOf('0123456789abcdef-extra');
    const anchor = nextAnchor(EMPTY_LIVE_ANCHOR, appended, 16);
    expect(anchor).toEqual(appended.slice(appended.length - 16));
  });

  it('carries over the tail of the previous anchor when appended bytes are shorter than the anchor size', () => {
    const previous = bytesOf('0123456789abcdef');
    const appended = bytesOf('XYZ');
    const anchor = nextAnchor(previous, appended, 16);
    // Last 13 bytes of `previous` + all of `appended` = 16 bytes.
    expect(anchor).toEqual(bytesOf('3456789abcdefXYZ'));
  });

  it('handles a previous anchor shorter than needed (e.g. right after the first read)', () => {
    const previous = bytesOf('ab');
    const appended = bytesOf('cd');
    const anchor = nextAnchor(previous, appended, 16);
    expect(anchor).toEqual(bytesOf('abcd'));
  });
});

describe('decideLiveReadStep', () => {
  const anchor = bytesOf('0123456789abcdef');

  it('appends when the anchor still matches and the file grew (normal append)', () => {
    const decision = decideLiveReadStep({
      priorOffset: 100,
      priorAnchor: anchor,
      fileSize: 140,
      currentAnchorBytes: anchor,
    });
    expect(decision).toEqual({ kind: 'append' });
  });

  it('resets when the file is now shorter than the previously committed offset (size shrink)', () => {
    const decision = decideLiveReadStep({
      priorOffset: 100,
      priorAnchor: anchor,
      fileSize: 40,
      currentAnchorBytes: null,
    });
    expect(decision).toEqual({ kind: 'reset' });
  });

  it('resets when the file grew past the old offset but the anchor bytes changed (truncate+regrow)', () => {
    const rewritten = bytesOf('ZZZZZZZZZZZZZZZZ');
    const decision = decideLiveReadStep({
      priorOffset: 100,
      priorAnchor: anchor,
      fileSize: 140,
      currentAnchorBytes: rewritten,
    });
    expect(decision).toEqual({ kind: 'reset' });
  });

  it('does not reset when the file is unchanged (same size, matching anchor)', () => {
    const decision = decideLiveReadStep({
      priorOffset: 100,
      priorAnchor: anchor,
      fileSize: 100,
      currentAnchorBytes: anchor,
    });
    expect(decision).toEqual({ kind: 'unchanged' });
  });

  it('resets when the anchor range could not be read consistently', () => {
    const decision = decideLiveReadStep({
      priorOffset: 100,
      priorAnchor: anchor,
      fileSize: 140,
      currentAnchorBytes: null,
    });
    expect(decision).toEqual({ kind: 'reset' });
  });

  it('never resets on the very first read, before any offset has been committed', () => {
    const decision = decideLiveReadStep({
      priorOffset: 0,
      priorAnchor: EMPTY_LIVE_ANCHOR,
      fileSize: 50,
      currentAnchorBytes: EMPTY_LIVE_ANCHOR,
    });
    expect(decision).toEqual({ kind: 'append' });
  });

  it('uses LIVE_ANCHOR_BYTES as the default anchor size for callers', () => {
    expect(LIVE_ANCHOR_BYTES).toBeGreaterThan(0);
  });
});
