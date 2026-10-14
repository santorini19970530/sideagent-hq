# HQ and the budget guard: one image, two commands (Cloud Run sets the budget guard's).
#   node --import tsx hq/src/server.ts        (default)
#   node --import tsx hq/src/budget-guard.ts
# Built from the repo root: docker build -f hq/Dockerfile .
# node:24-slim, pinned by digest; bump both together.
ARG NODE_IMAGE=node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# pnpm at the version in package.json `packageManager`, through corepack.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Manifests only, so the install layer is cached until dependencies change. Every workspace
# manifest is copied so the lockfile matches; only HQ and what it depends on is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY protocol/package.json protocol/
COPY hq/package.json hq/
COPY field/package.json field/
COPY control/package.json control/
# `node --import tsx` resolves from the working directory (the repo root), not from hq/.
RUN pnpm install --frozen-lockfile --prod --filter @sideagent/hq... \
  && ln -s ../hq/node_modules/tsx node_modules/tsx

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY protocol/tsconfig.json protocol/
COPY protocol/src protocol/src
COPY hq/tsconfig.json hq/
COPY hq/src hq/src
# The image's own `node` user (uid 1000); nothing in /app is writable by it.
USER node
# Cloud Run sets PORT (8080); HQ reads it.
EXPOSE 8080
CMD ["node", "--import", "tsx", "hq/src/server.ts"]
