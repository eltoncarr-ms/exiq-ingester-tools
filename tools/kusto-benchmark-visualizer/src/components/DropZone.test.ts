import { describe, expect, it } from 'vitest';
import { benchmarkFilesSignature, readBenchmarkInputFiles, type BenchmarkInputFile, type BenchmarkReadCache } from './DropZone';
import { SYNTHETIC_ARTIFACTS } from '../benchmark/sample';

function iterationLine(shardId: string): string {
  const base = SYNTHETIC_ARTIFACTS[0].iterations[0];
  return JSON.stringify({ ...base, shardId, iterationId: `${base.iterationId}-${shardId}` });
}

interface MockFile {
  file: BenchmarkInputFile;
  reads: () => number;
  usedTail: () => boolean;
}

function jsonlFile(path: string, line: string, lastModified: number): MockFile {
  const content = `${line}\n`;
  let reads = 0;
  let usedTail = false;
  return {
    reads: () => reads,
    usedTail: () => usedTail,
    file: {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      size: content.length,
      lastModified,
      text: async () => {
        reads += 1;
        return content;
      },
      tailText: async (bytes: number) => {
        reads += 1;
        usedTail = true;
        return content.slice(Math.max(0, content.length - bytes));
      },
    },
  };
}

describe('readBenchmarkInputFiles live caching', () => {
  it('reads jsonl via tail and reuses the cache for unchanged files', async () => {
    const cache: BenchmarkReadCache = new Map();
    const mock = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 1);

    const first = await readBenchmarkInputFiles([mock.file], cache);
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('run');
    expect(mock.reads()).toBe(1);
    expect(mock.usedTail()).toBe(true);

    const second = await readBenchmarkInputFiles([mock.file], cache);
    expect(second).toHaveLength(1);
    expect(mock.reads()).toBe(1);
  });

  it('re-reads only the files whose size or lastModified changed', async () => {
    const cache: BenchmarkReadCache = new Map();
    const stable = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 1);
    const changing = jsonlFile('run/iterations/shard-1.jsonl', iterationLine('shard-1'), 1);

    await readBenchmarkInputFiles([stable.file, changing.file], cache);
    expect(stable.reads()).toBe(1);
    expect(changing.reads()).toBe(1);

    const changed = jsonlFile('run/iterations/shard-1.jsonl', iterationLine('shard-1'), 2);
    await readBenchmarkInputFiles([stable.file, changed.file], cache);
    expect(stable.reads()).toBe(1);
    expect(changed.reads()).toBe(1);
  });

  it('prunes cache entries for files that disappear', async () => {
    const cache: BenchmarkReadCache = new Map();
    const removed = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 1);
    const kept = jsonlFile('run/iterations/shard-1.jsonl', iterationLine('shard-1'), 1);

    await readBenchmarkInputFiles([removed.file, kept.file], cache);
    expect(cache.has('run/iterations/shard-0.jsonl')).toBe(true);

    await readBenchmarkInputFiles([kept.file], cache);
    expect(cache.has('run/iterations/shard-0.jsonl')).toBe(false);
    expect(cache.has('run/iterations/shard-1.jsonl')).toBe(true);
  });

  it('produces a stable signature that changes when file metadata changes', () => {
    const first = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 1);
    const same = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 1);
    const changed = jsonlFile('run/iterations/shard-0.jsonl', iterationLine('shard-0'), 2);

    expect(benchmarkFilesSignature([first.file])).toBe(benchmarkFilesSignature([same.file]));
    expect(benchmarkFilesSignature([first.file])).not.toBe(benchmarkFilesSignature([changed.file]));
  });
});
