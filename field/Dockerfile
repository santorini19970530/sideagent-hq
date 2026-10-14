# House runners (D20): the field CLI with public tests run in-process, because on Cloud Run the
# container is the sandbox. Per execution HQ appends `--once --job <jobId>`.
# Built from the repo root: docker build -f field/Dockerfile .
#
# Base is the python-sandbox image's Python (same digest), plus the node binary copied from
# node:24-slim: pytest then runs exactly as in HQ checks, and node is one file while Python is a
# whole tree. Both are Debian slim images, so node's libraries are there. Bump the digests together
# with images/python-sandbox/Dockerfile and hq/Dockerfile.
ARG NODE_IMAGE=node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5
ARG PYTHON_IMAGE=python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY protocol/package.json protocol/
COPY hq/package.json hq/
COPY field/package.json field/
COPY control/package.json control/
# `sideagent` is the field package. `node --import tsx` resolves from the repo root.
RUN pnpm install --frozen-lockfile --prod --filter sideagent... \
  && ln -s ../field/node_modules/tsx node_modules/tsx

FROM ${NODE_IMAGE} AS node

FROM ${PYTHON_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node

COPY images/python-sandbox/requirements.txt /opt/sideagent/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/sideagent/requirements.txt
COPY images/python-sandbox/pytest.ini images/python-sandbox/run_checks.py /opt/sideagent/

ENV NODE_ENV=production \
  SIDEAGENT_TEST_RUNNER=process \
  SIDEAGENT_RUN_CHECKS=/opt/sideagent/run_checks.py
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY protocol/tsconfig.json protocol/
COPY protocol/src protocol/src
COPY field/tsconfig.json field/
COPY field/src field/src

# Not uid 10001, the sandbox user: run_checks.py kills every process of that user after a run,
# which would include this CLI.
RUN useradd --uid 10002 --no-create-home --home-dir /tmp runner
USER 10002
ENTRYPOINT ["node", "--import", "tsx", "field/src/cli.ts"]
CMD ["field"]
