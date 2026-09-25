# Build context: repository root (npm workspaces). See docker-compose.yml.
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
# npm needs every workspace manifest to resolve the lockfile.
COPY web/package.json web/
RUN npm ci --workspace server --workspace packages/shared --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
RUN cd server && npx prisma generate --schema prisma/schema.prisma && cd .. \
 && npm run build --workspace server \
 && mkdir -p server/node_modules

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
# node_modules keeps the Prisma CLI, needed for `prisma migrate deploy` on start.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY server/docker-entrypoint.sh server/docker-entrypoint.sh
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "sh", "docker-entrypoint.sh"]
