-- 005_document_lines.sql — product lines of whole-sale documents, cheque
-- payments, and the pharmacy details typed on OTC bills.
-- These tables are derived from sync_records, so they can be recreated freely;
-- the server rebuilds them on boot (RELATIONAL_VERSION 2).

-- Cheque becomes a payment method.
DROP VIEW IF EXISTS v_payments_by_method;
DROP TABLE IF EXISTS sale_payments;
CREATE TABLE sale_payments (
  sale_id    INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  method     TEXT    NOT NULL CHECK (method IN ('cash', 'mpesa', 'card', 'cheque', 'account')),
  amount     INTEGER NOT NULL,
  reference  TEXT,                                -- M-Pesa code, card approval, cheque no.
  PRIMARY KEY (sale_id, line_no)
);
CREATE INDEX idx_sale_payments_method ON sale_payments (method);

CREATE VIEW v_payments_by_method AS
SELECT b.code AS chemist, date(s.created_at / 1000, 'unixepoch', 'localtime') AS day, p.method, SUM(p.amount) AS amount_cents
FROM sale_payments p JOIN sales s ON s.id = p.sale_id JOIN branches b ON b.id = s.branch_id
WHERE s.status != 'voided'
GROUP BY b.code, day, p.method;

-- OTC bill line details.
ALTER TABLE sale_lines ADD COLUMN form TEXT;          -- dosage form, e.g. TAB, SYP
ALTER TABLE sale_lines ADD COLUMN instruction TEXT;   -- how to take it, e.g. 1x3 for 5 days
ALTER TABLE sale_lines ADD COLUMN batch TEXT;
ALTER TABLE sale_lines ADD COLUMN expiry TEXT;        -- as typed, dd-mm-yyyy

-- Product lines of quotations, delivery notes, invoices and credit notes.
CREATE TABLE document_lines (
  document_id  INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  product_id   INTEGER REFERENCES products (id) ON DELETE SET NULL,
  name         TEXT    NOT NULL,
  sku          TEXT,
  qty          REAL    NOT NULL,
  cost         INTEGER NOT NULL DEFAULT 0,   -- cost rate (cents)
  rate         INTEGER NOT NULL DEFAULT 0,   -- sales rate (cents)
  vat_pct      REAL    NOT NULL DEFAULT 0,
  vat          INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  batch        TEXT,
  expiry       TEXT,
  src_doc_type TEXT,                          -- the document it was adjusted from
  src_doc_no   TEXT,
  src_line     INTEGER,
  PRIMARY KEY (document_id, line_no)
);
CREATE INDEX idx_document_lines_product ON document_lines (product_id);
CREATE INDEX idx_document_lines_src     ON document_lines (src_doc_type, src_doc_no);
