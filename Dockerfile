# Node.js 24 (ADR-0025). Three targets (ADR-0089, ADR-0147):
# - development: used by docker compose; the project is bind-mounted and runs in watch mode.
# - production: minimal runtime image built by the CI (ADR-0030, T-106), without the Prisma CLI.
# - migrate: applies the migrations with the Prisma CLI, as a one-off step before each deployment (P-05).

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM base AS development
ENV NODE_ENV=development
# npm ci runs `prisma generate` (postinstall), which needs the Prisma schema and config.
# .npmrc makes install scripts that allowScripts does not cover fail the install (ADR-0108).
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
EXPOSE 3000
# The bind mount hides the client generated in the image, so generate it again on start.
CMD ["sh", "-c", "npm run db:generate && npm run start:dev"]

FROM base AS build
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# The dependencies the API runs with. The Prisma CLI is a development dependency; the transactional adapter of
# nestjs-cls declares it as a peer but never loads it, so peers are not installed on their own here. Nothing needs
# an install script: the Prisma client is already compiled into dist, and argon2 ships its binaries (ADR-0147).
FROM base AS prod-deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

FROM base AS production
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The common password list, read at startup relative to /app (ADR-0115).
COPY --from=build --chown=node:node /app/data/passwords ./data/passwords
# Folders of the product images (IMAGE_STORAGE_DIR, ADR-0121) and of the private audit archive (AUDIT_ARCHIVE_DIR,
# ADR-0146), owned by node; mount a persistent volume on /app/storage.
RUN mkdir -p storage/images storage/audit && chmod 700 storage/audit && chown -R node:node storage
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

# Applies the pending migrations to DATABASE_URL and ends (DATABASE.md §13). Run it once before starting a new
# version of the API, with a database user that can change the schema; the API uses another one (ADR-0147).
FROM build AS migrate
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
