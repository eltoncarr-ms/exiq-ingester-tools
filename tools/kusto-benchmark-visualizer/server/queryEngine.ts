/**
 * Pure HTTP handler for the loopback App Insights query server.
 *
 * This module is pure/injectable: it defines the AppInsightsQueryClient
 * interface and a handleRequest() function that depends on it, so tests
 * can provide a fake implementation without touching the Azure SDK.
 *
 * The only module that imports @azure/identity and @azure/monitor-query is
 * server/azureMonitorClient.ts — this file does NOT import either package.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RawCycleRow } from '../src/appinsights/types.js';

/** Query parameters accepted by the server — bounded dashboard parameters only. */
export interface QueryParams {
  /** Application role name to filter on. Non-empty string required. */
  appRoleNameFilter: string;
  /** Lookback window in hours. Bounded to [1, 168]. */
  lookbackHours: number;
}

/**
 * Injectable interface for the Azure Monitor query boundary.
 * The real implementation lives in azureMonitorClient.ts.
 * Tests provide a fake that never imports the Azure SDK.
 */
export interface AppInsightsQueryClient {
  queryCompletedCycles(params: QueryParams): Promise<RawCycleRow[]>;
}

/** Minimum allowed lookback hours. */
const MIN_LOOKBACK_HOURS = 1;
/** Maximum allowed lookback hours (7 days). */
const MAX_LOOKBACK_HOURS = 168;

// ── Error classification ──────────────────────────────────────────────────

export type ErrorKind =
  | 'notLoggedIn'
  | 'insufficientRbac'
  | 'tenantMismatch'
  | 'tokenExpiry'
  | 'throttling'
  | 'queryFailure'
  | 'badRequest'
  | 'notFound'
  | 'methodNotAllowed';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  httpStatus: number;
  retryAfterSeconds?: number;
}

/**
 * Classify a thrown error from the Azure Monitor query client into an
 * actionable, distinguishable error response. Each kind maps to a distinct
 * HTTP status code and human-readable message so the browser client can
 * display the right remediation hint.
 */
export function classifyQueryError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes('not logged') ||
    lower.includes('no account') ||
    lower.includes('az login') ||
    lower.includes('please run') ||
    lower.includes('credential') ||
    lower.includes('authentication failed') ||
    lower.includes('interactive authentication')
  ) {
    return {
      kind: 'notLoggedIn',
      httpStatus: 401,
      message:
        'Azure CLI is not logged in. Run "az login" and retry. ' +
        'If targeting a specific tenant, use "az login --tenant <tenantId>".',
    };
  }

  if (
    lower.includes('token has expired') ||
    lower.includes('token is expired') ||
    lower.includes('access token expired')
  ) {
    return {
      kind: 'tokenExpiry',
      httpStatus: 401,
      message: 'Azure CLI access token has expired. Run "az login" to refresh.',
    };
  }

  if (
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('authorization') ||
    lower.includes('access denied') ||
    lower.includes('does not have authorization')
  ) {
    return {
      kind: 'insufficientRbac',
      httpStatus: 403,
      message:
        'Insufficient RBAC permissions. The signed-in identity needs at least ' +
        '"Log Analytics Reader" on the workspace or "Monitoring Reader" on the App Insights resource.',
    };
  }

  if (lower.includes('tenant') && (lower.includes('mismatch') || lower.includes('different'))) {
    return {
      kind: 'tenantMismatch',
      httpStatus: 403,
      message:
        'Tenant mismatch. The signed-in CLI tenant does not match the workspace tenant. ' +
        'Use "az login --tenant <tenantId>" to log in to the correct tenant.',
    };
  }

  if (lower.includes('429') || lower.includes('throttl') || lower.includes('too many requests')) {
    return {
      kind: 'throttling',
      httpStatus: 429,
      message: 'Azure Monitor query throttled. Wait and retry.',
      retryAfterSeconds: 30,
    };
  }

  return {
    kind: 'queryFailure',
    httpStatus: 500,
    message: `Azure Monitor query failed: ${msg.slice(0, 300)}`,
  };
}

// ── Request body parsing ──────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function validateParams(body: unknown): { ok: true; params: QueryParams } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const obj = body as Record<string, unknown>;

  // Reject any attempt to pass arbitrary KQL
  if ('kql' in obj || 'query' in obj || 'kqlOverride' in obj) {
    return { ok: false, error: 'Arbitrary KQL text is not accepted. Provide bounded dashboard parameters only.' };
  }

  const appRoleNameFilter = obj['appRoleNameFilter'];
  if (typeof appRoleNameFilter !== 'string' || appRoleNameFilter.trim() === '') {
    return { ok: false, error: 'appRoleNameFilter must be a non-empty string.' };
  }

  const lookbackHours = obj['lookbackHours'];
  if (typeof lookbackHours !== 'number' || !Number.isFinite(lookbackHours)) {
    return { ok: false, error: 'lookbackHours must be a finite number.' };
  }
  if (lookbackHours < MIN_LOOKBACK_HOURS || lookbackHours > MAX_LOOKBACK_HOURS) {
    return {
      ok: false,
      error: `lookbackHours must be between ${MIN_LOOKBACK_HOURS} and ${MAX_LOOKBACK_HOURS}.`,
    };
  }

  return {
    ok: true,
    params: {
      appRoleNameFilter: appRoleNameFilter.trim(),
      lookbackHours,
    },
  };
}

// ── Response helpers ──────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // CORS: allow only loopback origins (browser dev server)
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Security: never cache query results
    'Cache-Control': 'no-store',
    // Loopback-only marker (informational)
    'X-Query-Server': 'loopback',
  });
  res.end(payload);
}

function sendError(res: ServerResponse, classified: ClassifiedError): void {
  const headers: Record<string, string> = {};
  if (classified.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(classified.retryAfterSeconds);
  }
  const payload = JSON.stringify({ error: classified.message, kind: classified.kind });
  res.writeHead(classified.httpStatus, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

// ── Main handler ──────────────────────────────────────────────────────────

/**
 * Handle one HTTP request. Pure and injectable — the Azure Monitor query
 * client is passed in so tests can use a fake without touching the SDK.
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: AppInsightsQueryClient,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url !== '/api/query') {
    sendError(res, { kind: 'notFound', httpStatus: 404, message: `Not found: ${url}` });
    return;
  }

  if (method !== 'POST') {
    sendError(res, { kind: 'methodNotAllowed', httpStatus: 405, message: 'Only POST is accepted on /api/query.' });
    return;
  }

  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    sendError(res, { kind: 'badRequest', httpStatus: 400, message: `Failed to read request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  let bodyParsed: unknown;
  try {
    bodyParsed = JSON.parse(bodyText);
  } catch {
    sendError(res, { kind: 'badRequest', httpStatus: 400, message: 'Request body is not valid JSON.' });
    return;
  }

  const validation = validateParams(bodyParsed);
  if (!validation.ok) {
    sendError(res, { kind: 'badRequest', httpStatus: 400, message: validation.error });
    return;
  }

  const { params } = validation;

  let rows: RawCycleRow[];
  try {
    rows = await client.queryCompletedCycles(params);
  } catch (err) {
    sendError(res, classifyQueryError(err));
    return;
  }

  sendJson(res, 200, rows);
}
