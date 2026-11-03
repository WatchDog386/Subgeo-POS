-- 008_shared_usernames.sql — cashiers / managers of different chemists may
-- share a user name (e.g. "subgeo"); the password picks the account. The
-- relational users table loses its UNIQUE(username). Derived data: the server
-- refills it on boot (RELATIONAL_VERSION 5).
CREATE TABLE users_new (
  id          INTEGER PRIMARY KEY,
  username    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'purchase')),
  branch_id   INTEGER REFERENCES branches (id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  email       TEXT,
  phone       TEXT,
  CHECK (role = 'owner' OR branch_id IS NOT NULL OR active = 0)
);
INSERT INTO users_new SELECT id, username, name, role, branch_id, active, email, phone FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_branch ON users (branch_id);
CREATE INDEX idx_users_username ON users (username);
-- One account per user name per chemist.
CREATE UNIQUE INDEX idx_users_name_branch ON users (username, IFNULL(branch_id, 0));
