# Subgeo POS

Point-of-sale and inventory system for a **motorbike / e-bike spare parts shop** in Kenya. It works offline, takes M-Pesa, cash, card and credit payments, and drives standard receipt-printer hardware.

![Sell screen](docs/screenshots/sell.png)

## What it does

| Area | Features |
|---|---|
| **Sell** | Tap-to-add product grid with colour-coded categories. Search by name, SKU, OEM part number or barcode. A **"Fits bike model" filter** shows only parts for the customer's bike. Barcode scanner support, park/resume sales, cart and line discounts, custom/labour items, serial capture for batteries, controllers and chargers. Keyboard shortcuts (F2 search, F4 customer, F8 park, F9 charge). |
| **Payments** | Cash with quick-note buttons and change. **M-Pesa** by manual code entry (no setup needed) or **STK Push** through Safaricom Daraja. Card by approval code from a standalone PDQ. On account (credit) with credit limits. Split tender. |
| **Receipts** | 58/80 mm ESC/POS printing over USB, Serial/Bluetooth or LAN. Cash drawer kick. Browser-print fallback. Receipts can be sent by WhatsApp. KRA PIN and VAT breakdown. |
| **Sales history** | Search by receipt, customer, M-Pesa code or serial number. Reprint. Full or partial refunds, with optional restock. |
| **Inventory** | Parts with SKU, barcode, OEM number, brand, bin location, fitment, cost/price/margin and reorder level. Stock count, adjustment and write-off, all logged with a per-part stock history. CSV import/export. |
| **Purchasing** | Suppliers and purchase orders. **Auto-reorder** drafts a PO for everything below its reorder level. Receive full or partial deliveries straight into stock (this also updates cost price). |
| **Service jobs** | Workshop board (booked in → being worked on → waiting for parts → ready). Records parts used and labour, then **bills at the till** in one tap. |
| **Customers** | Rider profiles (phone, bike, plate), purchase history, account balances and payments received. |
| **Shifts** | Open with a float, record cash in/out, blind cash-up with over/short, printed Z report. |
| **Reports** | Net sales, gross profit and margin, VAT collected (for KRA), takings by payment method, daily trend, top sellers, sales by category, reorder list. CSV export. |
| **Staff** | User name + password sign-in. Admin (all chemists), manager and cashier roles; each cashier belongs to one chemist. |
| **Chemists** | Any number of chemists (CHEM1, CHEM2, …), each with its own stock and sales; live all-chemists monitoring, medicine-list copy and stock transfers. |
| **Data** | Company database on the server, synced with a local copy on every till so it keeps selling through internet and power cuts. JSON backup and restore per chemist. |

More screens: [payment](docs/screenshots/payment.png) · [receipt](docs/screenshots/receipt.png) · [inventory](docs/screenshots/inventory.png) · [reports](docs/screenshots/reports.png) · [shift](docs/screenshots/shift.png) · [service](docs/screenshots/service.png)

## Quick start

```bash
npm install
npm run build          # build the app into dist/
npm run server:start   # serves the app + M-Pesa/printer API on http://localhost:8787
```

Open `http://localhost:8787` in **Chrome or Edge**. Starter accounts:

| User name | Password | Role |
|---|---|---|
| `admin` | `subgeo22` | Admin — sees and manages every chemist |
| `subgeo` | `0000` | Cashier of **CHEM1** |
| `purchase` | *(none)* | Purchases dashboard of **CHEM1** (indents, LPOs, GRNs, medicine master, petty cash) |

Setting up each pharmacy (chemist, staff, medicines, till) is described step by step in **[docs/PHARMACY-SETUP.md](docs/PHARMACY-SETUP.md)**. The tables and their relations are in **[docs/DATABASE.md](docs/DATABASE.md)**.

Change the passwords after the first sign-in (*Profile → Security*, or *Utilities → User Management*).

To develop, run `npm run dev` (Vite on :5173) and `npm run server` (API on :8787, proxied).

```bash
npm test               # unit + database tests (vitest, fake IndexedDB)
npm run typecheck
```

### Configuration

- **Shop details, VAT, receipt footer, bike models, staff and hardware:** in the app, under *Settings*.
- **M-Pesa STK Push:** copy `.env.example` to `.env` and fill in your Daraja credentials. See [docs/MPESA.md](docs/MPESA.md).
- **Hardware:** see [docs/HARDWARE.md](docs/HARDWARE.md) for the recommended bundle and setup.

## Several chemists (branches)

The admin runs any number of chemists from one company database. Each chemist has its **own medicines, stock, sales, customers, shifts and documents**; staff, chemists, categories, suppliers and shop settings are company-wide.

1. **Create the chemist** — admin → *Utilities → Chemists (Branches)* → *Create a new chemist*. The number you give it becomes its code: chemist 2 is **CHEM2**.
2. **Create its cashier** — *Utilities → User Management*: user name, password, role *CASHIER* and **Chemist No.** (e.g. CHEM2). A cashier only ever signs in to their own chemist and only sees its stock.
3. **Key in its stock** — on the Chemists page select the chemist and press *Key in Medicines / Stock* (this opens that chemist; the header shows `SUBGEO CHEMIST LTD-CHEM2` and a *Chemist* switcher). Add medicines with opening stock, or receive purchase orders. To start quickly, *Copy medicine list* from another chemist (prices copied, stock 0) and then receive stock.
4. **Monitor** — the Chemists page and *Home → Statistics* show every chemist live: today's and this month's sales, bills, stock value, low/out-of-stock counts, debtors, open shift and cashiers. *Home → To-Do List* (tick *Show Team Tasks*) lists work waiting in all chemists.
5. **Move stock** — *Transfer stock between chemists* on the Chemists page moves quantities from one chemist to another; both stock ledgers record it.

When a cashier signs in, the title reads `SUBGEO CHEMIST LTD-CHEM<number>` and every bill/receipt is stamped with the chemist.

### How data is kept

- The server keeps the **company database** (SQLite, `data/subgeo.db`). Tills sync through `sync_records`; every change is also written to proper relational tables (branches, users, products, sales, sale_lines, sale_payments, documents, staff_tasks, …) with foreign keys and report views. See [docs/DATABASE.md](docs/DATABASE.md). `npm run db:rebuild` rebuilds them at any time.
- Every till keeps a local copy of its chemist (IndexedDB) so it **keeps selling with no internet**. Changes upload a second or two after they happen (or when the connection returns) and other tills pick them up within ~15 s. The header badge shows *Online / Offline* and how many changes are waiting; *Utilities → OffLine/OnLine Synchronization* has *Sync Now*.
- Stock and customer balances merge by quantity, so a sale at the till and a delivery keyed in by the admin at the same moment both count.
- `npm run db:status` prints record counts per table and chemist; `npm run db:backup` snapshots the database.

## Architecture

```
Browser (Chrome/Edge, installable PWA)        server/ (Node + Express)
 ├─ React + Tailwind UI                         ├─ serves dist/
 ├─ Dexie (IndexedDB), one DB per chemist  ⇄    ├─ /api/auth/*   sign-in (user name + password)
 │   └─ src/db/sync.ts  push/pull changes        ├─ /api/sync/*   push/pull of every chemist's records (SQLite)
 ├─ ESC/POS encoder  → WebUSB / Web Serial      ├─ /api/admin/*  all-chemists overview, copy list, transfers
 └─ HID barcode-scanner listener                ├─ /api/mpesa/*  Daraja STK Push + callback + query
                                                └─ /api/print    relays ESC/POS bytes to LAN printers :9100
```

- `src/db/`: schema, sync engine, sales/refund/stock transactions, shifts, purchasing, staff, seed data
- `src/lib/`: cart maths (VAT-inclusive or exclusive, discount apportioning), ESC/POS, printer transports, M-Pesa client, CSV
- `src/pages/`: one file per screen
- `server/`: company database + sync API (`sync.ts`, `migrations/`), Daraja client and the printer relay

Money is stored as integer cents. Every stock change goes through a logged movement (sale, refund, receive, adjust, damage, count).

## Roadmap / not yet built

- **KRA eTIMS** electronic tax invoices (needed for VAT-registered businesses). The receipt and VAT data are already in place; the next step is an eTIMS OSCU/VSCU integration on the server.
- Barcode label printing for parts that arrive without barcodes.
- Customer SMS (Africa's Talking) for "your bike is ready" and receipts.

See [docs/UX-RESEARCH.md](docs/UX-RESEARCH.md) for the retail POS patterns this design draws on.
