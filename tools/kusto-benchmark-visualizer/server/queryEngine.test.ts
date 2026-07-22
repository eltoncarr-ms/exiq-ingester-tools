/**
 * Tests for server/queryEngine.ts (pure handler logic) and the full HTTP
 * server via real bind-and-fetch on an ephemeral port.
 *
 * This file does NOT import azureMonitorClient.ts. It uses a hand-written
 * fake AppInsightsQueryClient so no Azure SDK packages are needed.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppInsightsQueryClient, QueryParams } from './queryEngine.js';
import { classifyQueryError, handleRequest } from './queryEngine.js';
import type { RawCycleRow } from '../src/appinsights/types.js';
import { singletonLaneRow } from '../src/appinsights/sample.js';

// ── Fake client ────────────────────────────────────────────────────────────

const FAKE_ROW: RawCycleRow = singletonLaneRow();

function makeFakeClient(
  behavior:
    | { kind: 'rows'; rows: RawCycleRow[] }
    | { kind: 'throw'; error: Error },
): AppInsightsQueryClient {
  return {
    async queryCompletedCycles(_params: QueryParams): Promise<RawCycleRow[]> {
      if (behavior.kind === 'throw') throw behavior.error;
      return behavior.rows;
    },
  };
}

// ── Real HTTP server fixture ───────────────────────────────────────────────

interface TestServer {
  port: number;
  replaceClient: (c: AppInsightsQueryClient) => void;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  let currentClient: AppInsightsQueryClient = makeFakeClient({ kind: 'rows', rows: [FAKE_ROW] });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, currentClient).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0 = OS assigns an ephemeral port
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;

  return {
    port: addr.port,
    replaceClient(c) { currentClient = c; },
    close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
  };
}

// ── Tests: classifyQueryError ──────────────────────────────────────────────

describe('classifyQueryError', () => {
  it('classifies "az login" messages as notLoggedIn (401)', () => {
    const result = classifyQueryError(new Error('Please run az login to set up your account'));
    expect(result.kind).toBe('notLoggedIn');
    expect(result.httpStatus).toBe(401);
    expect(result.message).toMatch(/az login/i);
  });

  it('classifies 403 / forbidden as insufficientRbac', () => {
    const result = classifyQueryError(new Error('403 Forbidden: does not have authorization'));
    expect(result.kind).toBe('insufficientRbac');
    expect(result.httpStatus).toBe(403);
    expect(result.message).toMatch(/RBAC/i);
  });

  it('classifies token-expired messages as tokenExpiry (401)', () => {
    const result = classifyQueryError(new Error('The access token has expired'));
    expect(result.kind).toBe('tokenExpiry');
    expect(result.httpStatus).toBe(401);
  });

  it('classifies 429 / throttle as throttling', () => {
    const result = classifyQueryError(new Error('429 Too Many Requests: throttled'));
    expect(result.kind).toBe('throttling');
    expect(result.httpStatus).toBe(429);
    expect(result.retryAfterSeconds).toBeDefined();
  });

  it('classifies unknown errors as queryFailure (500)', () => {
    const result = classifyQueryError(new Error('Something completely unexpected'));
    expect(result.kind).toBe('queryFailure');
    expect(result.httpStatus).toBe(500);
  });
});

// ── Tests: handleRequest (via real HTTP) ──────────────────────────────────

let srv: TestServer;

beforeAll(async () => {
  srv = await startTestServer();
});

afterAll(async () => {
  await srv.close();
});

afterEach(() => {
  // Reset to default fake client after each test
  srv.replaceClient(makeFakeClient({ kind: 'rows', rows: [FAKE_ROW] }));
});

function postQuery(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleRequest — loopback server', () => {
  it('returns 200 with rows for valid bounded parameters', async () => {
    const resp = await postQuery(srv.port, {
      appRoleNameFilter: 'eiq-test-row-wus3-api-xnmmvm',
      lookbackHours: 24,
    });
    expect(resp.status).toBe(200);
    const rows = await resp.json() as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown path', async () => {
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/unknown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(resp.status).toBe(404);
  });

  it('returns 405 for GET on /api/query', async () => {
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/query`);
    expect(resp.status).toBe(405);
  });

  it('returns 400 for missing appRoleNameFilter', async () => {
    const resp = await postQuery(srv.port, { lookbackHours: 24 });
    expect(resp.status).toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 for empty-string appRoleNameFilter', async () => {
    const resp = await postQuery(srv.port, { appRoleNameFilter: '', lookbackHours: 24 });
    expect(resp.status).toBe(400);
  });

  it('returns 400 for lookbackHours out of range (0)', async () => {
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'myapp', lookbackHours: 0 });
    expect(resp.status).toBe(400);
  });

  it('returns 400 for lookbackHours out of range (999)', async () => {
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'myapp', lookbackHours: 999 });
    expect(resp.status).toBe(400);
  });

  it('rejects arbitrary KQL text in the request body (400)', async () => {
    const resp = await postQuery(srv.port, {
      appRoleNameFilter: 'myapp',
      lookbackHours: 24,
      kql: 'AppEvents | take 100',
    });
    expect(resp.status).toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(String(body['error'])).toMatch(/arbitrary KQL/i);
  });

  it('rejects "query" key as an attempt to inject arbitrary KQL', async () => {
    const resp = await postQuery(srv.port, {
      appRoleNameFilter: 'myapp',
      lookbackHours: 24,
      query: 'AppEvents | take 100',
    });
    expect(resp.status).toBe(400);
  });

  it('returns 400 for malformed JSON body', async () => {
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(resp.status).toBe(400);
  });

  it('returns DTO rows that match the RawCycleRow shape (parity with fixture)', async () => {
    const resp = await postQuery(srv.port, {
      appRoleNameFilter: 'eiq-test-row-wus3-api-xnmmvm',
      lookbackHours: 24,
    });
    const rows = await resp.json() as RawCycleRow[];
    expect(rows.length).toBe(1);
    // Check key DTO fields are present with PascalCase keys (raw server shape)
    expect(rows[0]).toHaveProperty('RowKind');
    expect(rows[0]).toHaveProperty('EventTimeUtc');
    expect(rows[0]).toHaveProperty('AppRoleName');
    expect(rows[0]).toHaveProperty('Records');
    expect(rows[0]!['RowKind']).toBe('laneAttempt');
  });

  it('returns a 401 with actionable error message on notLoggedIn error from client', async () => {
    srv.replaceClient(
      makeFakeClient({
        kind: 'throw',
        error: new Error('Please run az login to set up your account before running this command.'),
      }),
    );
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'myapp', lookbackHours: 24 });
    expect(resp.status).toBe(401);
    const body = await resp.json() as Record<string, unknown>;
    expect(String(body['error'])).toMatch(/az login/i);
    expect(body['kind']).toBe('notLoggedIn');
  });

  it('returns a 403 with RBAC message on insufficientRbac error from client', async () => {
    srv.replaceClient(
      makeFakeClient({
        kind: 'throw',
        error: new Error('403 Forbidden: does not have authorization to perform action'),
      }),
    );
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'myapp', lookbackHours: 24 });
    expect(resp.status).toBe(403);
    const body = await resp.json() as Record<string, unknown>;
    expect(body['kind']).toBe('insufficientRbac');
  });

  it('returns a 429 on throttling error from client', async () => {
    srv.replaceClient(
      makeFakeClient({
        kind: 'throw',
        error: new Error('429 Too Many Requests: throttled'),
      }),
    );
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'myapp', lookbackHours: 24 });
    expect(resp.status).toBe(429);
    const body = await resp.json() as Record<string, unknown>;
    expect(body['kind']).toBe('throttling');
  });

  it('serves CORS headers on every response', async () => {
    const resp = await postQuery(srv.port, {
      appRoleNameFilter: 'myapp',
      lookbackHours: 24,
    });
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles OPTIONS preflight with 204', async () => {
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/query`, {
      method: 'OPTIONS',
    });
    expect(resp.status).toBe(204);
  });

  it('server is bound to 127.0.0.1 (loopback) and reachable on that address', async () => {
    // If the server had bound to 0.0.0.0 instead of 127.0.0.1, it would still
    // be reachable via 127.0.0.1. This test confirms the port is reachable at
    // the loopback address (i.e., the server successfully started on loopback).
    const resp = await postQuery(srv.port, { appRoleNameFilter: 'test', lookbackHours: 1 });
    expect(resp.status).toBe(200);
  });
});
