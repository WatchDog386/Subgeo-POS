-- 003_sync.sql — the company database: every chemist's records, synced with the tills.
--
-- One row per record of every till table (products, sales, customers, …).
--   tbl    the till table name (src/db/db.ts SYNCED_TABLES)
--   scope  0 for company-wide tables (users, branches, categories, suppliers,
--          shared settings); otherwise the chemist (branch) id the record belongs to
--   id     the record id (text, so kv keys fit too)
--   data   the record as JSON (money in integer cents, like the till)
--   seq    global change counter — tills download "everything after seq N"
CREATE TABLE IF NOT EXISTS sync_records (
  tbl        TEXT    NOT NULL,
  scope      INTEGER NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  ts         INTEGER NOT NULL,             -- last change time on the till (last write wins)
  seq        INTEGER NOT NULL,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tbl, scope, id)
);

CREATE INDEX IF NOT EXISTS idx_sync_scope_seq ON sync_records (scope, seq);
CREATE INDEX IF NOT EXISTS idx_sync_tbl_scope ON sync_records (tbl, scope);

CREATE TABLE IF NOT EXISTS sync_meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);
INSERT OR IGNORE INTO sync_meta (k, v) VALUES ('seq', 0);

-- Signed-in tills. The token is sent as "Authorization: Bearer <token>".
CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_user ON auth_sessions (user_id);
