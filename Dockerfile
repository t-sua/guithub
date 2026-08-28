# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: needs a C toolchain because better-sqlite3 is a native module.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, so a change to source code does not re-run the install layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json   packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json    packages/web/package.json
RUN npm ci

COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime stage: git is the storage engine, so it ships in the image.
# node_modules is copied from the build stage rather than reinstalled, which
# keeps the already-compiled better-sqlite3 binary and its matching Node ABI.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/home/node \
    GUITHUB_DATA_DIR=/data \
    GUITHUB_HOST=0.0.0.0 \
    GUITHUB_PORT=8080

COPY --from=build /app/node_modules              ./node_modules
COPY --from=build /app/package.json              ./package.json
COPY --from=build /app/packages/core/package.json   packages/core/package.json
COPY --from=build /app/packages/core/dist           packages/core/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist         packages/server/dist
COPY --from=build /app/packages/web/dist            packages/web/dist

# git refuses to operate on a repository owned by another user, and the server
# runs with GIT_CONFIG_GLOBAL unset to /dev/null so safe.directory cannot rescue
# it. The data volume must therefore be owned by this uid — see docker-compose.
RUN mkdir -p /data && chown -R node:node /data /home/node
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/main.js"]
