import { useCallback, useRef, useState } from 'react';
import { buildRawRun, readDroppedEntry, readFileList, RunLoadError } from '../loader/loadRun';
import type { RawRun } from '../loader/raw';

interface DropZoneProps {
  onRun: (run: RawRun) => void;
  hasRun: boolean;
}

const SAMPLE_FILES = [
  '00-messages.json',
  '02-flush.json',
  '01-composed/f8168bea2b6f4882b24caba26e1fb691.json',
  '01-composed/unknown-session.json',
  // Enhanced artifacts are fetched too when present; missing ones are ignored.
  'run-meta.json',
  '01-session-groups.json',
  '03-final-messages.json',
];

export function DropZone({ onRun, hasRun }: DropZoneProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleRun = useCallback(
    (run: RawRun) => {
      setError(null);
      onRun(run);
    },
    [onRun],
  );

  const tryBuild = useCallback(
    (files: Map<string, string>) => {
      try {
        handleRun(buildRawRun(files));
      } catch (err) {
        setError(err instanceof RunLoadError ? err.message : `Failed to load run: ${(err as Error).message}`);
      }
    },
    [handleRun],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      setBusy(true);
      try {
        const items = Array.from(e.dataTransfer.items);
        const files = new Map<string, string>();
        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            const sub = await readDroppedEntry(entry);
            sub.forEach((v, k) => files.set(k, v));
          }
        }
        if (files.size === 0) {
          // Fallback: plain files (no directory entry support).
          if (e.dataTransfer.files.length > 0) {
            const flat = await readFileList(e.dataTransfer.files);
            flat.forEach((v, k) => files.set(k, v));
          }
        }
        tryBuild(files);
      } finally {
        setBusy(false);
      }
    },
    [tryBuild],
  );

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      setBusy(true);
      try {
        const files = await readFileList(e.target.files);
        tryBuild(files);
      } finally {
        setBusy(false);
      }
    },
    [tryBuild],
  );

  const loadSample = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const files = new Map<string, string>();
      await Promise.all(
        SAMPLE_FILES.map(async (name) => {
          try {
            const res = await fetch(`./sample-run/${name}`);
            if (!res.ok) return;
            const body = await res.text();
            // A dev server SPA fallback answers missing files with index.html (HTTP 200).
            // Treat any HTML body as an absent artifact rather than a corrupt one.
            const contentType = res.headers.get('content-type') ?? '';
            if (contentType.includes('text/html') || /^\s*</.test(body)) return;
            files.set(name, body);
          } catch {
            /* optional artifact absent — ignore */
          }
        }),
      );
      tryBuild(files);
    } finally {
      setBusy(false);
    }
  }, [tryBuild]);

  return (
    <div className={`dropzone ${hasRun ? 'dropzone--compact' : ''}`}>
      <div
        className={`dropzone__target ${dragOver ? 'dropzone__target--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
      >
        <div className="dropzone__icon">⤓</div>
        <div className="dropzone__title">{busy ? 'Loading…' : 'Drop a run folder here'}</div>
        <div className="dropzone__hint">
          a <code>.debug-dumps/run-…</code> directory, or click to choose a folder
        </div>
        <input
          ref={inputRef}
          type="file"
          className="dropzone__input"
          // @ts-expect-error non-standard directory attributes
          webkitdirectory=""
          directory=""
          multiple
          onChange={onPick}
        />
      </div>
      <button className="btn btn--ghost" onClick={loadSample} disabled={busy}>
        Load bundled sample
      </button>
      {error && <div className="dropzone__error" role="alert">{error}</div>}
    </div>
  );
}
