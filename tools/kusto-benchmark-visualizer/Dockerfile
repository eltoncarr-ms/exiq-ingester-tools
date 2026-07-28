FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
# Mount the caller's ~/.npmrc (with ADO auth token) at build time via BuildKit
# secrets. The secret is never written to any image layer.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Final image: Node (for the loopback query server) + nginx (for the React SPA)
FROM node:24-alpine

# Install nginx from Alpine packages
RUN apk add --no-cache nginx

# nginx: serve the built React SPA and proxy /api/ to the loopback query server
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Node server: copy source and dependencies
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY server ./server
COPY src/appinsights ./src/appinsights

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
