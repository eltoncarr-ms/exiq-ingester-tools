import type { RawOccurrence, RawRun } from '../loader/raw';
import { messageLabel, parseBladeRef } from './parseContext';
import type {
  Disposition,
  MessageStatus,
  ReplayGroup,
  ReplayMessage,
  ReplayModel,
  ReplayOccurrence,
  ReplayStep,
  StepPhase,
} from './types';

const UNKNOWN_SESSION = 'unknown-session';

/** Parses a "partition/sequence" source ref into its sequence number. */
export function parseSourceSeq(ref: string): number {
  const slash = ref.lastIndexOf('/');
  const seqText = slash >= 0 ? ref.slice(slash + 1) : ref;
  return Number.parseInt(seqText, 10);
}

/** Milliseconds for a message's browser-event time, or undefined when absent/unparsable. */
function messageTimeMs(m: ReplayMessage): number | undefined {
  if (!m.timestampUtc) return undefined;
  const t = Date.parse(m.timestampUtc);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Orders messages by browser-event time ascending for rendering. Event Hub sequence numbers are not
 * a reliable proxy for user-activity order — the publisher does not guarantee chronological enqueue
 * order — so the store grid and load animation sort on the record timestamp. Messages with no/equal
 * timestamp tie-break on seq; timestamp-less messages sort last. This is render-only ordering; the
 * checkpoint frontier is computed from a seq-sorted view in the reducer.
 */
export function compareChronological(a: ReplayMessage, b: ReplayMessage): number {
  const ta = messageTimeMs(a);
  const tb = messageTimeMs(b);
  if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
  if (ta === undefined && tb !== undefined) return 1;
  if (ta !== undefined && tb === undefined) return -1;
  return a.seq - b.seq;
}

function readString(doc: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const v = doc?.[key];
  return typeof v === 'string' ? v : undefined;
}

function readNumber(doc: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const v = doc?.[key];
  return typeof v === 'number' ? v : undefined;
}

function toOccurrence(sessionId: string, index: number, raw: RawOccurrence): ReplayOccurrence {
  const doc = raw.document ?? null;
  const perfRaw = doc?.['perf'];
  const perf =
    perfRaw && typeof perfRaw === 'object' ? (perfRaw as Record<string, number>) : null;
  return {
    id: `${sessionId}:${index}`,
    sessionId,
    kind: raw.kind,
    sources: raw.sources.map(parseSourceSeq).filter((n) => Number.isFinite(n)),
    lastActivityUtc: raw.lastActivityUtc,
    eventId: readString(doc, 'id'),
    eventType: readString(doc, 'type'),
    bladeName: readString(doc, 'bladeName'),
    dwellMs: readNumber(doc, 'dwellMs'),
    dwellSource: readString(doc, 'dwellSource'),
    sealedReason: readString(doc, 'sealedReason') ?? null,
    perf,
    document: doc,
  };
}

function compareOccurrences(a: ReplayOccurrence, b: ReplayOccurrence): number {
  if (a.lastActivityUtc !== b.lastActivityUtc) {
    return a.lastActivityUtc < b.lastActivityUtc ? -1 : 1;
  }
  if (a.sessionId !== b.sessionId) {
    return a.sessionId < b.sessionId ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Builds the deterministic, UI-facing replay model from parsed run artifacts. */
export function buildReplay(run: RawRun): ReplayModel {
  // --- Occurrences (ordered) ---
  const occurrences: ReplayOccurrence[] = [];
  for (const file of run.composed) {
    file.events.forEach((ev, i) => occurrences.push(toOccurrence(file.sessionId, i, ev)));
  }
  occurrences.sort(compareOccurrences);

  const emitSources = new Set<number>();
  const ackSources = new Set<number>();
  for (const occ of occurrences) {
    const target = occ.kind === 'Emit' ? emitSources : ackSources;
    for (const seq of occ.sources) {
      target.add(seq);
    }
  }

  // --- Authoritative disposition map (enhanced) ---
  const dispositionBySeq = new Map<number, Disposition>();
  for (const m of run.finalMessages?.messages ?? []) {
    if (m.disposition) {
      dispositionBySeq.set(m.sequenceNumber, m.disposition as Disposition);
    }
  }

  // The flush layer records the authoritative set of messages it marked Done (02-flush.json
  // markedDone). In legacy dumps this is the only complete record of terminal disposition — the
  // composed occurrences only cover emits and the *captured* acknowledge sources, which undercount
  // the true acknowledged/residual set. Honoring this set is what lets the replayed checkpoint
  // advance faithfully to its real final value.
  const markedDoneSeqs = run.flush.markedDone.messages.map((m) => m.sequenceNumber);
  const markedDoneSet = new Set<number>(markedDoneSeqs);

  const deriveDisposition = (seq: number, status: MessageStatus): Disposition => {
    const authoritative = dispositionBySeq.get(seq);
    if (authoritative) {
      return authoritative;
    }
    if (emitSources.has(seq)) return 'emitted';
    if (ackSources.has(seq)) return 'acknowledged';
    if (status === 'Skipped') return 'skipped';
    // Marked done by the flush layer but with no occurrence evidence: drained without an emitted
    // event. Legacy dumps can't distinguish explicit-ack from residual-drain, so we label it
    // residual-drain rather than leaving it (incorrectly) pending.
    if (markedDoneSet.has(seq)) return 'residual-drain';
    return 'pending';
  };

  // --- Messages (ordered chronologically by browser-event time for rendering) ---
  const messages: ReplayMessage[] = run.messages.messages
    .map((m) => {
      const sessionId = m.record?.sessionId ?? UNKNOWN_SESSION;
      const blade = parseBladeRef(m.record?.payload);
      const loadedStatus = m.status as MessageStatus;
      return {
        seq: m.sequenceNumber,
        sessionId,
        label: messageLabel(m.record),
        loadedStatus,
        disposition: deriveDisposition(m.sequenceNumber, loadedStatus),
        bladeId: blade.id,
        bladeInstanceId: blade.instanceId,
        timestampUtc: m.record?.timestampUtc ?? undefined,
        enqueuedTimeUtc: m.enqueuedTimeUtc,
        payload: m.record?.payload ?? null,
        eventType: m.record?.eventType ?? null,
      } satisfies ReplayMessage;
    })
    .sort(compareChronological);

  const messageBySeq = new Map<number, ReplayMessage>(messages.map((m) => [m.seq, m]));
  // Sequence extents are derived independently of render order (messages are now time-sorted).
  const orderedSeqs = messages.map((m) => m.seq);
  const minSeq = orderedSeqs.length ? orderedSeqs.reduce((a, b) => Math.min(a, b)) : 0;
  const maxSeq = orderedSeqs.length ? orderedSeqs.reduce((a, b) => Math.max(a, b)) : 0;

  // --- Groups (authoritative when present, else derived like PendingSessionGroups) ---
  let groups: ReplayGroup[];
  if (run.sessionGroups?.groups?.length) {
    groups = run.sessionGroups.groups
      .map((g) => ({
        sessionId: g.sessionId,
        memberSeqs: [...g.memberSequences].sort((a, b) => a - b),
        authoritative: true,
      }))
      .sort((a, b) => (a.memberSeqs[0] ?? 0) - (b.memberSeqs[0] ?? 0));
  } else {
    const bySession = new Map<string, number[]>();
    for (const m of messages) {
      // Mirror PendingSessionGroups: only successfully-parsed, pending messages form groups.
      if (m.loadedStatus !== 'Pending' || m.label === '(unmapped)') continue;
      if (m.sessionId === UNKNOWN_SESSION) continue;
      const list = bySession.get(m.sessionId) ?? [];
      list.push(m.seq);
      bySession.set(m.sessionId, list);
    }
    groups = [...bySession.entries()]
      .map(([sessionId, seqs]) => ({
        sessionId,
        memberSeqs: seqs.sort((a, b) => a - b),
        authoritative: false,
      }))
      .sort((a, b) => (a.memberSeqs[0] ?? 0) - (b.memberSeqs[0] ?? 0));
  }

  // --- Checkpoint anchors & sequence range ---
  const startingCheckpoint = run.runMeta?.startingCheckpoint ?? minSeq - 1;
  const finalCheckpoint =
    run.runMeta?.finalCheckpoint ?? run.flush.summary.checkpointSequenceNumber ?? maxSeq;
  const sequenceRange = run.runMeta?.sequenceRange ?? { min: minSeq, max: maxSeq };

  // --- Steps ---
  const steps: ReplayStep[] = [];
  let index = 0;
  const phaseOffsets: Record<StepPhase, { start: number; count: number }> = {
    load: { start: 0, count: 0 },
    group: { start: 0, count: 0 },
    compose: { start: 0, count: 0 },
    flush: { start: 0, count: 0 },
  };

  phaseOffsets.load.start = index;
  // Loading is animated as a few bulk fills rather than one step per message: a long partition
  // (hundreds of messages) should populate the grid in at most MAX_LOAD_STEPS visible chunks.
  const MAX_LOAD_STEPS = 4;
  const loadSeqs = messages.map((m) => m.seq);
  if (loadSeqs.length > 0) {
    const batchCount = Math.min(MAX_LOAD_STEPS, loadSeqs.length);
    const batchSize = Math.ceil(loadSeqs.length / batchCount);
    for (let start = 0; start < loadSeqs.length; start += batchSize) {
      const batch = loadSeqs.slice(start, start + batchSize);
      // Batches fill in chronological order, so report an ascending seq span for readability.
      const lo = batch.reduce((a, b) => Math.min(a, b));
      const hi = batch.reduce((a, b) => Math.max(a, b));
      const range = batch.length === 1 ? `${lo}` : `${lo}–${hi}`;
      steps.push({
        index: index++,
        phase: 'load',
        seqs: batch,
        description: `Load ${batch.length} message${batch.length === 1 ? '' : 's'} into the store (${range})`,
      });
    }
  }
  phaseOffsets.load.count = index - phaseOffsets.load.start;

  phaseOffsets.group.start = index;
  for (const g of groups) {
    steps.push({
      index: index++,
      phase: 'group',
      sessionId: g.sessionId,
      description: `Form session group ${g.sessionId.slice(0, 8)} (${g.memberSeqs.length} pending msgs)`,
    });
  }
  phaseOffsets.group.count = index - phaseOffsets.group.start;

  phaseOffsets.compose.start = index;
  for (const occ of occurrences) {
    const what =
      occ.kind === 'Emit'
        ? `${occ.eventType ?? 'event'} ${occ.bladeName ? `· ${shortBlade(occ.bladeName)}` : ''}`
        : `acknowledge drain (${occ.sources.length} msgs)`;
    steps.push({
      index: index++,
      phase: 'compose',
      occurrenceId: occ.id,
      description: `Compose ${occ.kind}: ${what} from ${occ.sources.length} source(s)`,
    });
  }
  phaseOffsets.compose.count = index - phaseOffsets.compose.start;

  phaseOffsets.flush.start = index;
  for (const occ of occurrences) {
    const description =
      occ.kind === 'Emit'
        ? `Flush → Cosmos: ${occ.eventType ?? 'event'}${occ.bladeName ? ` · ${shortBlade(occ.bladeName)}` : ''}; mark ${occ.sources.length} done`
        : `Drain ${occ.sources.length} message(s) (no output); mark done`;
    steps.push({ index: index++, phase: 'flush', occurrenceId: occ.id, description });
  }
  // Terminal reconciliation: the engine marked `markedDoneSeqs` Done as a flush-level outcome. The
  // per-occurrence steps above only account for messages we have occurrence evidence for; the
  // remaining done-set is what lets the checkpoint frontier advance to its true value. Rather than
  // applying it all at once (a single jump that lights up every cell), animate the checkpoint sweep
  // in a few chunks so the message store and the checkpoint slider progress in sync — mirroring how
  // the loader fills the grid in bounded batches. A final resting step settles with the checkpoint
  // at its terminal value and nothing highlighted, so the replay never ends on an all-highlighted
  // frame. Omitted entirely when the dump carries no markedDone roster (e.g. minimal fixtures).
  if (markedDoneSeqs.length > 0) {
    const orderedAsc = messages.map((m) => m.seq).sort((a, b) => a - b);
    const skippedSet = new Set(messages.filter((m) => m.loadedStatus === 'Skipped').map((m) => m.seq));
    const isTerminal = (seq: number): boolean => markedDoneSet.has(seq) || skippedSet.has(seq);
    // The contiguous run of terminal messages above the starting checkpoint — the band the frontier
    // will sweep. A Pending gap stops it (engine-faithful, mirrors computeCheckpoint).
    const advancePath: number[] = [];
    for (const seq of orderedAsc) {
      if (seq <= startingCheckpoint) continue;
      if (isTerminal(seq)) advancePath.push(seq);
      else break;
    }

    if (advancePath.length === 0) {
      // Nothing for the frontier to cross; still apply the done-set in one reconciling step.
      steps.push({
        index: index++,
        phase: 'flush',
        finalizes: true,
        markDoneSeqs: markedDoneSeqs,
        checkpointTo: finalCheckpoint,
        description: `Flush complete — ${markedDoneSeqs.length} message(s) marked done`,
      });
    } else {
      const MAX_CHECKPOINT_STEPS = 6;
      const chunkCount = Math.min(MAX_CHECKPOINT_STEPS, advancePath.length);
      const chunkSize = Math.ceil(advancePath.length / chunkCount);
      for (let start = 0; start < advancePath.length; start += chunkSize) {
        const chunk = advancePath.slice(start, start + chunkSize);
        const frontier = chunk[chunk.length - 1];
        steps.push({
          index: index++,
          phase: 'flush',
          finalizes: true,
          // Only markedDone seqs need marking; Skipped ones are already terminal from the load step.
          markDoneSeqs: chunk.filter((s) => markedDoneSet.has(s)),
          checkpointTo: frontier,
          description: `Checkpoint advancing → ${frontier} (${chunk.length} message(s) cleared)`,
        });
      }
      const settledCheckpoint = advancePath[advancePath.length - 1];
      steps.push({
        index: index++,
        phase: 'flush',
        finalizes: true,
        // Apply the full done-set so any messages the flush marked Done beyond a Pending gap (not on
        // the swept advance path) are still coloured Done. The checkpoint cap is unchanged and the
        // frontier is already here, so this step's swept band — and thus its highlight — is empty.
        markDoneSeqs: markedDoneSeqs,
        checkpointTo: settledCheckpoint,
        description: `Flush complete — ${markedDoneSeqs.length} message(s) marked done; checkpoint at ${settledCheckpoint}`,
      });
    }
  }
  phaseOffsets.flush.count = index - phaseOffsets.flush.start;

  return {
    partitionId: run.partitionId,
    enhanced: run.enhanced,
    startingCheckpoint,
    finalCheckpoint,
    sequenceRange,
    messages,
    messageBySeq,
    groups,
    occurrences,
    steps,
    phaseOffsets,
    markedDoneSeqs,
    flushSummary: {
      eventsWritten: run.flush.summary.eventsWritten,
      eventsFailed: run.flush.summary.eventsFailed,
      acknowledged: run.flush.summary.acknowledged,
      messagesMarkedDone: run.flush.summary.messagesMarkedDone,
    },
  };
}

function shortBlade(bladeName: string): string {
  const parts = bladeName.split('/');
  return parts[parts.length - 1] ?? bladeName;
}
