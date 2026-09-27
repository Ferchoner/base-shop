# Node.js 24 (ADR-0025). Two targets (ADR-0089):
# - development: used by docker compose; the project is bind-mounted and runs in watch mode.
# - production: minimal runtime image built by the CI (ADR-0030, T-106).

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM base AS development
ENV NODE_ENV=development
# npm ci runs `prisma generate` (postinstall), which needs the Prisma schema and config.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
EXPOSE 3000
# The bind mount hides the client generated in the image, so generate it again on start.
CMD ["sh", "-c", "npm run db:generate && npm run start:dev"]

FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# The Prisma CLI is an optional peer of @prisma/client, so npm keeps it unless optional packages are
# omitted too. No runtime package is optional (the only one is pg-cloudflare, for Cloudflare Workers).
RUN npm run build && npm prune --omit=dev --omit=optional

FROM base AS production
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
