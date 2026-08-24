# Next.js App Router, output "standalone". Build context es la raíz del
# repo (no ./web) — las API routes importan directo de src/brain/*.ts (ver
# tsconfig.json paths), así que necesitamos src/ disponible al buildear.
FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY web ./web
RUN cd web && npx next build

# Runtime: server.js de standalone + node_modules trazados (pg, ioredis,
# bullmq, el Agent SDK, etc. — serverExternalPackages en next.config.mjs
# hace que queden como archivos reales, no bundleados). El código propio
# (src/brain/*) SÍ queda bundleado adentro de los route handlers, así que
# no hace falta copiar src/ acá. memory/ NO se copia — vive montada como
# volumen (ver docker-compose.prod.yml), igual que en el servicio `robin`.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static

RUN groupadd -g 1001 robin && useradd -u 1001 -g robin -m robin \
    && chown -R robin:robin /app
USER robin

EXPOSE 3000
CMD ["node", "web/server.js"]
