---
type: project
name: Robin
description: Asistente personal con Claude — arquitectura y decisiones de diseño
---

# Robin

Asistente personal **reactivo** (actúa cuando se le pide, no autónomo), pensado para
correr 24/7 en el VPS propio del usuario (Oracle Cloud Ampere A1: 4 vCPU ARM, 23GB RAM,
45GB disco). Multi-canal: CLI, Telegram, Discord, WhatsApp, Web, voz.

## Decisiones clave

- **LLM:** Claude vía Agent SDK. `LLM_PROVIDER` configurable — por defecto
  `CLAUDE_CODE_OAUTH_TOKEN` (cuota de la suscripción Pro/Max, $0 extra), con salida
  limpia a `ANTHROPIC_API_KEY` (pago por token) si hace falta. El primero es zona gris
  de ToS para uso 24/7 (documentado para CI/scripts, no explícitamente para
  servicio persistente) — riesgo bajo a volumen personal, vigilar.
- **Router por capacidad**, no por complejidad binaria: DIRECT (scheduler/calculadora,
  sin LLM) / KNOWLEDGE (search_memory + LLM barato) / AGENT (Claude + GitHub/Bash/
  Browser).
- **Memoria en tres roles:** Obsidian/markdown (esta carpeta) = fuente de verdad;
  Postgres = memoria operacional (conversaciones, scheduling, audit log); pgvector =
  índice semántico opcional sobre el vault, no un almacén paralelo.
- **`search_memory()`** es una interfaz estable — la implementación evoluciona
  (V1 ripgrep → V2 Postgres FTS → V3 hybrid+pgvector → V4 +reranking) sin que el
  Agent Runtime tenga que cambiar.

## Roadmap

V0 (listo) — CLI local, Claude Agent SDK, memory tools sobre este vault.

V1 (listo) — Memory Engine: Postgres+Redis vía Docker Compose,
`search_memory()`/`remember()` reales como MCP tools propios (`robin-memory`).
Embeddings 100% locales (`@huggingface/transformers`, sin API paga). El agente ya no
escribe archivos directo en `memory/` — todo pasa por `remember()` para que el índice
semántico nunca quede desincronizado.

V2 (listo) — Tools: GitHub MCP (oficial, binario copiado a la imagen), Bash con
`PreToolUse` hook denylist (rm -rf, sudo, pipe-a-shell, etc.), Playwright MCP
(browser). Rama AGENT completa.

V3 (LISTO, EN VIVO EN EL VPS) — Telegram + deploy 24/7.
- Corriendo 24/7 en el VPS real (Oracle Ampere A1, `rvaldiviase-instance`),
  código en `~/server-data/robin`. Verificado en vivo desde Telegram real.
- Deploy hecho por `git archive | ssh ... tar -x` (repo GitHub
  `RyanValdivia/robin`, público, portafolio).
- **Bug encontrado y arreglado en el deploy:** el contenedor corría como root
  y el Agent SDK manda `--dangerously-skip-permissions` — la CLI de Claude Code
  rechaza ese flag como root, crash-loop en cada mensaje. Fix: `Dockerfile`
  corre con `USER robin` (uid/gid 1001, igual al usuario `ubuntu` del host).
- Owner de Telegram bootstrapped en la DB del VPS (user_id=1, telegram
  6945356724).

V4 (LISTO, EN VIVO EN EL VPS) — Router híbrido por capacidad.
- `src/brain/router.ts`: heurística de keywords primero (gratis, sin red) →
  cae a LLM barato (Groq) si es ambigua → cae a AGENT (Claude) si no hay LLM
  barato configurado o algo falla. Nunca se pierde una respuesta por costo.
- DIRECT (saludo, hora/fecha, calculadora, recordatorios simples): cero LLM.
  AGENT/BrainSession de Claude es **lazy** en ambos adapters — solo se crea
  si el router manda algo a AGENT.
- KNOWLEDGE: `search_memory()` + Groq (`openai/gpt-oss-20b`) sintetiza la
  respuesta — no toca cuota de Claude.
- **Bugs encontrados en vivo y arreglados:** GitHub MCP invocaba `docker run`
  pero el contenedor de la app no tiene el socket de Docker del host (fix:
  binario copiado a la imagen vía multi-stage build); faltaban certificados
  CA para que el binario Go de github-mcp-server validara TLS (fix:
  `apt-get install ca-certificates`); regex `repo(sitorio)?` no matcheaba el
  plural "repos" (fix: `repos?(itorios?)?`).

V5 (LISTO, EN VIVO EN EL VPS, VERIFICADO) — Proactividad: scheduler.
- `src/brain/scheduler.ts`: BullMQ sobre Redis + tabla `scheduled_tasks`
  (Postgres). El worker que dispara NO llama a Claude — solo lee el texto
  guardado y lo empuja por el outbound sender que registra el adapter
  (hoy: Telegram).
- Router (DIRECT): "recordame X a las H" / "recordame X en N minutos/horas"
  se resuelve con regex + Date, cero LLM, tanto al crear como al disparar.
- Tools para AGENT (`schedule_task`/`list_reminders`/`cancel_reminder`): para
  cuando la fecha/hora no es trivial de parsear — Claude la calcula una vez
  al crear, el disparo sigue sin tocarlo.
- **Zona horaria:** router (DIRECT) y `systemPrompt` (AGENT) fuerzan
  `America/Lima` (UTC-5 fijo, sin DST) para calcular/mostrar hora — el VPS
  corre en UTC.
- **Bug encontrado y arreglado en vivo:** `jobId: "task:${id}"` — BullMQ v6
  rechaza `:` en jobId custom (`Custom Id cannot contain :`). Insertaba la
  fila en Postgres pero `reminderQueue.add()` tiraba antes de encolar el
  job — el recordatorio nunca disparaba. Fix: `"task-${id}"`.

V6 (LISTO, EN VIVO EN EL VPS, VERIFICADO — STT+TTS completo) — Voz.
- `whisper/`: servicio Python aparte (faster-whisper/ctranslate2) con un
  wrapper HTTP mínimo (FastAPI) — expone `POST /transcribe` (bytes de audio
  crudos) → `{text, language}`. Separado del proceso Node del brain porque
  ctranslate2 es Python.
- Modelo `small`, `compute_type=int8` en CPU (sin GPU en el VPS). Cacheado en
  volumen (`whisper_model`) para no re-descargar en cada rebuild/restart.
- Sin puerto publicado en prod — solo red interna, el brain le habla por
  nombre de servicio (`WHISPER_URL=http://whisper:8000`). En dev local se
  publica en `127.0.0.1:8001` porque el brain corre en el host, no en Docker.
- Telegram: nota de voz se descarga (`ctx.getFile()`), se manda entera al
  servicio, el texto transcripto entra al mismo `routeMessage()` que
  cualquier mensaje de texto — cero código nuevo en el router/DIRECT/
  KNOWLEDGE/AGENT. La respuesta muestra la transcripción arriba (🎙️) para
  que el usuario pueda notar si Whisper entendió mal algo.
- **Riesgo ARM anotado en el plan desde el principio, verificado OK en
  vivo:** `ctranslate2`/`faster-whisper` con `compute_type=int8` corre bien
  en el VPS (Ampere A1, Neoverse-N1) — no hizo falta el fallback a
  `int8_float32`/`float32`.
- **Bug encontrado y arreglado en el deploy:** `faster-whisper==1.0.3` usa
  `requests` pero no lo declara como dependencia propia — `pip install`
  del `requirements.txt` original no lo traía, `ModuleNotFoundError` al
  arrancar. Fix: agregado `requests` explícito a `whisper/requirements.txt`.

**TTS (Piper)** — completa V6 (decisión: alcance ampliado de solo-STT a
STT+TTS después de repasar qué le faltaba a Robin).
- `piper/`: servicio Node (sin Express, `http` nativo — un solo endpoint no
  lo justificaba) que shellea el binario oficial de Piper (release
  multi-arch, resuelve aarch64/x86_64 solo) y pipea el PCM crudo
  (`--output_raw`) directo a `ffmpeg`, que transcodea a OGG/Opus — formato
  que Telegram necesita para una nota de voz real (`sendVoice`), no un
  archivo de audio genérico. Sin archivos temporales, todo por pipe.
- **Voz elegida:** `es_MX-claude-high` (español mexicano, calidad "high",
  ~63MB) — no hay voz `es_PE` en el catálogo de Piper; latam es más cercano
  al oído peruano que castellano (`es_ES`). Nombre "claude" es casualidad
  del catálogo, no elegido por el nombre.
- Modelo se descarga una vez a un volumen (`piper_voices`), mismo patrón
  que `whisper_model`.
- **Verificado en vivo ANTES de escribir el Dockerfile:** se probaron los
  flags reales del binario (`--model`, `--output_raw`, no
  `--output-raw`/guión) y el pipeline completo piper→ffmpeg→ogg a mano por
  SSH — evitó adivinar mal la CLI.
- **Bug encontrado y arreglado en el deploy:** el server nunca escribía el
  texto al stdin de Piper (`piper.stdin.write`/`.end()` faltaban) — Piper
  se quedaba esperando stdin para siempre, la request colgaba sin
  responder ni fallar. Encontrado probando en vivo (timeout de 120s en la
  primera prueba real).
- Telegram: solo manda nota de voz cuando la entrada TAMBIÉN fue voz (no
  fuerza audio en una conversación tipeada) — además del texto, no en vez
  de.

V7 (Web UI LISTA, EN VIVO EN EL VPS, VERIFICADA) — Más canales: arrancó por
Web UI (Discord/WhatsApp quedan pendientes). Decisión: `robin.rvaldiviase.com`, protegido por el middleware
`tinyauth` (forward-auth de Traefik) que ya usaba el usuario para
homarr/portainer/dashboard de Traefik — cero código de auth propio en Robin,
mismo login que ya conoce.
- `src/adapters/web/`: `index.ts` (Express: `POST /api/message` → mismo
  `routeMessage()` que Telegram) + `public/index.html` (chat vanilla JS, sin
  build step, sin dependencias externas — mismo espíritu minimalista que el
  resto del proyecto).
- **Corre como servicio Docker aparte del de Telegram** (misma imagen,
  `command` distinto) — a propósito: `startSchedulerWorker()` solo lo llama
  el proceso de Telegram, así nunca hay ambigüedad de qué proceso tiene el
  outbound sender registrado cuando dispara un recordatorio. El proceso web
  puede encolar recordatorios (`scheduleReminder` vía DIRECT/AGENT) pero no
  corre el worker que los dispara.
- **Límite conocido, documentado a propósito:** recordatorios creados desde
  la Web UI no se entregan ahí (no hay push a browser) — solo por Telegram
  por ahora. Aceptable para v1.
- Sesión de Claude (AGENT) es un solo hilo compartido para todo el canal web
  (no hay noción de "chats" distintos como en Telegram) — mismo patrón que
  el CLI.
- **Verificado en vivo:** `POST /api/message` interno responde bien
  (`routeMessage()` funciona); `https://robin.rvaldiviase.com` público da
  401 sin login — tinyauth gatea de verdad, la app nunca queda expuesta sin
  auth.
- **Voz en la Web UI** (mismo patrón que Telegram): `POST /api/voice-message`
  transcribe con `whisper/`, entra a `routeMessage()`, y si `piper/` está
  configurado la respuesta viaja también como audio (base64 en el JSON —
  clips chicos, no vale la pena un endpoint binario aparte). Frontend graba
  con `MediaRecorder` del navegador (botón 🎙️, solo visible si
  `GET /api/voice-status` dice que STT está disponible); la respuesta con
  audio se reproduce sola y queda un botón "▶ escuchar" para repetirla.
  Verificado en vivo end-to-end (STT→router→TTS, 200 con audio real de
  vuelta).
- **Disco lleno durante el deploy (pendiente de higiene de disco del plan,
  cobrado):** VPS llegó a 100% (45GB) por build cache + imágenes Docker
  viejas acumuladas — `docker builder prune -af` + `docker image prune -af`
  liberaron ~35GB sin tocar datos (volúmenes no se tocan). Falta automatizar
  esto (cron de `docker system prune` acotado, ver plan sección Seguridad) —
  ya se dio dos veces (este V7 y en el histórico del plan como riesgo
  anotado), la próxima vez que corte un build hay que sospechar esto primero.
  **Resuelto después:** `/etc/docker/daemon.json` con log rotation
  (max-size 10m, max-file 3) + cron semanal (usuario `ubuntu`, domingos 4am)
  de `docker image/builder prune -af --filter "until=168h"`.

**Dashboard de la Web UI ampliado** (mismo commit que el resumen proactivo,
ver abajo): tabs **Memoria** (sidebar con notas del vault + viewer con
markdown-lite renderizado — solo lectura, escribir sigue siendo `remember()`
desde AGENT) y **Recordatorios** (lista + cancelar). Estilo con Tailwind Play
CDN + Alpine.js, ambos vendoreados en `public/vendor/` (bajados una vez, sin
build step, sin CDN externo en runtime — mismo espíritu minimalista).
- **Bug encontrado y arreglado:** el vault tenía notas con CRLF (de una
  sincronización manual anterior desde Windows) — el parser de frontmatter
  nuevo (`listNotes`/`readNote` en `memory.ts`) solo esperaba `\n`, devolvía
  type/name/description vacíos. Fix: normalizar CRLF→LF en un único punto de
  lectura (`readNoteFile`), el resto del código ya no necesita saber de esto.

**Resumen proactivo (diario/semanal) + dashboard de uso/costos** — dos
features pedidas después de repasar "qué le falta a Robin":
- `brain/proactive.ts`: BullMQ `upsertJobScheduler` (cron + `tz:
  "America/Lima"`, idempotente entre restarts) — diario 8am, semanal lunes
  8am. A diferencia de un recordatorio normal, ACÁ sí se llama a Claude en
  el momento del disparo (una `BrainSession` de un solo uso, con
  `search_memory` disponible) para generar el texto — no está fijado de
  antemano. Corre en el proceso de Telegram (mismo que el worker de
  recordatorios), reusando su outbound sender.
  - **Cambio de arquitectura que arrastró:** `BrainSession` (`session.ts`)
    no tenía forma de cerrarse — bien para las sesiones por chat (viven todo
    el proceso), pero una sesión de un solo uso como esta dejaba corriendo
    un proceso de Claude Code para siempre en cada disparo. Se agregó
    `close()`.
  - `resolveOwnerChannel()` se movió de `tools.ts` a `auth.ts` (lo reusan
    los dos).
- Dashboard de uso: tablas nuevas `message_log` (categoría+canal por
  mensaje ruteado) y `groq_usage_log` (tokens por llamada). `router.ts`
  loguea cada clasificación; `cheapLLM.ts` loguea el `usage` que ya venía
  en la respuesta de Groq. Todo el logging es fire-and-forget (nunca rompe
  una respuesta real si falla). Tab nueva **Uso** en la Web UI: stat tiles +
  barras por categoría (paleta categórica del skill de dataviz, validada,
  slots 1-3 dark: blue/orange/aqua) — muestra en vivo que DIRECT/KNOWLEDGE
  no tocan la cuota de Claude.
- **Verificado en vivo:** mensaje DIRECT y KNOWLEDGE de prueba aparecieron
  en `/api/usage` con tokens reales de Groq (169/220); los dos job
  schedulers quedaron registrados en BullMQ con próximo disparo correcto
  (lunes 8am Lima).

**Migración de la Web UI a Next.js/React/shadcn** (reemplaza por completo el
adapter Express+vanilla-JS/Alpine/Tailwind-CDN descrito arriba) — pedido
explícito del usuario tras la queja de que se veía mal en celular: en vez de
seguir parchando CSS, mover a un framework real para mejor pulido visual y
porque el proyecto es de portafolio.
- `web/`: app Next.js 15 (App Router) + React 19 propia, con su propio
  `package.json`/`node_modules` — **no** un paquete nuevo del monorepo, vive
  al lado de `src/`. Importa el brain directo (`@brain/*` → `../src/brain/*`,
  `@config` → `../src/config.ts` en `web/tsconfig.json`) — cero duplicación
  de lógica de negocio. Node resuelve solo los paquetes de terceros
  (`pg`/`ioredis`/etc.) hacia arriba, al `node_modules` de la raíz.
- Componentes estilo shadcn (`Button`/`Textarea`/`Card`/`Badge`) escritos a
  mano con `class-variance-authority`+`clsx`+`tailwind-merge` — **sin Radix**:
  nada acá necesita comportamiento polimórfico/`asChild`, así que se saltó
  esa dependencia a propósito.
- `output: "standalone"` + `serverExternalPackages` (pg/ioredis/bullmq/Agent
  SDK/transformers) en `next.config.mjs` — esos paquetes quedan como archivos
  reales trazados en vez de bundleados; el código propio (`src/brain/*`) SÍ
  queda bundleado adentro de los route handlers (confirmado inspeccionando
  el output real), no hace falta copiar `src/` al runtime del Dockerfile.
- **Gotcha:** cada `route.ts` de Next es un módulo aislado (a diferencia del
  Express de un solo archivo) — una sesión de chat local a `message/route.ts`
  NO es la misma instancia que ve `voice-message/route.ts`, rompía la
  continuidad de conversación en AGENT para voz. Fix: `web/lib/session.ts`
  con el singleton compartido, importado por ambas rutas.
- **Gotcha de tipos:** `src/brain/stt.ts` pasaba un `Buffer` a `fetch(body:)`
  — bajo el tsconfig de `web/` (con lib `"dom"`) no resolvía el overload;
  forzar `as BodyInit` rompía el tsconfig de la raíz (sin lib `"dom"`, el
  tipo `BodyInit` ni existe ahí). Fix real: `body: new Uint8Array(audio)` —
  tipo válido en ambos tsconfig, `Buffer` ya extiende `Uint8Array`.
- `web/tsconfig.json` necesitó `"allowImportingTsExtensions": true` — los
  imports internos de `src/brain/*.ts` usan extensión `.ts` explícita
  (necesario para correr con `tsx`), que el typecheck más estricto de
  Next.js rechaza por defecto.
- **Bug de infra encontrado de paso:** el servicio `web` viejo en
  `docker-compose.prod.yml` nunca tuvo montado `./memory:/app/memory` (solo
  `robin` lo tenía) — la Web UI leía una foto vieja del vault, congelada al
  build de la imagen. Se agregó el mismo mount al nuevo servicio `web`.
- `web/Dockerfile`: 4 stages (`base`→`deps`→`builder`→`runner`), mismo patrón
  no-root uid/gid 1001 que el resto de los Dockerfiles del proyecto. Build
  context es la raíz del repo (no `./web`), porque necesita `src/` disponible
  al compilar.
- **Verificado en vivo (VPS) tras el deploy:** logs limpios (`Ready in
  340ms`), `GET /api/voice-status` → `{"stt":true,"tts":true}`,
  `POST /api/message` con "que hora es" → responde con hora de Lima correcta
  vía DIRECT (sin tocar Claude), `https://robin.rvaldiviase.com` público
  sigue dando 401 sin login (tinyauth intacto). Nota: el server de Next
  standalone bindea al IP real del contenedor en la red Docker, no a
  `localhost` — normal, Traefik/otros contenedores igual lo alcanzan por IP/
  nombre de servicio.
- Se borró todo el adapter viejo: `src/adapters/web/` (index.ts Express +
  `public/` con Alpine/Tailwind vendoreados).
- **Bug post-deploy: 502 Bad Gateway en `robin.rvaldiviase.com`**, reportado
  por el usuario. Causa: Docker setea `HOSTNAME=<container id>` por defecto
  en todo contenedor; el `server.js` de Next standalone usa esa var como
  bind address si está seteada (en vez de `0.0.0.0`) — terminaba resolviendo
  vía `/etc/hosts` la IP de UNA sola red (`robin_internal`), dejando
  `traefik_proxy` (por donde entra el tráfico real) inalcanzable.
  Confirmado con `wget` desde el propio contenedor de `traefik` a esa IP:
  timeout. Fix: `environment: HOSTNAME=0.0.0.0` explícito en el servicio
  `web` de `docker-compose.prod.yml`. Verificado en vivo tras el fix:
  traefik alcanza el container por su IP de `traefik_proxy`, público pasó
  de 502 a 401 (gate normal).

## Rename jarvis → robin (proyecto completo)

Nombre en código inicial del repo fue `jarvis` (V0-V4); se renombró todo a
**Robin** — carpeta local y del VPS, repo de GitHub, rol/DB de Postgres
(`ALTER ROLE`/`ALTER DATABASE`, sin perder datos), contenedores/red Docker,
`package.json`, comentarios. Los volúmenes físicos de Docker en el VPS quedan
referenciados como `external: true` apuntando al nombre viejo
(`jarvis_jarvis_pg_data`/`jarvis_jarvis_redis_data`) para no tener que copiar
datos — es un detalle interno invisible, no afecta nada de lo que se ve/usa.

## Higiene de disco del VPS (todo el host, no solo Robin)

Pendiente del plan desde el principio, cobrado en el deploy de V7 (build de
`web` falló por `ENOSPC`, disco al 100%/45GB — `docker builder prune -af` +
`docker image prune -af` liberaron ~35GB sin tocar volúmenes).

- `/etc/docker/daemon.json`: `log-driver: json-file`, `max-size: 10m`,
  `max-file: 3` (tope ~30MB/contenedor). Aplicado con
  `sudo systemctl restart docker` — **esto reinicia TODOS los contenedores
  del host** (no solo Robin), confirmado con el usuario antes de hacerlo.
  Solo afecta contenedores nuevos/recreados desde que se aplicó — los que ya
  estaban corriendo mantienen su config vieja hasta que se recrean (se
  recreó Robin ahí mismo; el resto de los servicios del VPS lo toman en su
  próximo redeploy natural).
- **Efecto colateral encontrado y arreglado:** `stirling-pdf` (no es de
  Robin) no tenía restart policy (`RestartPolicy: no`) — no volvió solo
  después del restart del daemon. Se hizo `docker start stirling-pdf`
  manualmente. Nada que ver con el log rotation en sí, gap preexistente de
  ese servicio.
- Cron (`crontab -l` del usuario `ubuntu`, no root): domingos 4am,
  `docker image prune -af --filter "until=168h"` +
  `docker builder prune -af --filter "until=168h"` (solo imágenes/cache sin
  uso de más de 7 días — no toca volúmenes, no toca contenedores corriendo).
  Output a `~/docker-prune.log`.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
