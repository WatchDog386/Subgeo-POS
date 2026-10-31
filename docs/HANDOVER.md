# Handover checklist

## What runs where

- **Server:** `https://pos.subgeoholding.com` (Ubuntu, pm2 process `subgeo-pos`, database `~/Subgeo-POS/data/subgeo.db`).
- **Tills:** Chrome or Edge at that address. Each till keeps a copy of its chemist, so it keeps selling offline and uploads when the connection returns.
- **The three dashboards:**

| Sign in as | Dashboard | Sees |
|---|---|---|
| `admin` | Admin | Every chemist: sales, stock value, debtors, staff, reports, chemists, transfers |
| `subgeo` + the chemist's password (`0001` = SUBGEO1 … `0012` = SUBGEO12, `0000` = HQ) | Cashier / pharmacy | Own chemist: OTC bills and returns, service bills, whole-sale documents, reports |
| `purchase` | Purchases (run by the admin) | The admin's rights over **every** chemist, with the purchases menu first: indents, LPOs, GRNs, Pur/GRN direct invoices (with PDF upload), medicine list, petty cash. The **Chemist** switcher in the header picks which pharmacy's stock and records you work on. Signs in with `purchase` / `subgeo22`. |

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
4. **Admin or purchase** correct the stock with *Modules → STOCK ADJUSTMENTS*:
   - **Stock Adjust -** takes stock off (Expiry, Damage, Loss / Theft, Count Shortage…);
   - **Stock Adjust +(DBH)** adds it (Opening Stock, Count Excess, Found…).
   Both are also on *Home → Quick Access*. Each one is filed with its number, and the stock ledger records why.
5. **Purchase** sees the stock after the sales in *Modules → Medicine* (column *Qty In Stock*), and *Home → To-Do List* shows what has run out.

## Stock limits and the minimum selling price

Set these for each medicine in *Modules → Medicine* (select it → edit), or on the *Inventory* screen:

| Field | What it does |
|---|---|
| **Min Selling Price** | The lowest price the medicine may be sold for. Nothing can be sold below it: not by changing the price, a line discount, the Pharma % or a bill discount, on OTC bills, the Sell screen or whole-sale invoices. The retail and whole-sale prices, a GRN's Retail Price and a Stock Adjust +'s Selling Price can't be set below it either. |
| **Re-order Level** | When stock falls to this, the medicine shows on the To-Do lists and the re-order report. |
| **Max Level** | The most to hold. Re-order suggestions top up to this level, and receiving more than it (GRN or PDF upload) asks first. Leave it blank for no limit. |

## The twelve chemists (run once)

```bash
cd ~/Subgeo-POS && npm run setup:subgeo
```
This creates **SUBGEO1 … SUBGEO12** and the head-office pharmacy **HQ** (cashier `subgeo` / `0000`). The chemist that was number 1 becomes **SUBGEO12**, keeping all its medicines, sales and staff (including the `purchase` account). Each chemist gets a cashier who signs in as **`subgeo`** with password **`0001` … `0012`**; the password decides which chemist opens. Running it again changes nothing.

Then, as admin, open *Utilities → Chemists (Branches)*, select each SUBGEO and press **Edit Selected** to type its real **name and location**. To give another chemist a purchases account, create it in *Utilities → User Management* with its own user name (e.g. `purchase2`). Only cashiers and managers can share a user name.

## Deploying an update

```bash
cd ~/Subgeo-POS && bash deploy.sh
```
Then check with `npm run db:status`: every migration should be `applied`. If tills don't show the update, press Ctrl+Shift+R on each one.

## Before go-live

- [ ] `admin` and `purchase` both sign in with `subgeo22` and both have full rights over every pharmacy: change those passwords before go-live (*Utilities → User Management*).
- [ ] Run `npm run setup:subgeo` once, then key in each SUBGEO's name and location (*Utilities → Chemists → Edit Selected*).
- [ ] Set company name, KRA PIN, receipt footer, M-Pesa till and licence dates (*Utilities → Default Values Management*).
- [ ] Create each chemist's cashier / manager / purchase accounts ([PHARMACY-SETUP.md](PHARMACY-SETUP.md)).
- [ ] Receive the opening stock (upload the supplier PDFs, or Medicine / Inventory).
- [ ] Open a shift on each till, make one test bill, check it on the admin Chemists page, then refund it.
- [ ] Schedule a daily `npm run db:backup` on the server.

More detail: [PHARMACY-SETUP.md](PHARMACY-SETUP.md) (per-pharmacy setup) and [DATABASE.md](DATABASE.md) (tables and rules).
