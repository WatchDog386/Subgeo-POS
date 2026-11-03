-- 007_service_bills.sql — a Service Request/Bill is a sale filed under its
-- service number. Derived table: refilled on boot (RELATIONAL_VERSION 4).
ALTER TABLE sales ADD COLUMN service_bill INTEGER NOT NULL DEFAULT 0 CHECK (service_bill IN (0, 1));
ALTER TABLE sales ADD COLUMN doc_label TEXT;   -- e.g. SER-BILL-3-26 (NULL for OTC bills)
