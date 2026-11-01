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

## Back button

Every page has **◀ Back** at the start of the tab bar. It closes an open pop-up first (a pop-up also has its own ◀ Back), leaves an entry screen to its list (like *Back (F3)*), and otherwise goes to the previous page, or to Home.

## Screen sizes

The POS fits any desktop monitor, including 1024×768, 1280×1024, 1366×768, 1920×1080 and larger, and Windows display scaling of 125% or 150%. Nothing is cut off; long tables scroll inside their own box.

- **1501px wide and up:** the full layout.
- **1280–1500px:** the admin header is tighter, without the EMR-lite logo.
- **1100–1279px:** the admin tool icons move to a second header row, and the side menu is a little narrower.
- **901–1099px** (a 1024 monitor, or 1366 at 125%): the side menu opens from **☰ Menu** on the tab bar, so the work area uses the whole width.
- **900px and below:** the phone layout (below).

If a till still looks cut after an update, press Ctrl+Shift+R, then check the browser zoom is 100% (Ctrl+0).

## Using it on a phone

Open `https://pos.subgeoholding.com` on the phone's browser (Chrome or Safari) and sign in as usual. On screens up to 900px wide (phones, and tablets held upright), the layout changes for touch. Desktop computers and tills keep the same layout as before.

- **☰ Menu** (first button on the tab bar) opens the side menu (module groups, reports, utilities). Tap a page or the dark area to close it. Opening *Modules* shows the menu straight away.
- **Admin header:** the **Chemist** switch has its own row, and the tool icons scroll sideways.
- **Tables** scroll sideways inside their box. **Double-tap** a row to open it, like a double click.
- **Forms** show one label and one field per line. Pop-up windows fill the width of the screen.
- **Fullscreen:** the phone never switches to fullscreen on the first tap (the tills still do). The *Full screen* icon still works.
- To put an icon on the home screen: in Chrome use *⋮ → Add to Home screen*; in Safari use *Share → Add to Home Screen*.

## Stock limits and the Best Price

**Where to type it:** the **Best Price** column sits right after **Selling Price** on *Pur/GRN (Direct Invoice)* → PRODUCT DETAILS, on *Stock Adjust +(DBH)*, on the supplier PDF upload review, and on the *Medicine* form (under Retail Sale Price).

**Medicines already recorded:** the admin (or purchase) opens *Modules → STOCK ADJUSTMENTS → Medicine Prices (Best Price)* (also on *Home → Quick Access*). It is one table of every medicine of the chemist open in the header (for example SUBGEO12), with Selling Price, Best Price and Whole Sale Price typed in place. *Only without Best Price* lists the ones still to do. **Save Changes (F2)** saves them all. A row that can't be saved (Best Price above the Selling Price, a % instead of an amount, a Whole Sale Price below the Best Price) is marked in red.

Set these for each medicine in *Modules → Medicine* (select it → edit), or on the *Inventory* screen:

| Field | What it does |
|---|---|
| **Best Price** | The lowest price the medicine may be sold for, typed as an amount in KES (not a %). The seller offers the **Selling Price** first; if the customer complains, they may come down to the Best Price, never below it. The tills refuse anything below it: a lower price, a line discount, the Pharma %, a bill discount or a whole-sale invoice. On the OTC bill and whole-sale screens the Best Price shows next to the selling price; clicking it puts that line on the Best Price. On the Sell screen, tapping a line shows it with a **Use Best Price** button. |
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
