import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { parseBenchmarkFileText, BenchmarkLoadError } from '../benchmark/parse';
import type { BenchmarkArtifact, BenchmarkSummaryArtifact } from '../benchmark/types';

export type ParsedArtifact =
  | {
      kind: 'run';
      artifact: BenchmarkArtifact;
      sourceName: string;
    }
  | {
      kind: 'summary';
      artifact: BenchmarkSummaryArtifact;
      sourceName: string;
    };

interface DropZoneProps {
  compact?: boolean;
  onArtifacts: (artifacts: ParsedArtifact[]) => void;
  onLoadSamples: () => void;
}

async function readFiles(files: FileList | File[]): Promise<ParsedArtifact[]> {
  const artifacts: ParsedArtifact[] = [];
  const failures: string[] = [];

  for (const file of Array.from(files)) {
    if (!file.name.toLowerCase().endsWith('.json')) continue;

    try {
      const parsed = parseBenchmarkFileText(await file.text(), file.name);
      if (parsed.kind === 'run') {
        artifacts.push({ kind: 'run', artifact: parsed.artifact, sourceName: file.name });
      } else {
        artifacts.push({ kind: 'summary', artifact: parsed.artifact, sourceName: file.name });
      }
    } catch (error) {
      failures.push(error instanceof BenchmarkLoadError ? error.message : `${file.name}: failed to load.`);
    }
  }

  if (artifacts.length === 0 && failures.length === 0) {
    throw new BenchmarkLoadError('No JSON benchmark artifacts were found.');
  }

  if (failures.length > 0) {
    throw new BenchmarkLoadError(failures.join(' '));
  }

  return artifacts;
}

export function DropZone({ compact = false, onArtifacts, onLoadSamples }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true);
      setError(null);
      try {
        const artifacts = await readFiles(files);
        onArtifacts(artifacts);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Failed to load benchmark artifacts.');
      } finally {
        setBusy(false);
      }
    },
    [onArtifacts],
  );

  const onPick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;
      await handleFiles(event.target.files);
      event.target.value = '';
    },
    [handleFiles],
  );

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (event.dataTransfer.files.length === 0) return;
      await handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div className={`dropzone ${compact ? 'dropzone--compact' : ''}`}>
      <div
        className={`dropzone__target ${dragOver ? 'dropzone__target--over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="dropzone__icon">↧</div>
        <div className="dropzone__title">{busy ? 'Loading…' : compact ? 'Add artifact' : 'Drop benchmark JSON here'}</div>
        <div className="dropzone__hint">schemaVersion 1 artifact, or click to choose one or many files</div>
        <input ref={inputRef} className="dropzone__input" type="file" accept=".json,application/json" multiple onChange={onPick} />
      </div>
      <button className="btn btn--ghost" type="button" onClick={onLoadSamples} disabled={busy}>
        Load synthetic samples
      </button>
      {error && (
        <div className="dropzone__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
