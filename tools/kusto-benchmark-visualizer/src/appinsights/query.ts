/**
 * Three-mode loader for completed CursorPoll.Cycle rows.
 *
 * All modes converge on the same normalizeRows() path:
 *   (a) fixture — returns the checked-in SAMPLE_RAW_ROWS through normalize.
 *   (b) file    — parses a user-selected exported-query JSON File through normalize.
 *   (c) live    — fetches the loopback server response through normalize.
 *
 * The server returns raw PascalCase row objects (RawCycleRow[]) so the same
 * normalize path applies. The server is contacted via loopback only.
 */

import type { CompletedCycleRow, TabularQueryExport } from './types';
import { normalizeRows } from './normalize';
import { SAMPLE_RAW_ROWS } from './sample';

export interface LiveQueryParams {
  /** Application role name to filter on (e.g. "eiq-test-row-wus3-api-xnmmvm"). */
  appRoleNameFilter: string;
  /** Lookback window in hours (1–168). */
  lookbackHours: number;
}

export type QuerySource =
  | { kind: 'fixture' }
  | { kind: 'file'; file: File }
  | { kind: 'live'; port: number; params: LiveQueryParams };

/** Default loopback port for the query server. */
export const DEFAULT_QUERY_SERVER_PORT = 7432;

/**
 * Load completed CursorPoll.Cycle rows from the given source.
 * All paths normalize through normalizeRows() so React never sees raw shapes.
 *
 * @throws Error with a descriptive message on parse failure, unsupported shape,
 *   or live-transport error.
 */
export async function loadCompletedCycles(source: QuerySource): Promise<CompletedCycleRow[]> {
  switch (source.kind) {
    case 'fixture':
      return normalizeRows(SAMPLE_RAW_ROWS);

    case 'file': {
      const text = await source.file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `Failed to parse JSON from file "${source.file.name}". ` +
          'Expected a flat array of row objects (RawCycleRow[]) or an Azure Monitor ' +
          'tabular export ({ tables: [...] }).',
        );
      }
      return normalizeRows(parsed);
    }

    case 'live': {
      const { port, params } = source;
      const url = `http://127.0.0.1:${port}/api/query`;
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appRoleNameFilter: params.appRoleNameFilter,
            lookbackHours: params.lookbackHours,
          }),
        });
      } catch (err) {
        throw new Error(
          `Cannot reach the loopback query server at port ${port}. ` +
          'Start it with "npm run server" before using live mode. ' +
          `Details: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '(no body)');
        const serverError = tryParseServerError(body);
        throw new Error(
          `Query server returned ${resp.status}: ` +
          (serverError ?? body.slice(0, 300)),
        );
      }

      const json: unknown = await resp.json();

      // The server returns RawCycleRow[] or TabularQueryExport.
      return normalizeRows(json);
    }
  }
}

function tryParseServerError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const e = (parsed as Record<string, unknown>)['error'];
      if (typeof e === 'string') return e;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Parse a user-selected JSON file and return the raw parsed content.
 * Use to detect the shape before normalizing (for display in error messages).
 */
export async function parseExportedJson(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

/**
 * Type guard: checks if the value looks like a TabularQueryExport.
 * Useful for determining which shape a file has before calling normalizeRows.
 */
export function isTabularExport(value: unknown): value is TabularQueryExport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tables' in value &&
    Array.isArray((value as TabularQueryExport).tables)
  );
}
