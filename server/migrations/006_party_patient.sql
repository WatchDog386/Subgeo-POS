-- 006_party_patient.sql — Party Master details on customers and suppliers,
-- and PATIENT INFORMATION on OTC / service bills. Derived tables: the server
-- refills them on boot (RELATIONAL_VERSION 3).
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN po_box TEXT;
ALTER TABLE customers ADD COLUMN kra_pin TEXT;
ALTER TABLE customers ADD COLUMN contact_person TEXT;
ALTER TABLE customers ADD COLUMN contact_phone TEXT;
ALTER TABLE customers ADD COLUMN group_account TEXT;
ALTER TABLE customers ADD COLUMN bill_type TEXT CHECK (bill_type IS NULL OR bill_type IN ('PAY LATER', 'PAY NOW'));
ALTER TABLE customers ADD COLUMN blacklisted INTEGER NOT NULL DEFAULT 0 CHECK (blacklisted IN (0, 1));

ALTER TABLE suppliers ADD COLUMN address TEXT;
ALTER TABLE suppliers ADD COLUMN po_box TEXT;
ALTER TABLE suppliers ADD COLUMN kra_pin TEXT;
ALTER TABLE suppliers ADD COLUMN contact_person TEXT;
ALTER TABLE suppliers ADD COLUMN contact_phone TEXT;
ALTER TABLE suppliers ADD COLUMN group_account TEXT;
ALTER TABLE suppliers ADD COLUMN bill_type TEXT CHECK (bill_type IS NULL OR bill_type IN ('PAY LATER', 'PAY NOW'));
ALTER TABLE suppliers ADD COLUMN blacklisted INTEGER NOT NULL DEFAULT 0 CHECK (blacklisted IN (0, 1));

ALTER TABLE sales ADD COLUMN location TEXT;
ALTER TABLE sales ADD COLUMN patient_name TEXT;
ALTER TABLE sales ADD COLUMN patient_age TEXT;
ALTER TABLE sales ADD COLUMN patient_phone TEXT;
