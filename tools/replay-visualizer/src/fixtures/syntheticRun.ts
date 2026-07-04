import type { RawRun } from '../loader/raw';

/**
 * A tiny, hand-authored synthetic run with predictable values, used by the pure-logic tests.
 * Two sessions: one emits an event (sources 11 & 12), one is drained (acknowledge, source 13).
 * Sequence 14 is a Skipped (unmapped) message; 15 stays Pending (blocks the checkpoint).
 */
export function syntheticRun(): RawRun {
  return {
    partitionId: '1',
    enhanced: false,
    messages: {
      count: 5,
      messages: [
        msg(11, 'Pending', 's-aaaa', 'BladeFullReady', 'open'),
        msg(12, 'Pending', 's-aaaa', 'BladeFullReady', 'close'),
        msg(13, 'Pending', 's-bbbb', 'FrameworkNoise', 'mark'),
        skipped(14),
        msg(15, 'Pending', 's-cccc', 'BladeFullReady', 'open'),
      ],
    },
    composed: [
      {
        sessionId: 's-aaaa',
        count: 1,
        events: [
          {
            kind: 'Emit',
            seal: 'Idle',
            lastActivityUtc: '2026-06-26T17:52:16.500+00:00',
            sourceCount: 2,
            sources: ['1/11', '1/12'],
            document: {
              id: 'bi:s-aaaa:b:abc:2026',
              type: 'BladeInteraction',
              bladeName: 'Extension/Foo/Blade/BarView',
              dwellMs: 187,
              dwellSource: 'estimated',
              perf: { timeToSettledMs: 1699 },
              sealedReason: 'idle',
            },
          },
        ],
      },
      {
        sessionId: 'unknown-session',
        count: 1,
        events: [
          {
            kind: 'Acknowledge',
            seal: 'Idle',
            lastActivityUtc: '2026-06-26T17:52:17.000+00:00',
            sourceCount: 1,
            sources: ['1/13'],
            document: null,
          },
        ],
      },
    ],
    flush: {
      summary: {
        eventsWritten: 1,
        eventsFailed: 0,
        acknowledged: 1,
        messagesMarkedDone: 3,
        checkpointSequenceNumber: 14,
      },
      markedDone: { count: 3, messages: [] },
      written: {
        count: 1,
        events: [{ eventType: 'BladeInteraction', document: { id: 'bi:s-aaaa:b:abc:2026' } }],
      },
    },
  };
}

function msg(
  seq: number,
  status: 'Pending' | 'Done' | 'Skipped',
  sessionId: string,
  action: string,
  actionModifier: string,
) {
  return {
    partitionId: '1',
    sequenceNumber: seq,
    status,
    enqueuedTimeUtc: '2026-06-28T04:29:09.398+00:00',
    record: {
      sessionId,
      eventType: null,
      timestampUtc: '2026-06-26T17:54:27.641+00:00',
      payload: {
        action,
        actionModifier,
        context: `{"Blade":{"id":"Extension/Foo/Blade/BarView","instanceId":"Blade_${sessionId}_${seq}"}}`,
      },
    },
  };
}

function skipped(seq: number) {
  return {
    partitionId: '1',
    sequenceNumber: seq,
    status: 'Skipped' as const,
    skipReason: 'unmapped',
    enqueuedTimeUtc: '2026-06-28T04:29:09.398+00:00',
    record: null,
  };
}
