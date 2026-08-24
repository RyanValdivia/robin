# Robin

Asistente personal con Claude — memoria propia (vault markdown + Postgres +
pgvector), router híbrido por capacidad (DIRECT sin LLM / KNOWLEDGE vía Groq /
AGENT vía Claude Agent SDK con GitHub/Bash/Browser), recordatorios proactivos,
corriendo 24/7 en VPS propio, hoy por Telegram. Arquitectura completa en
`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`.

## Estado: V6 completa, V7 (Web UI) lista, corriendo 24/7 en el VPS

- **V0-V5 listas**: CLI local, memoria persistente, Bash con guardarraíl,
  Playwright MCP, GitHub MCP, Telegram (`@robin_rv_bot`), router híbrido por
  capacidad, recordatorios proactivos + resumen proactivo diario/semanal
  (scheduler que no depende de Claude para disparar, salvo el resumen que sí
  llama a Claude una vez al generarse).
- **V6 (voz)**: notas de voz por Telegram se transcriben con faster-whisper
  (`whisper/`, STT) y, si vino por voz, la respuesta también se manda como
  nota de voz sintetizada con Piper (`piper/`, TTS) — ambos servicios locales
  y gratis, aparte del proceso principal.
- **V7 (Web UI)**: `https://robin.rvaldiviase.com` — Next.js 15/React 19 +
  componentes estilo shadcn (`web/`), dashboard con tabs Chat/Memoria/
  Recordatorios/Uso, mismo `routeMessage()` que Telegram (importa `src/brain/*`
  directo, sin duplicar lógica). Sin auth propia — en prod queda detrás del
  middleware `tinyauth` de Traefik (mismo gate que el resto de servicios
  admin del VPS). Corre como servicio Docker aparte del de Telegram.
- Siguiente: Discord, WhatsApp (Baileys) — resto de V7.

## Desarrollo local

```
npm install
docker compose up -d          # Postgres + Redis + whisper (STT) + piper (TTS)
docker compose exec -T postgres psql -U robin -d robin < db/schema.sql   # solo la primera vez
npm run chat                  # CLI
```

Requiere estar logueado con Claude Code en esta máquina (`claude login` /
`claude setup-token`) — hereda esa autenticación automáticamente, sin API key.

Escribí `salir` para terminar el CLI.

Para la Web UI en local (Next.js, `web/`, proyecto propio con su
`package.json`):

```
cd web
npm install
npm run dev                   # http://localhost:3000
```

Importa `src/brain/*` directo (paths `@brain/*`/`@config` en
`web/tsconfig.json`) — sigue necesitando Postgres/Redis/whisper/piper
levantados (paso de arriba) para que todas las tabs funcionen.

## Deploy en VPS

Ver `DEPLOY.md`.

## Estructura

- `src/brain/session.ts` — sesión de conversación compartida por cualquier canal
  (memoria, tools, hooks, MCP).
- `src/brain/systemPrompt.ts` — persona ("Robin") + memoria inyectada al contexto.
- `src/brain/memory.ts` — `search_memory()`/`remember()` (grep + pgvector).
- `src/adapters/` — canales (CLI, Telegram, ...), thin, sin lógica de LLM.
- `web/` — Web UI, Next.js/React/shadcn aparte (su propio `package.json`),
  importa `src/brain/*` directo.
- `memory/` — vault de conocimiento (fuente de verdad). Editable a mano (Obsidian
  compatible) o por Robin mismo cuando le pedís que recuerde algo.
