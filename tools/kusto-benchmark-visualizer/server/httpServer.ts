/**
 * HTTP server bootstrap for the loopback App Insights query server.
 * Binds to 127.0.0.1 ONLY — never to 0.0.0.0 or all interfaces.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AppInsightsQueryClient } from './queryEngine.js';
import { handleRequest } from './queryEngine.js';

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the loopback HTTP server.
 * @param host Must be '127.0.0.1' — enforced by config.ts.
 * @param port TCP port to listen on. Pass 0 for an ephemeral port (tests only).
 * @param client Injectable Azure Monitor query client.
 */
export function startServer(
  host: '127.0.0.1',
  port: number,
  client: AppInsightsQueryClient,
): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, client).catch((err: unknown) => {
        // Uncaught handler errors (should not happen; handleRequest catches internally)
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    });

    server.once('error', reject);

    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}
