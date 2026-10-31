# Company database

One server database holds every chemist (pharmacy) of the company. Each till
(browser) also keeps its own copy of its chemist, so it keeps selling when the
internet or the server is down.

```
 Till (Chrome/Edge)            Server (Node + SQLite, data/subgeo.db)
 IndexedDB, one per chemist     ┌───────────────────────────────────────────────┐
 ─ works offline ─              │ sync_records   every record as JSON            │
    push ⇄ pull every 15 s ───► │   (what the tills sync with; source of truth)  │
    and 1.5 s after a change    │        │ server/relational.ts, on every write   │
                                │        ▼                                       │
                                │ relational tables with foreign keys            │
                                │   (for reports, exports, SQL)                  │
                                └───────────────────────────────────────────────┘
```

- **Migrations:** `server/migrations/*.sql`. They run on server start and with
  `npm run db:migrate`. `004_relational.sql` creates the relational tables;
  `005_document_lines.sql` adds document lines, cheque payments and the OTC
  line details.
- **Rebuild:** `npm run db:rebuild` empties the relational tables and rebuilds
  them from `sync_records`. It is safe to run at any time; the tills don't notice.
  The server also rebuilds by itself after an update that changes how records
  are mapped.
- **Status:** `npm run db:status` shows the migrations and the row count of
  every table and chemist.
- **Money** is stored as INTEGER **cents** (KES × 100). **Times** are INTEGER
  milliseconds since 1970. **Ids** are the tills' ids, so a row here is the
  same record as on every till.

## Tables

### Company-wide

| Table | What it holds | Key relations |
|---|---|---|
| `branches` | The chemists: number (1 → `CHEM1`), name, location, phone, active | — |
| `users` | Staff: user name, name, role (`owner` = admin, `manager`, `cashier`, `purchase`), chemist, active. Password hashes are **not** copied here. | `branch_id → branches` (NULL for the admin) |
| `categories` | Medicine groups | — |
| `suppliers` | Vendors / suppliers (Party Master, suppliers) | — |
| `staff_messages` | Messages between staff (*Messages* page) | `from_id`, `to_id → users` (to NULL = everyone) |
| `staff_message_reads` | Who has opened which message | `message_id → staff_messages`, `user_id → users` |

### Per chemist (every row has `branch_id → branches`)

| Table | What it holds | Key relations |
|---|---|---|
| `products` | Medicines and services: SKU, barcode, prices, stock, re-order level | `category_id → categories`, `supplier_id → suppliers` |
| `stock_movements` | Every stock change: sale, refund, receive, adjust, damage, count, transfer | `product_id → products`, `user_id → users` |
| `customers` | Customers / debtors and what they owe | — |
| `shifts` | Day shifts: float, counted and expected cash | `user_id → users` |
| `shift_cash_movements` | Cash in / out during a shift | `shift_id → shifts` |
| `sales` | Bills and refunds (a refund has a negative total) | `customer_id`, `user_id`, `shift_id`, `refund_of → sales` |
| `sale_lines` | Medicines on a bill, with type (dosage form), instruction, batch and expiry | `sale_id → sales`, `product_id → products` |
| `sale_payments` | How a bill was paid: cash, mpesa, card, cheque, account (with the M-Pesa code / card or cheque no.) | `sale_id → sales` |
| `parked_sales`, `parked_sale_lines` | Bills put on hold at the till | `customer_id`, `user_id`, `product_id` |
| `purchase_orders`, `purchase_order_lines` | Purchase orders and what has been received | `supplier_id`, `product_id` |
| `service_jobs`, `service_job_lines` | Service requests and the items used | `customer_id`, `sale_id → sales` (the bill), `product_id` |
| `documents` | One row per document of a transaction screen: purchase indent, LPO, GRN, Pur/GRN direct invoice, petty cash voucher, supplier payment, quotation, delivery note, whole-sale invoice, credit note, medicine master… `doc_type` is the screen, `values_json` holds every field | `supplier_id → suppliers` / `customer_id → customers` (matched by the name on the document), `created_by → users`; `ref_doc_no` = the document it follows (LPO → indent no., GRN → LPO no.) |
| `document_lines` | Product lines of quotations, delivery notes, whole-sale invoices and credit notes: qty, cost, sales rate, VAT, discount, total, batch, expiry, and the document line it was adjusted from (`src_doc_type`, `src_doc_no`, `src_line`) | `document_id → documents`, `product_id → products` |
| `staff_tasks` | Tasks assigned on *Home → To-Do List → Task To-Do* | `assigner_id`, `assignee_id → users` (assignee NULL = everyone at the chemist) |
| `activity_logs` | Audit log: sign-ins, sales, stock, settings, reviews… | `user_id → users` |
| `app_values` | Settings, default values, running document numbers. `branch_id` NULL = company-wide | — |

### Rules the database enforces

- Foreign keys are switched on. A reference to a record that was deleted (or
  hasn't arrived yet) is set to **NULL**, so history such as old bills and
  stock movements is never lost.
- `CHECK` constraints: roles, sale and order statuses, payment methods,
  movement reasons, 0/1 flags, and a chemist number of 1 or more.
- Unique: chemist number and code, user name.
- SKUs are indexed but **not unique** per chemist, because two offline tills
  of the same chemist may briefly create the same code.

### Report views

| View | Shows |
|---|---|
| `v_stock` | Every active medicine per chemist with category, supplier, stock value and a `below_reorder` flag |
| `v_daily_sales` | Bills and takings per chemist per day |
| `v_payments_by_method` | Takings per chemist, day and payment method |
| `v_debtors` | Customers who owe money |
| `v_purchase_flow` | Each purchase indent, its LPO and GRN, and its stage (`INDENTED` / `ORDERED` / `RECEIVED`) |

Example queries. Run them on the server with `sqlite3 data/subgeo.db`; install the tool once with `sudo apt install sqlite3`:

```sql
-- Today's takings per chemist
SELECT * FROM v_daily_sales WHERE day = date('now', 'localtime');

-- Medicines to re-order at CHEM2
SELECT name, stock, reorder_level, supplier FROM v_stock WHERE chemist = 'CHEM2' AND below_reorder = 1;

-- Best sellers this month, all chemists
SELECT l.name, SUM(l.qty) AS qty, SUM(l.qty * l.unit_price - l.discount) / 100.0 AS kes
FROM sale_lines l JOIN sales s ON s.id = l.sale_id
WHERE s.status != 'voided' AND s.created_at >= strftime('%s', 'now', 'start of month') * 1000
GROUP BY l.name ORDER BY qty DESC LIMIT 20;

-- Purchase indents still waiting for an LPO
SELECT chemist, indent_no, indent_date FROM v_purchase_flow WHERE stage = 'INDENTED';
```

## How the three dashboards share the data

| Data | Admin | Cashier / pharmacy | Purchase |
|---|---|---|---|
| Chemists, staff | creates and edits | reads | reads |
| Suppliers, categories | edits | edits | edits |
| Medicines, stock | every chemist | own chemist | own chemist (Medicine master, GRN) |
| Bills, refunds, shifts | every chemist | own chemist | — |
| Purchase indents, LPOs, GRNs, direct invoices, petty cash | every chemist | own chemist | own chemist |
| Tasks | assigns, every chemist | sees own and everyone's | sees own and everyone's; marks done |
| Messages | sends / receives | sends / receives | sends / receives |
| Shared settings, default values | edits | reads | reads |

The server checks every upload. A cashier or purchase account can only write
to their own chemist, only the admin can manage staff and chemists, and only
the sender can change a message (anyone it was sent to can mark it read). If
the server refuses a change, the till puts the server's copy back and shows
*"Server refused …"*.

**When two tills change the same record:**

- **Stock and customer balances** are added together, so a sale and a
  delivery keyed in at the same moment both count.
- **Running document numbers** never go backwards.
- **Anything else:** the later change wins.
- **Documents, tasks and messages** are one record each, so two tills saving
  different documents at the same time never overwrite each other.

## What the cashier's documents do

| Document | Stock | Customer account (when *Accounts?* is ticked) |
|---|---|---|
| Sales Quotation | — | — |
| Delivery Note | goes **out** | — |
| Whole Sale Invoice | goes out, except lines adjusted from a delivery note (already out) | **charged** the invoice total |
| Credit Note / Credit Note - Direct Invoice | comes **back** | **credited** the total |
| OTC Medicine Issue/Bill | goes out | the unpaid part, when a patient is named |
| OTC Medicine Isse Return | comes back | the refund goes out in cash / M-Pesa / card / cheque |

Editing a document undoes its old stock and account effects before the new
version is applied. Deleting it undoes them too. *ADJUST* only offers
quantities that are still pending: what has not yet been carried into a later
document, or not yet returned.

## Upgrading from an older version

Older versions kept each screen's documents and the task list as **one list**
per screen. After this update:

- **Each till** converts its own lists into one record per document or task
  the first time it opens.
- **The server** converts its copy on start-up, and again whenever a till
  that is still on the old version uploads a list.
- Both use the same ids for the same entry, so nothing is counted twice.
- The sample rows that very old versions planted in the registers are left out
  (`src/db/legacyDemo.ts` lists them only so they can be recognised).
- Backups made with older versions are converted when you restore them.

Nothing needs doing by hand. `npm run db:status` shows the new tables filling up.
