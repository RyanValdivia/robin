-- Robin — schema Postgres (memoria operacional + índice semántico)
-- Ver plan: quisiera-hacer-algo-asi-squishy-kurzweil.md

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent; -- matcheo de nombre de curso sin tilde, ver agenda.ts

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  is_owner      BOOLEAN NOT NULL DEFAULT false,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_identities (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  channel      TEXT NOT NULL,       -- 'cli' | 'telegram' | 'discord' | 'whatsapp' | 'web'
  external_id  TEXT NOT NULL,
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL REFERENCES users(id),
  channel                   TEXT NOT NULL,
  external_conversation_id  TEXT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una conversación por (user, channel, external_conversation_id) — upsert
-- idempotente en conversationLog.ts, sobrevive restarts sin duplicar filas.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_channel_external_idx
  ON conversations (user_id, channel, external_conversation_id);

CREATE TABLE IF NOT EXISTS messages (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  role             TEXT NOT NULL,   -- 'user' | 'assistant' | 'tool'
  content          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,        -- 'reminder' | 'cron_job' | 'one_off'
  payload     JSONB NOT NULL,
  run_at      TIMESTAMPTZ,
  cron_expr   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_audit_log (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER REFERENCES conversations(id),
  tool_name        TEXT NOT NULL,
  input            JSONB,
  output           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uso/costos (para el dashboard de la Web UI, ver plan V7) — mensajes por
-- rama del router (DIRECT/KNOWLEDGE/AGENT) y tokens gastados en el LLM
-- barato (Groq). No es un audit log completo, solo lo mínimo para mostrar
-- que el router de hecho ahorra cuota de Claude.
CREATE TABLE IF NOT EXISTS message_log (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,   -- 'direct' | 'knowledge' | 'agent'
  channel     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entrega para el canal 'web' (gap: "recordatorios creados en Web no se
-- entregan ahí" — Web no tiene un sendMessage() como Telegram, así que en vez
-- de una función en memoria (registerOutboundSender) queda una fila acá que
-- el propio navegador levanta por polling, ver web/app/api/web-notifications.
-- Sin columna "delivered_at"/consumo: con la Web abierta en varias pestañas o
-- dispositivos a la vez, cada uno hace su propio polling — consumir en el
-- primer GET dejaba al resto sin ver la notificación nunca (encontrado en
-- code review). recentWebNotifications() (scheduler.ts) devuelve por ventana
-- de tiempo, dedupe por id queda del lado del cliente.
CREATE TABLE IF NOT EXISTS web_notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Push real al navegador (Web Push/VAPID) — antes web_notifications de arriba
-- era el único canal para 'web' y dependía de polling con la pestaña de Chat
-- abierta. Una suscripción por (browser, perfil): el mismo user puede tener
-- varias filas (celu, laptop, distintos navegadores) -> UNIQUE por endpoint,
-- no por user_id. p256dh/auth son las claves públicas que manda el propio
-- browser al suscribirse (PushSubscription.toJSON().keys), necesarias para
-- cifrar el payload en sendWebPush() (ver brain/webPush.ts).
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groq_usage_log (
  id                 SERIAL PRIMARY KEY,
  prompt_tokens      INTEGER NOT NULL,
  completion_tokens  INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice semántico sobre el vault de markdown (memory/). NO es la fuente de
-- verdad — se reconstruye desde los archivos. document_path es relativo a memory/.
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id             SERIAL PRIMARY KEY,
  document_path  TEXT NOT NULL UNIQUE,
  chunk          TEXT NOT NULL,
  embedding      vector(384) NOT NULL,   -- paraphrase-multilingual-MiniLM-L12-v2
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FTS: full-text search en español sobre el mismo contenido, para la mitad
-- "exacta" de search_memory() (además del grep directo sobre archivos).
CREATE INDEX IF NOT EXISTS memory_embeddings_fts_idx
  ON memory_embeddings USING GIN (to_tsvector('spanish', chunk));

-- Búsqueda vectorial aproximada (suficiente a escala personal; se puede tunear
-- lists/probes más adelante si el vault crece mucho).
CREATE INDEX IF NOT EXISTS memory_embeddings_vector_idx
  ON memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Grafo de [[wikilinks]] entre notas del vault. Tampoco es fuente de verdad —
-- se reconstruye en cada indexNote() a partir del contenido de la nota.
-- to_name es el `name:` del frontmatter destino (puede no existir todavía:
-- un [[link]] colgante es válido, ver MEMORY.md).
CREATE TABLE IF NOT EXISTS memory_links (
  from_path  TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  PRIMARY KEY (from_path, to_name)
);

CREATE INDEX IF NOT EXISTS memory_links_from_idx ON memory_links (from_path);

-- Agenda (horario fijo del usuario) — bloques de "estoy ocupado a esa hora",
-- a diferencia de scheduled_tasks (recordatorios): esto NUNCA dispara un
-- aviso, es solo referencia para mostrar en una vista de agenda semanal (ver
-- brain/agenda.ts). Exactamente uno de day_of_week/date: recurrente semanal
-- (día de semana, se repite indefinido, ej. clases/trabajo fijo) o puntual
-- (fecha exacta, una sola vez, ej. un examen), nunca los dos ni ninguno.
CREATE TABLE IF NOT EXISTS agenda_blocks (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  label        TEXT NOT NULL,
  day_of_week  SMALLINT,  -- 0=domingo..6=sábado
  date         DATE,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  teacher      TEXT,  -- docente/responsable, opcional
  description  TEXT,  -- notas libres, opcional
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((day_of_week IS NOT NULL) <> (date IS NOT NULL)),
  CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
  CHECK (start_time < end_time)
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe —
-- necesario para cuando agenda_blocks ya estaba creada (teacher/description
-- se sumaron después del lanzamiento inicial).
ALTER TABLE agenda_blocks ADD COLUMN IF NOT EXISTS teacher TEXT;
ALTER TABLE agenda_blocks ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS agenda_blocks_user_idx ON agenda_blocks (user_id);

-- Curso/evento con nombre — mismo texto de label (sin importar mayúsculas)
-- SIEMPRE resuelve al mismo curso (get-or-create, ver brain/agenda.ts), así
-- una clase recurrente y un examen puntual del mismo curso quedan
-- relacionados solos, comparten color (asignado en orden fijo al crear —
-- misma paleta validada que usa la Web, ver agenda-panel.tsx) y el docente
-- no hay que repetirlo en cada bloque.
CREATE TABLE IF NOT EXISTS agenda_courses (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  teacher     TEXT,
  color       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_courses_user_name_idx ON agenda_courses (user_id, lower(name));

ALTER TABLE agenda_blocks ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES agenda_courses(id);
CREATE INDEX IF NOT EXISTS agenda_blocks_course_idx ON agenda_blocks (course_id);
