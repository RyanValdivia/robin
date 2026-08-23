# Deploy en el VPS

Asume: VPS con Docker + Docker Compose, Traefik ya corriendo (red `traefik_proxy`).

## 1. Llevar el código

```bash
git clone <tu-repo> robin   # o rsync/scp si todavía no está en un remoto
cd robin
```

## 2. Configurar `.env.prod`

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
nano .env.prod   # completar POSTGRES_PASSWORD, TELEGRAM_BOT_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN
```

`DATABASE_URL` y `REDIS_URL` del ejemplo ya apuntan a los nombres de servicio
correctos (`postgres`, `redis`) — solo hay que hacer que la password coincida
en las dos líneas (`POSTGRES_PASSWORD` y dentro de `DATABASE_URL`).

## 3. Autenticar Claude (una sola vez)

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token
```

Abre una URL en el navegador (la abrís en tu celular/PC, no hace falta que sea
en el VPS), autorizás, y el comando imprime un token de un año. Pegalo en
`.env.prod` como `CLAUDE_CODE_OAUTH_TOKEN=...`.

## 4. Owner de Telegram

Necesitás Postgres ya arriba para esto:

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml exec -T postgres psql -U robin -d robin < db/schema.sql
docker compose -f docker-compose.prod.yml run --build --rm robin npm run bootstrap-owner -- telegram <TU_ID_DE_TELEGRAM>
```

## 5. Arrancar todo

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f robin
```

Debería loguear `[telegram] listo — @tu_bot`. Mandale un mensaje desde tu
Telegram y confirmá que responde.

## Actualizar después de un cambio de código

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build robin
```

Si el cambio fue en `whisper/` (STT, V6) o `piper/` (TTS, V6), rebuildear ese
servicio en vez de (o además de) `robin`:

```bash
docker compose -f docker-compose.prod.yml up -d --build whisper
docker compose -f docker-compose.prod.yml up -d --build piper
```

Si el cambio fue en `src/adapters/web/` (Web UI, V7), rebuildear `web`
(misma imagen que `robin`, `command` distinto):

```bash
docker compose -f docker-compose.prod.yml up -d --build web
```

La Web UI queda publicada en `https://robin.rvaldiviase.com`, detrás del
middleware `tinyauth` de Traefik — mismo login que ya usás para
homarr/portainer, nada que configurar de nuevo.

## Vault (`memory/`)

Vive montado como volumen (`./memory:/app/memory`), no dentro de la imagen —
así lo podés editar directo por SSH o sincronizarlo con Obsidian sin rebuildear
nada.
