import type { CosmosDoc, MessageStatus, ReplayModel, ReplayState } from './types';

/**
 * Computes the checkpoint frontier: the highest sequence number such that every loaded message from
 * the starting checkpoint up to it is terminal (Done or Skipped) with no Pending gap. Engine-faithful
 * mirror of CheckpointAdvanceCalculator: Skipped does not block; a Pending or not-yet-loaded message
 * stops advancement. Never regresses below the starting checkpoint.
 */
export function computeCheckpoint(
  orderedSeqs: number[],
  status: Map<number, MessageStatus>,
  startingCheckpoint: number,
): number {
  let frontier = startingCheckpoint;
  for (const seq of orderedSeqs) {
    if (seq <= startingCheckpoint) {
      continue;
    }
    const st = status.get(seq);
    if (st === 'Done' || st === 'Skipped') {
      frontier = seq;
    } else {
      break;
    }
  }
  return frontier;
}

/**
 * Folds the model's steps from 0..stepIndex (inclusive) into a full visual state. Pure and
 * deterministic: calling with the same arguments always yields the same state, which is what makes
 * scrubbing and step-back possible. stepIndex of -1 yields the initial (pre-load) state.
 */
export function reduceToStep(model: ReplayModel, stepIndex: number): ReplayState {
  // The checkpoint frontier walk requires ascending sequence order; model.messages is sorted by
  // event time for rendering, so derive an independent seq-sorted view here.
  const orderedSeqs = model.messages.map((m) => m.seq).sort((a, b) => a - b);
  const loadedSeqs = new Set<number>();
  const status = new Map<number, MessageStatus>();
  const formedGroups = new Set<string>();
  const composedOccurrenceIds = new Set<string>();
  const cosmosDocs: CosmosDoc[] = [];
  const drainedOccurrenceIds = new Set<string>();
  let drainedCount = 0;
  let checkpoint = model.startingCheckpoint;
  let highlightSeqs = new Set<number>();
  let description = 'Ready — drop a run folder or load the bundled sample.';
  let activePhase: ReplayState['activePhase'] = 'idle';

  const clamped = Math.min(stepIndex, model.steps.length - 1);

  for (let i = 0; i <= clamped; i++) {
    const step = model.steps[i];
    const stepHighlights = new Set<number>();
    switch (step.phase) {
      case 'load': {
        for (const seq of step.seqs ?? []) {
          const msg = model.messageBySeq.get(seq);
          loadedSeqs.add(seq);
          status.set(seq, msg?.loadedStatus ?? 'Pending');
          stepHighlights.add(seq);
        }
        break;
      }
      case 'group': {
        formedGroups.add(step.sessionId!);
        const group = model.groups.find((g) => g.sessionId === step.sessionId);
        group?.memberSeqs.forEach((s) => stepHighlights.add(s));
        break;
      }
      case 'compose': {
        composedOccurrenceIds.add(step.occurrenceId!);
        const occ = model.occurrences.find((o) => o.id === step.occurrenceId);
        occ?.sources.forEach((s) => stepHighlights.add(s));
        break;
      }
      case 'flush': {
        if (step.finalizes) {
          // Apply this step's slice of the authoritative done-set, then advance the checkpoint —
          // but only as far as this step's cap, so the terminal sweep animates in chunks. Highlight
          // exactly the band the frontier crossed this step, keeping the message store and the
          // checkpoint slider in sync. The trailing resting step has an empty slice and an unchanged
          // cap, so it clears the highlight and settles without lighting up the whole grid.
          const prevCheckpoint = checkpoint;
          for (const s of step.markDoneSeqs ?? []) {
            if (status.get(s) !== 'Skipped') {
              status.set(s, 'Done');
            }
          }
          const computed = computeCheckpoint(orderedSeqs, status, model.startingCheckpoint);
          const capped = step.checkpointTo !== undefined ? Math.min(computed, step.checkpointTo) : computed;
          checkpoint = Math.max(prevCheckpoint, capped);
          for (const seq of orderedSeqs) {
            if (seq > prevCheckpoint && seq <= checkpoint) {
              stepHighlights.add(seq);
            }
          }
          break;
        }
        const occ = model.occurrences.find((o) => o.id === step.occurrenceId);
        if (occ) {
          for (const s of occ.sources) {
            status.set(s, 'Done');
            stepHighlights.add(s);
          }
          if (occ.kind === 'Emit') {
            cosmosDocs.push({
              id: occ.eventId ?? occ.id,
              eventType: occ.eventType ?? 'event',
              bladeName: occ.bladeName,
              occurrenceId: occ.id,
            });
          } else {
            drainedOccurrenceIds.add(occ.id);
            drainedCount += occ.sources.length;
          }
          checkpoint = computeCheckpoint(orderedSeqs, status, model.startingCheckpoint);
        }
        break;
      }
    }
    if (i === clamped) {
      highlightSeqs = stepHighlights;
      description = step.description;
      activePhase = step.phase;
    }
  }

  return {
    stepIndex: clamped,
    loadedSeqs,
    status,
    formedGroups,
    composedOccurrenceIds,
    cosmosDocs,
    drainedOccurrenceIds,
    drainedCount,
    checkpoint,
    highlightSeqs,
    activePhase,
    description,
  };
}
