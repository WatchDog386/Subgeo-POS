# Handover checklist

## What runs where

- **Server:** `https://pos.subgeoholding.com` (Ubuntu, pm2 process `subgeo-pos`, database `~/Subgeo-POS/data/subgeo.db`).
- **Tills:** Chrome or Edge at that address. Each till keeps a copy of its chemist, so it keeps selling offline and uploads when the connection returns.
- **The three dashboards:**

| Sign in as | Dashboard | Sees |
|---|---|---|
| `admin` | Admin | Every chemist: sales, stock value, debtors, staff, reports, chemists, transfers |
| a cashier (e.g. `subgeo`) | Cashier / pharmacy | Own chemist: OTC bills and returns, service bills, whole-sale documents, reports |
| `purchase` (no password) | Purchases | Own chemist: indents, LPOs, GRNs, Pur/GRN direct invoices (with PDF upload), medicine list, petty cash |

## How the data moves (all automatic)

1. **Purchase** receives stock (*Pur/GRN (Direct Invoice)*, by typing or with **Upload Supplier Invoice (PDF)**).
   - Stock and cost go up on that till.
   - The change uploads within seconds.
2. **Cashier** tills download it within ~15 s, and the medicines appear on the bill and Sell screens with their stock.
   - A bill can't sell more than is in stock, or a medicine that isn't in the list.
   - Each bill takes stock off and counts in the open shift's cash-up.
3. **Admin** sees every bill and service bill in:
   - *Utilities → Chemists* (today / month / stock value);
   - the reports (Daily Sales, Cash Collection, OTC Medicine Issue…);
   - the module registers.
4. **Purchase** sees the stock after the sales in *Modules → Medicine* (column *Qty In Stock*), and *Home → To-Do List* shows what has run out.

## Deploying an update

```bash
cd ~/Subgeo-POS && bash deploy.sh
```
Then check with `npm run db:status`: every migration should be `applied`. If tills don't show the update, press Ctrl+Shift+R on each one.

## Before go-live

- [ ] Change the `admin` password (*Utilities → User Management*).
- [ ] Rename *CHEMIST 1* to the real chemist name (*Utilities → Chemists → Edit Selected*).
- [ ] Set company name, KRA PIN, receipt footer, M-Pesa till and licence dates (*Utilities → Default Values Management*).
- [ ] Create each chemist's cashier / manager / purchase accounts ([PHARMACY-SETUP.md](PHARMACY-SETUP.md)).
- [ ] Receive the opening stock (upload the supplier PDFs, or Medicine / Inventory).
- [ ] Open a shift on each till, make one test bill, check it on the admin Chemists page, then refund it.
- [ ] Schedule a daily `npm run db:backup` on the server.

More detail: [PHARMACY-SETUP.md](PHARMACY-SETUP.md) (per-pharmacy setup) and [DATABASE.md](DATABASE.md) (tables and rules).
