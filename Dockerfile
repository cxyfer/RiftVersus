FROM node:24.12.0-bookworm-slim AS dependencies

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/sync/package.json packages/sync/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build && pnpm --filter @riftversus/web build
RUN pnpm --filter @riftversus/server deploy --prod --legacy /opt/riftversus-server
RUN node scripts/runtime-artifact.mjs prune-and-check /opt/riftversus-server

FROM node:24.12.0-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /opt/riftversus-server/ /app/apps/server/
COPY --from=build --chown=node:node /workspace/apps/web/dist/ /app/apps/web/dist/
COPY --from=build --chown=node:node /workspace/data/acceptance/ /app/data/acceptance/
COPY --from=build --chown=node:node /workspace/data/fixtures/ /app/data/fixtures/
COPY --from=build --chown=node:node /workspace/data/overrides/ /app/data/overrides/
COPY --from=build --chown=node:node /workspace/docs/README.md /workspace/docs/operations.md /workspace/docs/deployment.md /workspace/docs/data-sources.md /workspace/docs/attribution.md /workspace/docs/source-and-attribution.md /app/docs/
COPY --chmod=0555 docker/entrypoint.sh /usr/local/bin/riftversus-entrypoint

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/riftversus-entrypoint"]
CMD ["serve"]
