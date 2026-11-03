-- 004_relational.sql — the company database as proper related tables.
--
-- How the data flows:
--   tills (IndexedDB, offline-first)  ──push/pull──►  sync_records (JSON, source of truth for sync)
--                                                        │
--                                                        └─► these tables (server/relational.ts keeps
--                                                            them up to date on every write; rebuild
--                                                            any time with: npm run db:rebuild)
--
-- Conventions
--   * Money is INTEGER cents (KES x 100), exactly as on the tills.
--   * Times are INTEGER milliseconds since 1970 (JavaScript Date.now()).
--   * Ids are the tills' ids (globally unique numbers), so a row here is the
--     same record as on every till.
--   * branch_id is the chemist (pharmacy) a record belongs to. Company-wide
--     tables (branches, users, categories, suppliers, staff_messages) have none.
--   * A reference whose parent is unknown or was deleted is NULL (ON DELETE
--     SET NULL), so history (sales, movements) is never lost.

-- The 001/002 mirrors were never wired to anything; their data lives in sync_records.
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

/* ── Company-wide ─────────────────────────────────────────────────────────── */
CREATE TABLE branches (
  id          INTEGER PRIMARY KEY,
  number      INTEGER NOT NULL UNIQUE CHECK (number >= 1),   -- 1 → CHEM1
  code        TEXT    NOT NULL UNIQUE,                       -- 'CHEM1'
  name        TEXT    NOT NULL,
  location    TEXT,
  phone       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  INTEGER NOT NULL DEFAULT 0
);

-- Staff accounts. Password hashes stay in sync_records only.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  username    TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'purchase')),
  branch_id   INTEGER REFERENCES branches (id) ON DELETE SET NULL,  -- NULL for the admin (owner)
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  email       TEXT,
  phone       TEXT,
  CHECK (role = 'owner' OR branch_id IS NOT NULL OR active = 0)
);
CREATE INDEX idx_users_branch ON users (branch_id);

CREATE TABLE categories (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  color  TEXT
);

CREATE TABLE suppliers (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  phone  TEXT,
  email  TEXT,
  notes  TEXT
);
CREATE INDEX idx_suppliers_name ON suppliers (name COLLATE NOCASE);

CREATE TABLE staff_messages (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  from_name  TEXT    NOT NULL,
  to_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,   -- NULL = everyone
  to_name    TEXT    NOT NULL,
  subject    TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX idx_messages_to ON staff_messages (to_id, at);

CREATE TABLE staff_message_reads (
  message_id INTEGER NOT NULL REFERENCES staff_messages (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

/* ── Per chemist: stock ───────────────────────────────────────────────────── */
CREATE TABLE products (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  sku            TEXT    NOT NULL,
  barcode        TEXT,
  name           TEXT    NOT NULL,
  category_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  supplier_id    INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
  brand          TEXT,
  part_number    TEXT,
  shelf          TEXT,
  cost           INTEGER NOT NULL DEFAULT 0,
  price          INTEGER NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  reorder_level  INTEGER NOT NULL DEFAULT 0,
  taxable        INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
  serialized     INTEGER NOT NULL DEFAULT 0 CHECK (serialized IN (0, 1)),
  track_stock    INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1)),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL DEFAULT 0
);
-- Not UNIQUE: two offline tills of one chemist may briefly hold the same SKU.
CREATE INDEX idx_products_branch_sku ON products (branch_id, sku);
CREATE INDEX idx_products_barcode    ON products (barcode);
CREATE INDEX idx_products_category   ON products (category_id);
CREATE INDEX idx_products_supplier   ON products (supplier_id);

CREATE TABLE stock_movements (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products (id) ON DELETE SET NULL,
  change      INTEGER NOT NULL,
  reason      TEXT    NOT NULL CHECK (reason IN ('sale', 'refund', 'receive', 'adjust', 'damage', 'count', 'transfer')),
  reference   TEXT,
  note        TEXT,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX idx_movements_product ON stock_movements (product_id, at);
CREATE INDEX idx_movements_branch  ON stock_movements (branch_id, at);

/* ── Per chemist: customers, shifts, sales ────────────────────────────────── */
CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  branch_id     INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  phone         TEXT,
  email         TEXT,
  balance       INTEGER NOT NULL DEFAULT 0,     -- what the customer owes
  credit_limit  INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_customers_branch ON customers (branch_id, name);
CREATE INDEX idx_customers_phone  ON customers (phone);

CREATE TABLE shifts (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  opened_at      INTEGER NOT NULL,
  closed_at      INTEGER,                          -- NULL while open
  opening_float  INTEGER NOT NULL DEFAULT 0,
  counted_cash   INTEGER,
  expected_cash  INTEGER,
  notes          TEXT
);
CREATE INDEX idx_shifts_branch ON shifts (branch_id, opened_at);

CREATE TABLE shift_cash_movements (
  shift_id  INTEGER NOT NULL REFERENCES shifts (id) ON DELETE CASCADE,
  line_no   INTEGER NOT NULL,
  type      TEXT    NOT NULL CHECK (type IN ('in', 'out')),
  amount    INTEGER NOT NULL,
  reason    TEXT,
  at        INTEGER NOT NULL,
  PRIMARY KEY (shift_id, line_no)
);

CREATE TABLE sales (
  id            INTEGER PRIMARY KEY,
  branch_id     INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  receipt_no    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  customer_id   INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  shift_id      INTEGER REFERENCES shifts (id) ON DELETE SET NULL,
  status        TEXT    NOT NULL CHECK (status IN ('completed', 'refunded', 'partially_refunded', 'voided')),
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  tax           INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,       -- negative on refund records
  change_given  INTEGER NOT NULL DEFAULT 0,
  refund_of     INTEGER REFERENCES sales (id) ON DELETE SET NULL,
  branch_label  TEXT,
  note          TEXT
);
CREATE INDEX idx_sales_branch_time ON sales (branch_id, created_at);
CREATE INDEX idx_sales_receipt     ON sales (branch_id, receipt_no);
CREATE INDEX idx_sales_customer    ON sales (customer_id);
CREATE INDEX idx_sales_shift       ON sales (shift_id);

CREATE TABLE sale_lines (
  sale_id       INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  product_id    INTEGER REFERENCES products (id) ON DELETE SET NULL,  -- NULL for free-text lines
  name          TEXT    NOT NULL,
  sku           TEXT,
  qty           REAL    NOT NULL,
  unit_price    INTEGER NOT NULL,
  unit_cost     INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  taxable       INTEGER NOT NULL DEFAULT 1,
  serial        TEXT,
  refunded_qty  REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (sale_id, line_no)
);
CREATE INDEX idx_sale_lines_product ON sale_lines (product_id);

CREATE TABLE sale_payments (
  sale_id    INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  method     TEXT    NOT NULL CHECK (method IN ('cash', 'mpesa', 'card', 'account')),
  amount     INTEGER NOT NULL,
  reference  TEXT,                                -- M-Pesa code, card approval…
  PRIMARY KEY (sale_id, line_no)
);
CREATE INDEX idx_sale_payments_method ON sale_payments (method);

CREATE TABLE parked_sales (
  id           INTEGER PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  discount     INTEGER NOT NULL DEFAULT 0,
  customer_id  INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE parked_sale_lines (
  parked_id   INTEGER NOT NULL REFERENCES parked_sales (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  product_id  INTEGER REFERENCES products (id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  qty         REAL    NOT NULL,
  unit_price  INTEGER NOT NULL,
  discount    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parked_id, line_no)
);

/* ── Per chemist: purchasing ──────────────────────────────────────────────── */
CREATE TABLE purchase_orders (
  id           INTEGER PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  po_no        TEXT    NOT NULL,
  supplier_id  INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
  status       TEXT    NOT NULL CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_po_branch ON purchase_orders (branch_id, status);

CREATE TABLE purchase_order_lines (
  po_id       INTEGER NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  product_id  INTEGER REFERENCES products (id) ON DELETE SET NULL,
  qty         INTEGER NOT NULL,
  unit_cost   INTEGER NOT NULL,
  received    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (po_id, line_no)
);

/* ── Per chemist: service requests ────────────────────────────────────────── */
CREATE TABLE service_jobs (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  job_no         TEXT    NOT NULL,
  customer_id    INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  customer_name  TEXT    NOT NULL,
  phone          TEXT,
  complaint      TEXT,
  labour         INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting_parts', 'ready', 'collected')),
  attendant      TEXT,
  sale_id        INTEGER REFERENCES sales (id) ON DELETE SET NULL,  -- the bill, once paid
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_jobs_branch ON service_jobs (branch_id, status);

CREATE TABLE service_job_lines (
  job_id      INTEGER NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  product_id  INTEGER REFERENCES products (id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  qty         REAL    NOT NULL,
  unit_price  INTEGER NOT NULL,
  discount    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, line_no)
);

/* ── Per chemist: transaction documents (medapp screens) ──────────────────── */
-- One row per document of a transaction screen: purchase-indent,
-- local-purchase-order, pur-inv-grn, pur-grn-direct-invoice, petty-cash-voucher,
-- supplier-payment, sales-quotation, delivery-note, whole-sale-invoice,
-- credit-note, medicine, … (doc_type = the screen's slug).
CREATE TABLE documents (
  id              INTEGER PRIMARY KEY,
  branch_id       INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  doc_type        TEXT    NOT NULL,
  doc_no          TEXT,
  doc_date        TEXT,              -- as typed: dd-mm-yyyy
  party_name      TEXT,              -- vendor / supplier / customer on the document
  supplier_id     INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,   -- matched by name
  customer_id     INTEGER REFERENCES customers (id) ON DELETE SET NULL,   -- matched by name
  amount          INTEGER,           -- cents: TOTAL VALUE / approx cost / amount
  status          TEXT,
  ref_doc_no      TEXT,              -- the document it follows: LPO → indent no, GRN → LPO no
  has_attachment  INTEGER NOT NULL DEFAULT 0 CHECK (has_attachment IN (0, 1)),
  values_json     TEXT    NOT NULL,  -- every field of the screen (attachments left out)
  created_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_documents_type   ON documents (branch_id, doc_type, created_at);
CREATE INDEX idx_documents_no     ON documents (doc_type, doc_no);
CREATE INDEX idx_documents_ref    ON documents (ref_doc_no);
CREATE INDEX idx_documents_party  ON documents (supplier_id);

CREATE TABLE staff_tasks (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  text           TEXT    NOT NULL,
  doc_ref        TEXT,
  due_at         INTEGER,
  assigner_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  assigner_name  TEXT,
  assignee_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,  -- NULL = everyone at the chemist
  assignee_name  TEXT,
  status         TEXT    NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  completed_by   TEXT
);
CREATE INDEX idx_tasks_branch ON staff_tasks (branch_id, status);
CREATE INDEX idx_tasks_assignee ON staff_tasks (assignee_id, status);

CREATE TABLE activity_logs (
  id         INTEGER PRIMARY KEY,
  branch_id  INTEGER NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  detail     TEXT,
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name  TEXT
);
CREATE INDEX idx_logs_branch ON activity_logs (branch_id, at);

-- Settings, default values, running document numbers and other small values.
-- branch_id NULL = company-wide (e.g. 'settings', 'medapp:defaults').
CREATE TABLE app_values (
  branch_id   INTEGER REFERENCES branches (id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value_json  TEXT
);
CREATE UNIQUE INDEX idx_app_values_key ON app_values (IFNULL(branch_id, 0), key);

/* ── Report views ─────────────────────────────────────────────────────────── */
CREATE VIEW v_stock AS
SELECT b.code AS chemist, p.id AS product_id, p.sku, p.name, c.name AS category, s.name AS supplier,
       p.stock, p.reorder_level, p.cost, p.price,
       CASE WHEN p.track_stock = 1 AND p.stock > 0 THEN p.stock * p.cost ELSE 0 END AS stock_value,
       CASE WHEN p.track_stock = 1 AND p.stock <= p.reorder_level THEN 1 ELSE 0 END AS below_reorder
FROM products p
JOIN branches b ON b.id = p.branch_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE p.active = 1;

CREATE VIEW v_daily_sales AS
SELECT b.code AS chemist, date(s.created_at / 1000, 'unixepoch', 'localtime') AS day,
       SUM(CASE WHEN s.total > 0 THEN 1 ELSE 0 END) AS bills,
       SUM(s.total) AS total_cents
FROM sales s JOIN branches b ON b.id = s.branch_id
WHERE s.status != 'voided'
GROUP BY b.code, day;

CREATE VIEW v_payments_by_method AS
SELECT b.code AS chemist, date(s.created_at / 1000, 'unixepoch', 'localtime') AS day, p.method, SUM(p.amount) AS amount_cents
FROM sale_payments p JOIN sales s ON s.id = p.sale_id JOIN branches b ON b.id = s.branch_id
WHERE s.status != 'voided'
GROUP BY b.code, day, p.method;

CREATE VIEW v_debtors AS
SELECT b.code AS chemist, c.id AS customer_id, c.name, c.phone, c.balance AS owes_cents, c.credit_limit
FROM customers c JOIN branches b ON b.id = c.branch_id
WHERE c.balance > 0;

-- Purchase flow: indent → LPO (indentNo) → GRN (lpoNo).
CREATE VIEW v_purchase_flow AS
SELECT b.code AS chemist, i.doc_no AS indent_no, i.doc_date AS indent_date,
       l.doc_no AS lpo_no, l.party_name AS vendor, g.doc_no AS grn_no, g.doc_date AS grn_date,
       CASE WHEN g.id IS NOT NULL THEN 'RECEIVED' WHEN l.id IS NOT NULL THEN 'ORDERED' ELSE 'INDENTED' END AS stage
FROM documents i
JOIN branches b ON b.id = i.branch_id
LEFT JOIN documents l ON l.doc_type = 'local-purchase-order' AND l.branch_id = i.branch_id AND l.ref_doc_no = i.doc_no
LEFT JOIN documents g ON g.doc_type = 'pur-inv-grn' AND g.branch_id = i.branch_id AND g.ref_doc_no = l.doc_no
WHERE i.doc_type = 'purchase-indent';
