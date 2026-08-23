# Imagen multi-arch oficial de Node — cubre linux/arm64 (VPS Oracle Ampere A1) y
# linux/amd64 sin cambios. Corremos con tsx directo (sin build step) para no
# complicar el Dockerfile con un paso de compilación TS que no aporta acá.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY memory ./memory
COPY db ./db

# El vault (memory/) vive en un volumen montado en producción (ver
# docker-compose.prod.yml) — lo que se copia acá es solo el estado inicial
# para el primer arranque si el volumen viene vacío.

CMD ["npx", "tsx", "src/adapters/telegram/index.ts"]
