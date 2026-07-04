import type {
  RawComposedFile,
  RawFinalMessagesFile,
  RawFlushFile,
  RawMessagesFile,
  RawRun,
  RawRunMeta,
  RawSessionGroupsFile,
} from './raw';

/** A flat name->text map of the files discovered in a run directory (relative paths, forward slashes). */
export type RunFileMap = Map<string, string>;

export class RunLoadError extends Error {
  constructor(
    message: string,
    readonly artifact?: string,
  ) {
    super(message);
    this.name = 'RunLoadError';
  }
}

const RECOGNIZED_SCHEMA_VERSIONS = new Set<number>([1]);

function normalizeKey(path: string): string {
  // Keep only the trailing portion after the run directory; lower-case for matching.
  return path.replace(/\\/g, '/').toLowerCase();
}

function findFile(files: RunFileMap, predicate: (key: string) => boolean): string | undefined {
  for (const [key, value] of files) {
    if (predicate(normalizeKey(key))) {
      return value;
    }
  }
  return undefined;
}

function findAll(files: RunFileMap, predicate: (key: string) => boolean): string[] {
  const out: string[] = [];
  for (const [key, value] of files) {
    if (predicate(normalizeKey(key))) {
      out.push(value);
    }
  }
  return out;
}

function parseJson<T>(text: string, artifact: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new RunLoadError(
      `Artifact "${artifact}" is present but is not valid JSON: ${(err as Error).message}`,
      artifact,
    );
  }
}

/**
 * Builds a {@link RawRun} from a discovered set of run-directory files. Required artifacts
 * (00-messages, at least one 01-composed/*, 02-flush) must be present and valid or a
 * {@link RunLoadError} is thrown. Enhanced artifacts (run-meta, 01-session-groups,
 * 03-final-messages) are optional: missing ones degrade to legacy mode; a present-but-corrupt
 * enhanced artifact is a hard, labeled error.
 */
export function buildRawRun(files: RunFileMap): RawRun {
  const messagesText = findFile(files, (k) => k.endsWith('00-messages.json'));
  if (!messagesText) {
    throw new RunLoadError('Required artifact "00-messages.json" was not found in the dropped folder.', '00-messages.json');
  }
  const composedTexts = findAll(files, (k) => k.includes('01-composed/') && k.endsWith('.json'));
  if (composedTexts.length === 0) {
    throw new RunLoadError('Required artifact directory "01-composed/" had no JSON files.', '01-composed');
  }
  const flushText = findFile(files, (k) => k.endsWith('02-flush.json'));
  if (!flushText) {
    throw new RunLoadError('Required artifact "02-flush.json" was not found in the dropped folder.', '02-flush.json');
  }

  const messages = parseJson<RawMessagesFile>(messagesText, '00-messages.json');
  const composed = composedTexts.map((t, i) => parseJson<RawComposedFile>(t, `01-composed[${i}]`));
  const flush = parseJson<RawFlushFile>(flushText, '02-flush.json');

  // Enhanced (optional). Present-but-corrupt => throw; missing => undefined.
  const runMetaText = findFile(files, (k) => k.endsWith('run-meta.json'));
  const sessionGroupsText = findFile(files, (k) => k.endsWith('01-session-groups.json'));
  const finalMessagesText = findFile(files, (k) => k.endsWith('03-final-messages.json'));

  let runMeta: RawRunMeta | undefined;
  let enhanced = false;
  if (runMetaText) {
    runMeta = parseJson<RawRunMeta>(runMetaText, 'run-meta.json');
    const version = runMeta.dumpSchemaVersion ?? 0;
    enhanced = RECOGNIZED_SCHEMA_VERSIONS.has(version);
  }

  const sessionGroups = sessionGroupsText
    ? parseJson<RawSessionGroupsFile>(sessionGroupsText, '01-session-groups.json')
    : undefined;
  const finalMessages = finalMessagesText
    ? parseJson<RawFinalMessagesFile>(finalMessagesText, '03-final-messages.json')
    : undefined;

  const partitionId =
    runMeta?.partitionId ??
    messages.messages[0]?.partitionId ??
    'unknown';

  return {
    partitionId,
    messages,
    composed,
    flush,
    runMeta,
    sessionGroups,
    finalMessages,
    enhanced,
  };
}

/**
 * Reads a dropped directory entry (DataTransferItem.webkitGetAsEntry) recursively into a
 * {@link RunFileMap}. Browser-only; uses the File System Access entry API.
 */
export async function readDroppedEntry(entry: FileSystemEntry): Promise<RunFileMap> {
  const files: RunFileMap = new Map();
  await walkEntry(entry, entry.name, files);
  return files;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: RunFileMap): Promise<void> {
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    if (file.name.toLowerCase().endsWith('.json')) {
      out.set(prefix, await file.text());
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await readAllEntries(reader);
    for (const child of entries) {
      await walkEntry(child, `${prefix}/${child.name}`, out);
    }
  }
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Reads a flat FileList (from <input webkitdirectory>) into a {@link RunFileMap}. */
export async function readFileList(list: FileList): Promise<RunFileMap> {
  const files: RunFileMap = new Map();
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (rel.toLowerCase().endsWith('.json')) {
      files.set(rel, await file.text());
    }
  }
  return files;
}
