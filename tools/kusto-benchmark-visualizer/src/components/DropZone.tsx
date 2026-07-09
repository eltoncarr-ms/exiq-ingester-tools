import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { parseBenchmarkFileText, parseBenchmarkRunHeaderText, parseBenchmarkRunManifestText, parseLatestBenchmarkIterationJsonlText, BenchmarkLoadError } from '../benchmark/parse';
import type { BenchmarkArtifact, BenchmarkIteration, BenchmarkSummaryArtifact, RunMetadata, TimingMetrics } from '../benchmark/types';

export interface BenchmarkFileHandle {
  name: string;
  kind?: 'file';
  getFile: () => Promise<File>;
}

export interface BenchmarkDirectoryHandle {
  name: string;
  kind?: 'directory';
  values: () => AsyncIterable<BenchmarkFileHandle | BenchmarkDirectoryHandle>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<BenchmarkFileHandle[]>;
    showDirectoryPicker?: () => Promise<BenchmarkDirectoryHandle>;
  }
}

interface BrowserFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface BrowserFileSystemFileEntry extends BrowserFileSystemEntry {
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
}

interface FileSystemDirectoryReader {
  readEntries: (success: (entries: BrowserFileSystemEntry[]) => void, failure?: (error: DOMException) => void) => void;
}

interface BrowserFileSystemDirectoryEntry extends BrowserFileSystemEntry {
  createReader: () => FileSystemDirectoryReader;
}

type DataTransferItemWithEntry = {
  webkitGetAsEntry?: () => BrowserFileSystemEntry | null;
};

export type ParsedArtifact =
  | {
      kind: 'run';
      artifact: BenchmarkArtifact;
      sourceName: string;
      watchHandle?: BenchmarkFileHandle;
      watchKey?: string;
    }
  | {
      kind: 'summary';
      artifact: BenchmarkSummaryArtifact;
      sourceName: string;
      watchHandle?: BenchmarkFileHandle;
      watchKey?: string;
    };

interface DropZoneProps {
  onArtifacts: (artifacts: ParsedArtifact[]) => void;
}

export interface BenchmarkInputFile {
  name: string;
  path: string;
  text: () => Promise<string>;
  headText?: (bytes: number) => Promise<string>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function directoryName(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

function runDirectoryFor(path: string): string {
  const directory = directoryName(path);
  const normalized = normalizePath(directory);
  const marker = '/iterations';
  const markerIndex = normalized.lastIndexOf(marker);
  return markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized;
}

function toInputFile(file: File, path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name): BenchmarkInputFile {
  return {
    name: file.name,
    path: normalizePath(path || file.name),
    text: () => file.text(),
    headText: (bytes) => file.slice(0, bytes).text(),
  };
}

function zeroTimings(): TimingMetrics {
  return {
    leaseAcquire: 0,
    pollKusto: 0,
    messageStoreSetup: 0,
    rehydrateMessageState: 0,
    processMessagesToEvents: 0,
    flush: 0,
    advanceCheckpoint: 0,
    total: 0,
  };
}

function summarizeIterations(iterations: BenchmarkIteration[]) {
  const total = (selector: (iteration: BenchmarkIteration) => number) => iterations.reduce((sum, iteration) => sum + selector(iteration), 0);
  const durationMs =
    iterations.length === 0
      ? 0
      : Math.max(0, Date.parse(iterations.at(-1)!.completedAtUtc) - Date.parse(iterations[0].startedAtUtc));
  const eventsFinalized = total((iteration) => iteration.counts.eventsFinalized);
  const averageTiming = (key: keyof TimingMetrics) =>
    iterations.length === 0 ? 0 : iterations.reduce((sum, iteration) => sum + (iteration.timingsMs[key] as number), 0) / iterations.length;

  return {
    iterationCount: iterations.length,
    rowsFetched: total((iteration) => iteration.counts.rowsFetched),
    messagesProcessed: total((iteration) => iteration.counts.messagesProcessed),
    eventsFinalized,
    flushDocuments: total((iteration) => iteration.counts.flushDocuments),
    fullFlushes: total((iteration) => iteration.counts.fullFlushes),
    partialFlushes: total((iteration) => iteration.counts.partialFlushes),
    checkpointAdvancements: total((iteration) => iteration.counts.checkpointAdvancements),
    durationMs,
    throughputEventsPerSecond: durationMs > 0 ? eventsFinalized / (durationMs / 1000) : 0,
    averageTimingsMs: iterations.length > 0
      ? {
          leaseAcquire: averageTiming('leaseAcquire'),
          pollKusto: averageTiming('pollKusto'),
          messageStoreSetup: averageTiming('messageStoreSetup'),
          rehydrateMessageState: averageTiming('rehydrateMessageState'),
          processMessagesToEvents: averageTiming('processMessagesToEvents'),
          flush: averageTiming('flush'),
          advanceCheckpoint: averageTiming('advanceCheckpoint'),
          total: averageTiming('total'),
        }
      : zeroTimings(),
    averageBacklogMessages: iterations.length === 0 ? 0 : total((iteration) => iteration.counts.backlogMessages) / iterations.length,
    maxBacklogMessages: iterations.reduce((max, iteration) => Math.max(max, iteration.counts.backlogMessages), 0),
    blockedDurationMs: total((iteration) => iteration.checkpoint.blockedDurationMs),
  };
}

function baseName(path: string): string {
  const normalized = normalizePath(path);
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

function inferRunId(iterations: BenchmarkIteration[], runDirectory: string): string {
  const first = iterations[0];
  if (first) {
    const marker = `-${first.shardId}-`;
    const markerIndex = first.iterationId.indexOf(marker);
    if (markerIndex > 0) {
      return first.iterationId.slice(0, markerIndex);
    }
  }

  const directoryName = baseName(runDirectory);
  return directoryName && directoryName !== 'iterations' ? directoryName : 'jsonl-iterations';
}

function synthesizeRunArtifact(runDirectory: string, iterations: BenchmarkIteration[]): BenchmarkArtifact {
  const sortedIterations = latestIterations(iterations);
  const first = sortedIterations[0];
  const last = sortedIterations.at(-1);
  const runId = inferRunId(sortedIterations, runDirectory);
  const label = baseName(runDirectory) === 'iterations' ? runId : baseName(directoryName(runDirectory)) || baseName(runDirectory) || runId;

  return {
    schemaVersion: 1,
    run: {
      runId,
      label,
      source: 'Kusto',
      startedAtUtc: first?.startedAtUtc ?? new Date(0).toISOString(),
      completedAtUtc: last?.completedAtUtc ?? first?.completedAtUtc ?? new Date(0).toISOString(),
      clientId: first?.clientId ?? 'jsonl',
      clientCount: 1,
      partitionScope: first ? `${new Set(sortedIterations.map((iteration) => iteration.shardId)).size} shard(s)` : 'jsonl',
      configuration: {},
    },
    iterations: sortedIterations,
    memorySamples: [],
    summary: summarizeIterations(sortedIterations),
  };
}

async function readSplitRunManifest(file: BenchmarkInputFile, iterations: BenchmarkIteration[]): Promise<BenchmarkArtifact> {
  const header = parseBenchmarkRunHeaderText(await (file.headText?.(1024 * 1024) ?? file.text()), file.path);
  const sortedIterations = latestIterations(iterations);
  const run: RunMetadata = {
    ...header.run,
    completedAtUtc: sortedIterations.at(-1)?.completedAtUtc ?? header.run.completedAtUtc,
  };

  return {
    schemaVersion: 1,
    run,
    iterations: sortedIterations,
    memorySamples: [],
    summary: summarizeIterations(sortedIterations),
  };
}

function latestIterations(iterations: BenchmarkIteration[]): BenchmarkIteration[] {
  const byId = new Map<string, BenchmarkIteration>();
  for (const iteration of iterations) {
    byId.set(iteration.iterationId, iteration);
  }

  return [...byId.values()].sort((left, right) =>
    left.startedAtUtc.localeCompare(right.startedAtUtc) || left.iterationId.localeCompare(right.iterationId));
}

export async function readBenchmarkInputFiles(files: BenchmarkInputFile[]): Promise<ParsedArtifact[]> {
  const runs: Array<{ artifact: BenchmarkArtifact; sourceName: string; runDirectory: string }> = [];
  const summaries: ParsedArtifact[] = [];
  const iterationsByRunDirectory = new Map<string, BenchmarkIteration[]>();
  const failures: string[] = [];
  const jsonlRunDirectories = new Set(
    files
      .filter((file) => file.name.toLowerCase().endsWith('.jsonl'))
      .map((file) => runDirectoryFor(file.path)),
  );

  const orderedFiles = [...files].sort((left, right) => {
    const leftJsonl = left.name.toLowerCase().endsWith('.jsonl');
    const rightJsonl = right.name.toLowerCase().endsWith('.jsonl');
    return leftJsonl === rightJsonl ? left.path.localeCompare(right.path) : leftJsonl ? -1 : 1;
  });

  for (const file of orderedFiles) {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.json') && !lowerName.endsWith('.jsonl')) continue;

    try {
      if (lowerName.endsWith('.jsonl')) {
        const iteration = parseLatestBenchmarkIterationJsonlText(await file.text(), file.path);
        if (!iteration) continue;
        const runDirectory = runDirectoryFor(file.path);
        iterationsByRunDirectory.set(runDirectory, [...(iterationsByRunDirectory.get(runDirectory) ?? []), iteration]);
        continue;
      }

      const runDirectory = directoryName(file.path);
      const splitIterations = iterationsByRunDirectory.get(runDirectory);
      const parsed =
        lowerName === 'kusto-benchmark-run.json' && jsonlRunDirectories.has(runDirectory) && splitIterations
          ? { kind: 'run' as const, artifact: await readSplitRunManifest(file, splitIterations) }
          : lowerName === 'kusto-benchmark-run.json' && jsonlRunDirectories.has(runDirectory)
            ? { kind: 'run' as const, artifact: parseBenchmarkRunManifestText(await file.text(), file.path) }
            : parseBenchmarkFileText(await file.text(), file.path);
      if (parsed.kind === 'run') {
        runs.push({ artifact: parsed.artifact, sourceName: file.name, runDirectory });
      } else {
        summaries.push({ kind: 'summary', artifact: parsed.artifact, sourceName: file.name });
      }

    } catch (error) {
      failures.push(error instanceof BenchmarkLoadError ? error.message : `${file.path}: failed to load.`);
    }
  }

  const artifacts: ParsedArtifact[] = [
    ...runs.map((run) => {
      const matchingIterations =
        iterationsByRunDirectory.get(run.runDirectory) ??
        (runs.length === 1 && iterationsByRunDirectory.size === 1 ? [...iterationsByRunDirectory.values()][0] : []);
      const artifact =
        run.artifact.iterations.length === 0 && matchingIterations.length > 0
          ? { ...run.artifact, iterations: latestIterations(matchingIterations) }
          : run.artifact;
      return { kind: 'run' as const, artifact, sourceName: run.sourceName };
    }),
    ...[...iterationsByRunDirectory.entries()]
      .filter(([runDirectory]) => !runs.some((run) => run.runDirectory === runDirectory))
      .map(([runDirectory, iterations]) => ({
        kind: 'run' as const,
        artifact: synthesizeRunArtifact(runDirectory, iterations),
        sourceName: `${baseName(runDirectory) || 'iterations'}.jsonl`,
      })),
    ...summaries,
  ];

  if (artifacts.length === 0 && failures.length === 0) {
    throw new BenchmarkLoadError('No JSON benchmark artifacts were found.');
  }

  if (failures.length > 0) {
    throw new BenchmarkLoadError(failures.join(' '));
  }

  return artifacts;
}

async function readEntry(entry: BrowserFileSystemEntry, prefix = ''): Promise<BenchmarkInputFile[]> {
  const path = normalizePath(`${prefix}/${entry.name}`);
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as BrowserFileSystemFileEntry).file(resolve, reject);
    });
    return [toInputFile(file, path)];
  }

  if (!entry.isDirectory) return [];

  const reader = (entry as BrowserFileSystemDirectoryEntry).createReader();
  const children: BrowserFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<BrowserFileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }

  const nested = await Promise.all(children.map((child) => readEntry(child, path)));
  return nested.flat();
}

export async function readBenchmarkDataTransfer(dataTransfer: DataTransfer): Promise<BenchmarkInputFile[]> {
  const itemEntries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.())
    .filter((entry): entry is BrowserFileSystemEntry => Boolean(entry));
  if (itemEntries.length > 0) {
    const files = await Promise.all(itemEntries.map((entry) => readEntry(entry)));
    return files.flat();
  }

  return Array.from(dataTransfer.files).map((file) => toInputFile(file));
}

async function inputFilesFromDirectoryHandle(handle: BenchmarkDirectoryHandle, prefix = handle.name): Promise<BenchmarkInputFile[]> {
  const files: BenchmarkInputFile[] = [];
  for await (const child of handle.values()) {
    const path = normalizePath(`${prefix}/${child.name}`);
    if (child.kind === 'directory' || ('values' in child && typeof child.values === 'function')) {
      files.push(...await inputFilesFromDirectoryHandle(child as BenchmarkDirectoryHandle, path));
    } else {
      const file = await (child as BenchmarkFileHandle).getFile();
      files.push(toInputFile(file, path));
    }
  }

  return files;
}

export async function readBenchmarkDirectoryHandle(handle: BenchmarkDirectoryHandle): Promise<ParsedArtifact[]> {
  return readBenchmarkInputFiles(await inputFilesFromDirectoryHandle(handle));
}

export async function readBenchmarkFileHandles(handles: BenchmarkFileHandle[]): Promise<ParsedArtifact[]> {
  const artifacts: ParsedArtifact[] = [];
  const failures: string[] = [];

  for (const [index, handle] of handles.entries()) {
    try {
      const file = await handle.getFile();
      const parsed = parseBenchmarkFileText(await file.text(), handle.name);
      const watchKey = `live:${handle.name}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${index}`}`;
      if (parsed.kind === 'run') {
        artifacts.push({ kind: 'run', artifact: parsed.artifact, sourceName: handle.name, watchHandle: handle, watchKey });
      } else {
        artifacts.push({ kind: 'summary', artifact: parsed.artifact, sourceName: handle.name, watchHandle: handle, watchKey });
      }
    } catch (error) {
      failures.push(error instanceof BenchmarkLoadError ? error.message : `${handle.name}: failed to load.`);
    }
  }

  if (failures.length > 0) {
    throw new BenchmarkLoadError(failures.join(' '));
  }

  return artifacts;
}

export function DropZone({ onArtifacts }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: BenchmarkInputFile[]) => {
      setBusy(true);
      setError(null);
      try {
        const artifacts = await readBenchmarkInputFiles(files);
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
      await handleFiles(Array.from(event.target.files).map((file) => toInputFile(file)));
      event.target.value = '';
    },
    [handleFiles],
  );

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      if (event.dataTransfer.files.length === 0 && event.dataTransfer.items.length === 0) return;
      await handleFiles(await readBenchmarkDataTransfer(event.dataTransfer));
    },
    [handleFiles],
  );

  return (
    <div className="dropzone">
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
        <div className="dropzone__title">{busy ? 'Loading…' : 'Drop benchmark JSON here'}</div>
        <div className="dropzone__hint">Drop a run folder, an iterations folder, or JSON/JSONL files</div>
        <input ref={inputRef} className="dropzone__input" type="file" accept=".json,.jsonl,application/json,application/x-ndjson" multiple onChange={onPick} />
      </div>
      {error && (
        <div className="dropzone__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
