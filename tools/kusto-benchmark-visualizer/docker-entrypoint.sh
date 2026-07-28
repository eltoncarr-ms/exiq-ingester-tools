#!/bin/sh
set -e

# Start nginx in non-daemon mode as a background process.
# It serves the React SPA and proxies /api/ to the loopback query server.
nginx -g 'daemon off;' &

# Start the loopback App Insights query server as the foreground process (PID 1).
# Requires WORKSPACE_ID env var. TENANT_ID and QUERY_SERVER_PORT are optional.
exec node_modules/.bin/tsx server/appInsightsQueryServer.ts
