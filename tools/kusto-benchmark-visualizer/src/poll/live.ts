/**
 * Pure helpers for detecting a minimal rewrite of a live-tailed file.
 *
 * A `File` snapshot from the File System Access API only exposes `size`
 * (and `lastModified`), not an identity/inode we can compare across polls.
 * Comparing `size` alone against the previously committed read offset is not
 * enough: a truncate-then-rewrite that regrows past the old offset before
 * the next poll tick looks identical to a normal append (`file.size` is
 * simply larger than the offset), so the bytes actually read would be a mix
 * of new content spliced onto a byte offset that no longer corresponds to
 * anything the previous session wrote.
 *
 * To catch this without re-reading (and re-decoding) the whole file on every
 * tick, we retain a small "anchor" — the last `LIVE_ANCHOR_BYTES` bytes
 * immediately before the committed read offset — and require it to still be
 * present, unchanged, at the same byte range on every subsequent snapshot
 * before trusting anything read beyond the offset. If the anchor no longer
 * matches (or the file is now shorter than the offset, or the anchor range
 * could not be read consistently), the file identity at that offset is no
 * longer trustworthy and the caller must restart from byte zero.
 */

/** Number of bytes retained immediately before the committed read offset. */
export const LIVE_ANCHOR_BYTES = 16;

/** The anchor before any bytes have been read: there is nothing to check yet. */
export const EMPTY_LIVE_ANCHOR: Uint8Array = new Uint8Array(0);

export interface LiveAnchorRange {
  /** Byte offset (inclusive) where the anchor range starts. */
  readonly start: number;
  /** Number of bytes in the anchor range; less than `anchorBytes` only when `priorOffset` is small. */
  readonly length: number;
}

/**
 * The byte range that must be re-read on the next snapshot to verify the
 * anchor: the up-to-`anchorBytes` bytes immediately before `priorOffset`.
 * Clamped to the start of the file, so a `priorOffset` smaller than
 * `anchorBytes` yields a shorter range starting at byte zero.
 */
export function liveAnchorRange(priorOffset: number, anchorBytes: number = LIVE_ANCHOR_BYTES): LiveAnchorRange {
  const start = Math.max(0, priorOffset - anchorBytes);
  return { start, length: priorOffset - start };
}

/** Byte-for-byte equality; two empty arrays are equal (there is nothing to compare). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Derives the next anchor after successfully committing a read of `appended`
 * bytes (the bytes from the old offset up to the new one). The anchor is
 * always the last `anchorBytes` bytes immediately before the new offset: if
 * `appended` alone is long enough it fully replaces the previous anchor,
 * otherwise the tail of the previous anchor is carried over to fill it out.
 */
export function nextAnchor(
  previousAnchor: Uint8Array,
  appended: Uint8Array,
  anchorBytes: number = LIVE_ANCHOR_BYTES,
): Uint8Array {
  if (appended.length >= anchorBytes) return appended.slice(appended.length - anchorBytes);

  const needed = anchorBytes - appended.length;
  const carriedOver = previousAnchor.slice(Math.max(0, previousAnchor.length - needed));
  const combined = new Uint8Array(carriedOver.length + appended.length);
  combined.set(carriedOver, 0);
  combined.set(appended, carriedOver.length);
  return combined;
}

export interface LiveReadDecisionInput {
  /** The read offset committed by the previous successful tick. */
  readonly priorOffset: number;
  /** The anchor retained from the previous successful tick. */
  readonly priorAnchor: Uint8Array;
  /** `size` of the current `File` snapshot. */
  readonly fileSize: number;
  /**
   * The bytes at `liveAnchorRange(priorOffset)` read from the *current*
   * snapshot, or `null` if that range could not be read consistently (e.g.
   * the read failed, or returned fewer bytes than the range implies).
   */
  readonly currentAnchorBytes: Uint8Array | null;
}

export type LiveReadDecision =
  /** File is exactly as it was; nothing to read. */
  | { readonly kind: 'unchanged' }
  /**
   * The bytes before `priorOffset` no longer match (or could not be
   * verified), or the file is now shorter than `priorOffset`. The caller
   * must discard all session state and re-ingest the file from byte zero.
   */
  | { readonly kind: 'reset' }
  /** The anchor still matches and the file has grown; new bytes start at `priorOffset`. */
  | { readonly kind: 'append' };

/**
 * Decides how to react to a new `File` snapshot given the offset/anchor
 * committed by the previous tick. Pure and File-API-free: the caller is
 * responsible for reading `currentAnchorBytes` from `liveAnchorRange` and for
 * carrying out whatever the decision implies.
 */
export function decideLiveReadStep(input: LiveReadDecisionInput): LiveReadDecision {
  const { priorOffset, priorAnchor, fileSize, currentAnchorBytes } = input;

  // The file shrank below the offset we already committed reads up to — it
  // was truncated (at least) and cannot possibly still hold the bytes we
  // previously read.
  if (fileSize < priorOffset) return { kind: 'reset' };

  // Once anything has been read, the bytes immediately before that point
  // must still be present and unchanged for the offset to remain meaningful
  // — this is what catches a truncate-then-rewrite that regrew past the old
  // offset before being observed, which `fileSize` alone cannot distinguish
  // from a normal append.
  if (priorOffset > 0 && (!currentAnchorBytes || !bytesEqual(priorAnchor, currentAnchorBytes))) {
    return { kind: 'reset' };
  }

  if (fileSize === priorOffset) return { kind: 'unchanged' };

  return { kind: 'append' };
}
