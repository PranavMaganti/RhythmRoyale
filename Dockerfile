# syntax=docker/dockerfile:1
# One container serves the game server, the API and the built web app.
# Works on Fly.io, Render, Railway, Google Cloud Run, or any Docker host.

# Override to pin an exact image digest, or to use an internal mirror.
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/cache/corepack \
    npm_config_store_dir=/cache/pnpm-store \
    XDG_CACHE_HOME=/cache/xdg
RUN corepack enable
WORKDIR /app
# Manifests first, so dependency layers are cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

FROM base AS build
RUN --mount=type=cache,id=rr-cache,target=/cache pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=rr-cache,target=/cache pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080
# Only the server's production dependencies (and the shared package).
# pnpm itself and its caches live in a build cache mount, so only the
# installed packages end up in the image.
RUN --mount=type=cache,id=rr-cache,target=/cache \
    pnpm install --frozen-lockfile --prod --filter "@rhythm-royale/backend..."
COPY --from=build /app/common/dist common/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY backend/sql backend/sql
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The entrypoint prepares a SQLite volume if one is used, then runs the
# server as the unprivileged `node` user.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
