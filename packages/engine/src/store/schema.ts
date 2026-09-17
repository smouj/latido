/**
 * Esquema SQLite canónico.
 *
 * Esta es la forma que tienen los datos **en disco** en la app de escritorio
 * (`apps/desktop/src-tauri/src/db.rs` ejecuta exactamente estas sentencias).
 * El `MemoryStore` de `store.ts` mantiene el mismo modelo en memoria para el
 * modo web y para los tests, así que cualquier cambio aquí debe reflejarse en
 * los dos sitios: `docs/DATA-MODEL.md` es la referencia para no perder el hilo.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  kind          TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 1,
  options_json  TEXT NOT NULL DEFAULT '{}',
  requires_proxy INTEGER NOT NULL DEFAULT 0,
  poll_ms       INTEGER,
  last_ok_at    INTEGER,
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  body         TEXT,
  lang         TEXT,
  author_id    TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_name  TEXT,
  published_at INTEGER NOT NULL,
  ingested_at  INTEGER NOT NULL,
  likes        INTEGER DEFAULT 0,
  replies      INTEGER DEFAULT 0,
  reposts      INTEGER DEFAULT 0,
  comments     INTEGER DEFAULT 0,
  stars        INTEGER DEFAULT 0,
  score        INTEGER DEFAULT 0,
  delta        INTEGER DEFAULT 0,
  tags_json    TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  cluster_id   TEXT,
  simhash      TEXT NOT NULL,
  origin       TEXT NOT NULL,
  read         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_cluster   ON posts (cluster_id);
CREATE INDEX IF NOT EXISTS idx_posts_source    ON posts (source, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external ON posts (source, external_id);

CREATE TABLE IF NOT EXISTS clusters (
  id             TEXT PRIMARY KEY,
  keywords_json  TEXT NOT NULL DEFAULT '[]',
  entities_json  TEXT NOT NULL DEFAULT '[]',
  centroid       TEXT NOT NULL,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  corroborations INTEGER NOT NULL DEFAULT 0,
  lang           TEXT NOT NULL DEFAULT 'und'
);
CREATE INDEX IF NOT EXISTS idx_clusters_last_seen ON clusters (last_seen DESC);

CREATE TABLE IF NOT EXISTS cluster_sources (
  cluster_id TEXT NOT NULL REFERENCES clusters (id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  PRIMARY KEY (cluster_id, source)
);

CREATE TABLE IF NOT EXISTS trends (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  state        TEXT NOT NULL,
  score        INTEGER NOT NULL,
  velocity     REAL NOT NULL,
  growth       REAL NOT NULL,
  volume       INTEGER NOT NULL,
  coverage     INTEGER NOT NULL,
  engagement   INTEGER NOT NULL,
  novelty      REAL NOT NULL,
  cohesion     REAL NOT NULL,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  reason_code  TEXT NOT NULL,
  reason_json  TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trends_score ON trends (score DESC, last_seen DESC);

CREATE TABLE IF NOT EXISTS trend_points (
  trend_id TEXT NOT NULL REFERENCES trends (id) ON DELETE CASCADE,
  at       INTEGER NOT NULL,
  score    INTEGER NOT NULL,
  volume   INTEGER NOT NULL,
  velocity REAL NOT NULL,
  PRIMARY KEY (trend_id, at)
);

CREATE TABLE IF NOT EXISTS entities (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  aliases_json  TEXT NOT NULL DEFAULT '[]',
  accounts_json TEXT NOT NULL DEFAULT '{}',
  links_json    TEXT NOT NULL DEFAULT '[]',
  watch         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS watchlists (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  entities_json TEXT NOT NULL DEFAULT '[]',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  query       TEXT,
  min_growth  REAL,
  min_sources INTEGER,
  sources_json TEXT,
  cooldown_ms INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  trend_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events (created_at DESC);

CREATE TABLE IF NOT EXISTS alert_fired (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  post_id    TEXT PRIMARY KEY REFERENCES posts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Búsqueda de texto completo. Se mantiene con triggers, no desde el código:
-- así la indexación nunca se desincroniza de la tabla real.
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5 (
  title,
  body,
  tags,
  content = 'posts',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts (rowid, title, body, tags)
  VALUES (new.rowid, coalesce(new.title, ''), coalesce(new.body, ''), new.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts (posts_fts, rowid, title, body, tags)
  VALUES ('delete', old.rowid, coalesce(old.title, ''), coalesce(old.body, ''), old.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts (posts_fts, rowid, title, body, tags)
  VALUES ('delete', old.rowid, coalesce(old.title, ''), coalesce(old.body, ''), old.tags_json);
  INSERT INTO posts_fts (rowid, title, body, tags)
  VALUES (new.rowid, coalesce(new.title, ''), coalesce(new.body, ''), new.tags_json);
END;

-- Retención: la app llama a esta consulta con la fecha de corte del usuario.
--   DELETE FROM posts WHERE published_at < ?;
--   DELETE FROM trends WHERE last_seen < ? AND acknowledged = 1;
`

/** Migraciones incrementales. `SCHEMA_VERSION` es la última aplicada. */
export const MIGRATIONS: { version: number; sql: string }[] = [{ version: 1, sql: SCHEMA_SQL }]
