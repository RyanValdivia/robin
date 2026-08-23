# Binario del GitHub MCP server oficial, copiado de su imagen (distroless) en
# vez de invocarlo con `docker run` en runtime — el contenedor de jarvis no
# tiene (ni debería tener) acceso al socket de Docker del host. Multi-arch,
# resuelve a la variante correcta (arm64 en el VPS) sola.
FROM ghcr.io/github/github-mcp-server AS ghmcp

# Imagen multi-arch oficial de Node — cubre linux/arm64 (VPS Oracle Ampere A1) y
# linux/amd64 sin cambios. Corremos con tsx directo (sin build step) para no
# complicar el Dockerfile con un paso de compilación TS que no aporta acá.
FROM node:24-slim

WORKDIR /app

COPY --from=ghmcp /server/github-mcp-server /usr/local/bin/github-mcp-server
ENV GITHUB_MCP_BIN=/usr/local/bin/github-mcp-server

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY memory ./memory
COPY db ./db

# El vault (memory/) vive en un volumen montado en producción (ver
# docker-compose.prod.yml) — lo que se copia acá es solo el estado inicial
# para el primer arranque si el volumen viene vacío.

# Correr como no-root: el Agent SDK usa --dangerously-skip-permissions
# (bypassPermissions), que la CLI de Claude Code rechaza si el proceso es root.
# uid/gid 1001 para que coincida con el owner del bind mount ./memory en el
# host (usuario `ubuntu` del VPS) y no haya problemas de permisos de escritura.
RUN groupadd -g 1001 jarvis && useradd -u 1001 -g jarvis -m jarvis \
    && chown -R jarvis:jarvis /app
USER jarvis

CMD ["npx", "tsx", "src/adapters/telegram/index.ts"]
