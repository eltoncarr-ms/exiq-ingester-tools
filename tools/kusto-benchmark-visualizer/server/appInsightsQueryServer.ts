/**
 * Entry point for the loopback App Insights query server.
 *
 * Usage:
 *   WORKSPACE_ID=<workspace-or-resource-id> node --loader ts-node/esm server/appInsightsQueryServer.ts
 *
 * Or with the npm script (after installing server dependencies):
 *   npm run server
 *
 * Prerequisites:
 *   1. npm install @azure/identity @azure/monitor-query
 *   2. az login (or az login --tenant <tenantId> for cross-tenant)
 *   3. WORKSPACE_ID env var set to the Log Analytics workspace ID or App Insights resource ID
 *
 * The server binds to 127.0.0.1 only. The browser client at localhost:5173 can
 * reach it; no other host can.
 *
 * Required RBAC: Log Analytics Reader OR Monitoring Reader on the target resource.
 */

import { getConfigFromEnv } from './config.js';
import { startServer } from './httpServer.js';
import { AzureMonitorQueryClient } from './azureMonitorClient.js';

async function main() {
  const config = getConfigFromEnv();
  const client = new AzureMonitorQueryClient(config.workspaceId, config.tenantId);

  const server = await startServer(config.host, config.port, client);
  console.log(`App Insights query server listening on http://127.0.0.1:${server.port}/api/query`);
  console.log(`Workspace: ${config.workspaceId}`);
  console.log('Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
