import { useLayoutEffect, useRef, useState } from 'react';
import type { ReplayModel, ReplayState, MessageStatus, Disposition } from '../replay/types';

interface MessageStoreProps {
  model: ReplayModel;
  state: ReplayState;
  onSelect: (seq: number) => void;
  selectedSeq: number | null;
  pinnedSeqs: Set<number> | null;
}

const CELL = 20; // px, including gap
const ROW_OVERSCAN = 4;

/** Resolves the colour class for a "Done" cell based on how it terminated. */
function doneVariantClass(disposition: Disposition | undefined): string {
  // Explicit acknowledge-drain: vivid purple, mirrors the Acknowledge border in Composition.
  if (disposition === 'acknowledged') return 'cell--drained';
  // Residual/backstop drain (flush-layer inference, no occurrence evidence): muted indigo to set
  // it apart from an explicit ack while still reading as part of the drain family.
  if (disposition === 'residual-drain') return 'cell--residual';
  // Emitted (or anything else that reached Done): green, mirrors the flushed-to-Cosmos border.
  return 'cell--done';
}

function cellClass(
  loaded: boolean,
  status: MessageStatus | undefined,
  disposition: Disposition | undefined,
  highlighted: boolean,
  selected: boolean,
  pinned: boolean,
): string {
  const classes = ['cell'];
  if (!loaded) classes.push('cell--empty');
  else if (status === 'Done') classes.push(doneVariantClass(disposition));
  else classes.push(`cell--${(status ?? 'Pending').toLowerCase()}`);
  if (highlighted) classes.push('cell--hot');
  if (pinned) classes.push('cell--pinned');
  if (selected) classes.push('cell--selected');
  return classes.join(' ');
}

/**
 * Virtualized message-store grid. Only the rows in (or near) the viewport are rendered, so the
 * DOM node count stays bounded regardless of message volume.
 */
export function MessageStore({ model, state, onSelect, selectedSeq, pinnedSeqs }: MessageStoreProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(24);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(360);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setCols(Math.max(1, Math.floor(el.clientWidth / CELL)));
      setViewHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const messages = model.messages;
  const rowCount = Math.ceil(messages.length / cols);
  const totalHeight = rowCount * CELL;
  const startRow = Math.max(0, Math.floor(scrollTop / CELL) - ROW_OVERSCAN);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewHeight) / CELL) + ROW_OVERSCAN);

  const cells: JSX.Element[] = [];
  for (let row = startRow; row < endRow; row++) {
    for (let c = 0; c < cols; c++) {
      const i = row * cols + c;
      if (i >= messages.length) break;
      const m = messages[i];
      const loaded = state.loadedSeqs.has(m.seq);
      const status = state.status.get(m.seq);
      const hot = state.highlightSeqs.has(m.seq);
      const pinned = pinnedSeqs?.has(m.seq) ?? false;
      cells.push(
        <button
          key={m.seq}
          className={cellClass(loaded, status, m.disposition, hot, selectedSeq === m.seq, pinned)}
          style={{ position: 'absolute', top: row * CELL, left: c * CELL, width: CELL - 3, height: CELL - 3 }}
          title={`#${m.seq} · ${m.label} · ${loaded ? status : 'not loaded'}`}
          onClick={() => onSelect(m.seq)}
        />,
      );
    }
  }

  const counts = countStatuses(model, state);

  return (
    <section className="lane lane--store">
      <header className="lane__head">
        <h2>Message Store</h2>
        <div className="lane__meta">
          <span className="tag tag--pending">{counts.pending} pending</span>
          <span className="tag tag--done">{counts.done} done</span>
          <span className="tag tag--skipped">{counts.skipped} skipped</span>
          <span className="tag tag--muted">{state.loadedSeqs.size}/{messages.length} loaded</span>
        </div>
      </header>
      <div
        className="store__scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div className="store__canvas" style={{ height: totalHeight, position: 'relative' }}>
          {cells}
        </div>
      </div>
      <Legend />
    </section>
  );
}

function countStatuses(model: ReplayModel, state: ReplayState) {
  let pending = 0;
  let done = 0;
  let skipped = 0;
  for (const m of model.messages) {
    if (!state.loadedSeqs.has(m.seq)) continue;
    const s = state.status.get(m.seq);
    if (s === 'Done') done++;
    else if (s === 'Skipped') skipped++;
    else pending++;
  }
  return { pending, done, skipped };
}

function Legend(): JSX.Element {
  return (
    <div className="legend">
      <span><i className="swatch swatch--pending" /> pending</span>
      <span><i className="swatch swatch--done" /> emitted</span>
      <span><i className="swatch swatch--drained" /> acknowledged</span>
      <span><i className="swatch swatch--residual" /> residual drain</span>
      <span><i className="swatch swatch--skipped" /> skipped</span>
      <span><i className="swatch swatch--hot" /> active this step</span>
    </div>
  );
}
