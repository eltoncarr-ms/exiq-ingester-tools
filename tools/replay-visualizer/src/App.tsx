import { useMemo, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { DropZone } from './components/DropZone';
import { Transport } from './components/Transport';
import { MessageStore } from './components/MessageStore';
import { SessionGroups } from './components/SessionGroups';
import { Composition } from './components/Composition';
import { CosmosSink } from './components/CosmosSink';
import { CheckpointBar } from './components/CheckpointBar';
import { DetailPanel } from './components/DetailPanel';
import { useReplay } from './state/useReplay';
import type { RawRun } from './loader/raw';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(GridLayout);

const LAYOUT_KEY = 'replay.layout.v1';

const DEFAULT_LAYOUT: Layout[] = [
  { i: 'store', x: 0, y: 0, w: 8, h: 5, minW: 3, minH: 3 },
  { i: 'groups', x: 8, y: 0, w: 4, h: 5, minW: 2, minH: 3 },
  { i: 'composition', x: 0, y: 5, w: 6, h: 6, minW: 3, minH: 3 },
  { i: 'cosmos', x: 6, y: 5, w: 6, h: 6, minW: 3, minH: 3 },
  { i: 'checkpoint', x: 0, y: 11, w: 12, h: 2, minW: 4, minH: 2 },
];

function loadLayout(): Layout[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Layout[];
    // Guard against a stale layout missing a panel (e.g. after adding one).
    const ids = new Set(parsed.map((l) => l.i));
    if (DEFAULT_LAYOUT.every((d) => ids.has(d.i))) return parsed;
    return DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function App(): JSX.Element {
  const replay = useReplay();
  const { model, state } = replay;
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout[]>(() => loadLayout());

  const onRun = (run: RawRun) => {
    setSelectedSeq(null);
    setSelectedOccurrenceId(null);
    replay.setRun(run);
  };

  const selectSeq = (seq: number) => {
    setSelectedOccurrenceId(null);
    setSelectedSeq((prev) => (prev === seq ? null : seq));
  };
  const selectOcc = (id: string) => {
    setSelectedSeq(null);
    setSelectedOccurrenceId((prev) => (prev === id ? null : id));
  };

  // Source messages of the currently-selected occurrence — pinned-highlighted in the grid so you
  // can see exactly which messages an Emit/Acknowledge covers.
  const pinnedSeqs = useMemo(() => {
    if (!selectedOccurrenceId || !model) return null;
    const occ = model.occurrences.find((o) => o.id === selectedOccurrenceId);
    return occ ? new Set(occ.sources) : null;
  }, [selectedOccurrenceId, model]);

  const onLayoutChange = (next: Layout[]) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  };

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__logo">◧</span>
          <div>
            <div className="app__title">Ingestion Replay</div>
            <div className="app__sub">step-by-step debug-dump visualizer</div>
          </div>
        </div>
        {model && (
          <div className="app__runmeta">
            <span className="tag tag--muted">partition {model.partitionId}</span>
            <span className={`tag ${model.enhanced ? 'tag--ok' : 'tag--warn'}`}>
              {model.enhanced ? 'enhanced dump' : 'legacy dump'}
            </span>
            <span className="tag tag--muted">{model.messages.length} msgs</span>
            <span className="tag tag--muted">{model.occurrences.length} occurrences</span>
            <button className="btn btn--ghost btn--sm" onClick={resetLayout} title="Reset panel layout">
              ⟲ layout
            </button>
          </div>
        )}
      </header>

      {!model && (
        <main className="app__welcome">
          <DropZone onRun={onRun} hasRun={false} />
          <p className="app__welcome-note">
            Load an ExIQ ingester <code>run-…</code> dump to replay how the message store fills, session
            groups form, events compose, and documents flush to Cosmos while the checkpoint advances.
          </p>
        </main>
      )}

      {model && (
        <main className="app__main">
          <div className="app__stage">
            <Grid
              className="dash"
              layout={layout}
              cols={12}
              rowHeight={58}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              draggableHandle=".lane__head, .checkpoint__head"
              onLayoutChange={onLayoutChange}
              resizeHandles={['se', 'e', 's']}
              compactType="vertical"
            >
              <div key="store" className="panel">
                <MessageStore
                  model={model}
                  state={state}
                  onSelect={selectSeq}
                  selectedSeq={selectedSeq}
                  pinnedSeqs={pinnedSeqs}
                />
              </div>
              <div key="groups" className="panel">
                <SessionGroups model={model} state={state} />
              </div>
              <div key="composition" className="panel">
                <Composition
                  model={model}
                  state={state}
                  onSelectOccurrence={selectOcc}
                  selectedOccurrenceId={selectedOccurrenceId}
                />
              </div>
              <div key="cosmos" className="panel">
                <CosmosSink model={model} state={state} />
              </div>
              <div key="checkpoint" className="panel">
                <CheckpointBar model={model} state={state} />
              </div>
            </Grid>
          </div>

          <DetailPanel
            model={model}
            state={state}
            selectedSeq={selectedSeq}
            selectedOccurrenceId={selectedOccurrenceId}
            onClose={() => {
              setSelectedSeq(null);
              setSelectedOccurrenceId(null);
            }}
          />
        </main>
      )}

      {model && (
        <footer className="app__transport">
          <Transport
            model={model}
            state={state}
            stepIndex={replay.stepIndex}
            totalSteps={replay.totalSteps}
            playing={replay.playing}
            speed={replay.speed}
            onTogglePlay={replay.togglePlay}
            onStepBack={replay.stepBack}
            onStepForward={replay.stepForward}
            onSeek={replay.seek}
            onReset={replay.reset}
            onCycleSpeed={replay.cycleSpeed}
          />
          <div className="app__reload">
            <DropZone onRun={onRun} hasRun />
          </div>
        </footer>
      )}
    </div>
  );
}
