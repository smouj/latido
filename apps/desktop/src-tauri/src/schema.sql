-- Esquema del archivo de Latido (SQLite + FTS5).
--
-- ATENCIÓN: este archivo y `packages/engine/src/store/schema.ts` describen el
-- mismo modelo y deben cambiar juntos. `docs/DATA-MODEL.md` es la referencia.
--
-- Se aplica con `execute_batch`, así que las sentencias van separadas por `;`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  kind           TEXT PRIMARY KEY,
  enabled        INTEGER NOT NULL DEFAULT 1,
  options_json   TEXT NOT NULL DEFAULT '{}',
  requires_proxy INTEGER NOT NULL DEFAULT 0,
  poll_ms        INTEGER,
  last_ok_at     INTEGER,
  last_error     TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT,
  body          TEXT,
  lang          TEXT,
  author_id     TEXT NOT NULL DEFAULT '',
  author_handle TEXT NOT NULL DEFAULT '',
  author_name   TEXT,
  published_at  INTEGER NOT NULL,
  ingested_at   INTEGER NOT NULL,
  likes         INTEGER DEFAULT 0,
  replies       INTEGER DEFAULT 0,
  reposts       INTEGER DEFAULT 0,
  comments      INTEGER DEFAULT 0,
  stars         INTEGER DEFAULT 0,
  score         INTEGER DEFAULT 0,
  delta         INTEGER DEFAULT 0,
  tags_json     TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  cluster_id    TEXT,
  simhash       TEXT NOT NULL DEFAULT '',
  origin        TEXT NOT NULL DEFAULT '',
  read          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_cluster   ON posts (cluster_id);
CREATE INDEX IF NOT EXISTS idx_posts_source    ON posts (source, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external ON posts (source, external_id);

CREATE TABLE IF NOT EXISTS clusters (
  id             TEXT PRIMARY KEY,
  keywords_json  TEXT NOT NULL DEFAULT '[]',
  entities_json  TEXT NOT NULL DEFAULT '[]',
  centroid       TEXT NOT NULL DEFAULT '0000000000000000',
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
  engagement   INTEGER NOT NULL DEFAULT 0,
  novelty      REAL NOT NULL DEFAULT 0,
  cohesion     REAL NOT NULL DEFAULT 0,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  reason_code  TEXT NOT NULL DEFAULT '',
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
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  entities_json TEXT NOT NULL DEFAULT '[]',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  query        TEXT,
  min_growth   REAL,
  min_sources  INTEGER,
  sources_json TEXT,
  cooldown_ms  INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id            TEXT PRIMARY KEY,
  rule_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  trend_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events (created_at DESC);

CREATE TABLE IF NOT EXISTS alert_fired (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_lists (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  post_id    TEXT PRIMARY KEY REFERENCES posts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Búsqueda de texto completo. Los disparadores la mantienen al día solos: si se
-- escribe desde fuera (sqlite3, un script), el índice sigue siendo correcto.
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
