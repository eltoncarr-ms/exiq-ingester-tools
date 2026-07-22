/**
 * Server configuration for the loopback App Insights query server.
 * The server ALWAYS binds to 127.0.0.1 (loopback only) — never 0.0.0.0.
 */

export interface ServerConfig {
  /** Loopback address — always 127.0.0.1, never 0.0.0.0. */
  readonly host: '127.0.0.1';
  /** TCP port to listen on. Default 7432. */
  readonly port: number;
  /** Target Azure Monitor workspace or App Insights resource ID. */
  readonly workspaceId: string;
  /** Azure AD tenant ID (optional; needed for cross-tenant access). */
  readonly tenantId?: string;
}

export function getConfigFromEnv(): ServerConfig {
  const port = parseInt(process.env['QUERY_SERVER_PORT'] ?? '7432', 10);
  const workspaceId = process.env['WORKSPACE_ID'] ?? '';
  const tenantId = process.env['TENANT_ID'] ?? undefined;

  if (!workspaceId) {
    throw new Error(
      'WORKSPACE_ID environment variable is required. ' +
      'Set it to the Log Analytics workspace ID or App Insights resource ID.',
    );
  }

  return { host: '127.0.0.1', port, workspaceId, tenantId };
}
