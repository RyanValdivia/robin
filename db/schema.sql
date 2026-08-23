-- JARVIS — schema Postgres (memoria operacional + índice semántico)
-- Ver plan: quisiera-hacer-algo-asi-squishy-kurzweil.md

CREATE EXTENSION IF NOT EXISTS vector;

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
