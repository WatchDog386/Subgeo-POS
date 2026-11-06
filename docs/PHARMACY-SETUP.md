# Setting up a pharmacy (chemist)

All pharmacies run from **one server** (`https://pos.subgeoholding.com`) and
**one company database**. Every pharmacy is a *chemist*, numbered `SUBGEO1`,
`SUBGEO2`, `SUBGEO3`… Each chemist has its own medicines, stock, bills, customers,
shifts, documents and tasks. Staff, suppliers, categories and the shop
settings are shared by the whole company.

There is no demo data. Every list starts empty, and each entry box shows a
greyed hint of what to type.

---

## Part A. Once for the company (already done if the server is live)

1. **Server.** On the Ubuntu server, run these once: `deploy/provision.sh`,
   then `bash deploy.sh`, then `sudo bash deploy/host.sh` (see the scripts).
   After every code update, run:
   ```bash
   cd ~/Subgeo-POS && bash deploy.sh
   ```
   `deploy.sh` pulls the code, builds it, runs the database migrations
   (including the relational tables) and restarts the app.
2. **Check the database.**
   ```bash
   cd ~/Subgeo-POS && npm run db:status
   ```
   You should see `004_relational.sql: applied` and the tables `branches`,
   `users`, `products`, `sales`, `documents`… with row counts.
3. **Sign in as the admin** (`admin` / `subgeo22`) and **change the password
   straight away**: *Utilities → User Management* → select `admin` →
   *Edit Profile* → new password → *Submit*.
4. **Company details:** go to *Utilities → Default Values Management*. Double-click
   a row (or select it and press *Update Value*) to change it. Set:
   - **Company Name** (printed on every bill), **Shop Name**, **Address**,
     **Phone No**, **KRA Pin**, **Receipt Footer**, **M-Pesa Till**
   - **Bill Prefix**, e.g. `CHPL-OTC`, and **Service Prefix**
   - **Licenced From / Licenced To** (`dd-mm-yyyy`). These show under the
     company name in the header.
5. **Suppliers:** *Modules → Party Master → +* (type **SUPPLIERS**). Add the
   suppliers you buy from, with their phone numbers. They are shared by every
   chemist. Any vendor you type on an LPO, GRN or direct invoice for the first
   time is added automatically.
6. **M-Pesa:** set the **M-Pesa Till** in Default Values. Cashiers type the
   customer's confirmation code on each bill (there is no phone prompt).

---

## Part B. For each pharmacy

Do these steps as the **admin**. Replace `N` with the chemist's number.

### 1. Create the chemist

1. Go to *Utilities → Chemists (Branches)* → **New Chemist**.
2. Fill in:
   - **Chemist No.:** the next free number, e.g. `2`.
   - **Chemist Code:** leave it blank to use the default `SUBGEO2` (HQ for
     number 100), or type a name of your choice, e.g. `KAYOLE`. The code is
     what the header, the Chemist switch, reports and receipts show. It must
     be unique and can't be another number's default (e.g. `SUBGEO5` for
     chemist 2). To go back to the default, edit the chemist, press **Use
     default** and save.
   - **Name:** e.g. `SCL KAYOLE`
   - **Location**, **Phone**
   - **Status:** active
3. Save. The new chemist starts with no medicines, bills or documents.

> The very first chemist already exists as **CHEMIST 1** (`SUBGEO1`). Select it
> → **Edit Selected** and give it its real name and location.

### 2. Open the chemist and set its own values

1. On the Chemists page, select the chemist and press *Key in Medicines /
   Stock*. Or use the **Chemist** switcher in the admin header. The header now
   reads `… -SUBGEON`.
2. Go to *Utilities → Default Values Management* and set the values that
   belong to **this chemist only**:
   - **Location (this chemist):** its main store, e.g. `SCL KAYOLE`
   - **Stock Locations (this chemist):** comma-separated, e.g.
     `MAIN STORE, SHELF A, FRIDGE`

### 3. Create its staff

Go to *Utilities → User Management* → **Add Profile** and create one profile
for each person:

| Who | Role | Chemist No. | Password |
|---|---|---|---|
| Counter / cashier | **CASHIER** | `SUBGEON` | at least 4 characters. Cashiers of different chemists may all use the user name `subgeo`, each with a different password (`npm run setup:subgeo` makes `0001` … `0012`) |
| Pharmacist in charge | **MANAGER** | `SUBGEON` | at least 4 characters |
| Buyer (purchases dashboard) | **PURCHASE** | `SUBGEON` | at least 4 characters |

- The **User Name** must be unique in the company, e.g. `kayole.cash1`,
  `kayole.purchase`.
- Every account except the admin belongs to exactly **one** chemist. It
  signs in to that chemist only, and the server refuses anything it tries to
  change elsewhere.
- To move someone to another chemist, edit the profile and change
  **Chemist No.**. To stop someone signing in, untick
  *Active (can sign in)*. Never delete staff who have made bills.

### 4. Put in its medicines and opening stock

Pick whichever method suits you:

- **Copy another chemist's list:** on the Chemists page, use *Copy medicine
  list to a chemist*. Names, codes and prices are copied with stock 0. Then
  receive the stock (next point).
- **Admin or purchases dashboard:** *Modules → Medicine* → **+**. On the
  **PRODUCT** tab, fill in Product Name, Product Group, UOM, Pack Size,
  Stock/Non-Stock (`S`/`N`), Moleculor Name, Product Type, Preffered
  Supplier, Cost Rate, Markup% (fills the retail price from the cost), Retail
  Sale Price, **Best Price**, Whole sale price and VAT ?. On the **DETAIL** tab, fill in the
  Barcode, Re-order Level and Max Level. Then press
  **Save (F2)**.
- **To change a medicine:** select it in the list and press *Edit* (the
  pencil). With nothing selected, *Edit* opens **Search Medicine**: type part
  of the name or code and pick it. Its details open with **Status** and ← →
  to step to the previous or next medicine. Change them and press **Save**.
- **To see everything:** the eye next to **+** shows all the medicines on one
  page. Select one and press the eye to see all its details.
- **Import a CSV:** *Utilities → Data Management* → import products.
- **Opening stock:** *Modules → STOCK ADJUSTMENTS → Stock Adjust +(DBH)* →
  **+**, choose the type **Opening Stock**, or receive a supplier invoice
  (*Pur/GRN (Direct Invoice)*).
- **Limits:** for each medicine, set the **Best Price** (nothing is
  sold below it), the **Re-order Level** and the **Max Level** in
  *Modules → Medicine* (see [HANDOVER.md](HANDOVER.md)). To set the selling
  and best prices of all medicines at once, use *Modules → STOCK ADJUSTMENTS →
  Medicine Prices (Best Price)*.

### 5. Set up the till computer

1. Open **Chrome or Edge** at `https://pos.subgeoholding.com` and sign in with
   the chemist's cashier account.
2. Install it as an app (the install icon in the address bar) so it opens
   full screen.
3. Printer and cash drawer: *Settings → Hardware* (see [HARDWARE.md](HARDWARE.md)).
4. The header badge should read **Online**. If it reads *Offline*, the till
   still sells and uploads everything once the connection comes back.

### 6. Check that the pharmacy is synchronised

1. **On the till:** make a test bill, then go to *Utilities → OffLine/OnLine
   Synchronization* and press **Sync Now**. The *waiting* count should drop
   to 0.
2. **On the admin dashboard:** the chemist's today's sales show on the
   Chemists page and on *Home → Statistics*.
3. **On the purchases dashboard** (PURCHASE account): *Home → To-Do List*
   shows low-stock medicines and open indents/LPOs for this chemist. Raise a
   test indent in *STEP 1: PURCHASE INDENT* and check that the admin sees it in
   the same register.
4. **On the server** (optional; install the SQL tool once with
   `sudo apt install sqlite3`):
   ```bash
   cd ~/Subgeo-POS && npm run db:status
   sqlite3 data/subgeo.db "SELECT * FROM v_daily_sales WHERE chemist = 'SUBGEON';"
   ```
5. Delete or refund the test bill if it should not count.

---

## Daily routine per pharmacy

| Who | Where | What |
|---|---|---|
| Cashier | *Shift* | Open the day with the float; close it with the counted cash (Z report) |
| Cashier | *Modules → OTC Medicine Issued/Bill* | Bills (or the *Sell* screen) |
| Purchase | *Home → To-Do List* | Work through low stock, indents to turn into LPOs, LPOs to receive |
| Purchase | *Modules → STEP 1 → STEP 2 → STEP 3* | Indent, then LPO (type the indent no.), then GRN (type the LPO no.). For supplier invoices without an LPO, use *Pur/GRN (Direct Invoice)* |
| Purchase | *Modules → Pur/GRN (Direct Invoice) → Upload Supplier Invoice (PDF)* | Receive a whole supplier invoice / proforma / sales order at once (see below) |
| Purchase | *Modules → Petty Cash Voucher* | Petty cash spent |
| Admin / Purchase | *Modules → STOCK ADJUSTMENTS → Stock Adjust -* | Take off expired, damaged or lost stock, or a count shortage |
| Admin / Purchase | *Modules → STOCK ADJUSTMENTS → Stock Adjust +(DBH)* | Add opening stock, a count excess or stock that was found |
| Admin | *Home → To-Do List → Task To-Do* | Assign tasks. They appear on the assignee's Home and move to *Pending-Completed* when done |
| Admin | *Utilities → Chemists* | Watch all chemists; transfer stock between chemists |
| Everyone | *Messages* | Messages to one person or to everyone; they reach every till |

## Backups

- **Server:** run `npm run db:backup` on the server. It copies
  `data/subgeo.db`, which holds every chemist. Run it daily, for example
  from cron.
- **One chemist:** go to *Utilities → Data Management* → backup, which
  downloads a JSON file. Restoring it replaces only that chemist's data.
- **Relational tables:** they can always be rebuilt from the synced records
  with `npm run db:rebuild`.

## Clearing a chemist's stock to key it in again

On the server (replace `12` with the chemist's number; HQ is `100`):

```bash
cd ~/Subgeo-POS && npm run stock:reset -- 12
```
This only shows what would be deleted. To delete it:
```bash
cd ~/Subgeo-POS && npm run stock:reset -- 12 --yes
```
It saves a backup in `backups/` first. It then deletes that chemist's medicines (services are kept), its stock history, and its Pur/GRN, STEP 3 GRN, Stock Adjust and Medicine-form records. Sales, customers, shifts, indents and LPOs are kept. The chemist's tills drop the old stock on their next sync. Run it when that chemist is not selling.

## When something looks wrong

| Problem | Fix |
|---|---|
| *"Server refused N change(s): …"* on a till | The account tried to change something it isn't allowed to (another chemist's data, staff, someone else's message). The till has put the server's copy back. The message says why. |
| *"Your chemist is closed or not set"* at sign-in | As admin, set the profile's **Chemist No.** and make sure that chemist is **active**. |
| Till stuck on *Offline* | Check the internet. Everything keeps working and uploads later. Don't clear the browser data while changes are waiting. |
| A report on the server looks out of date | Run `npm run db:rebuild` on the server. |

## Typing a supplier's invoice (Pur/GRN (Direct Invoice) → +)

1. **VENDOR DETAILS:** look up the **Vendor Name** (its phone, address and
   e-mail fill in) or type a new one, which is added to the Party Master. Type
   the **Invoice/Receipt No**. Location, Mran No, Mran Date, Status, Received
   By and Expense A/c are filled in for you.
2. **PRODUCT DETAILS:** on each row, press the lookup next to **Medicine
   Name**. In the **LookUp Box**, search by Product Name, Product Code or Cost
   Rate and pick the medicine. Then key in the **Qty**, the **Rate** (cost per
   unit on the invoice), and optionally **Disc%**, **Less discount**,
   **VAT %**, **Expiary Date**, **Batch No** and a new **Retail Price**.
   **NEW ROW(F7)** adds a row. A name that is not in the list (or the green +
   in the LookUp Box) creates a new medicine; it needs a Retail Price.
3. **Save (F2)**. Stock goes up by each Qty, and the cost becomes the net unit
   cost (after discounts, before VAT). It asks first if a medicine goes above
   its Max Level or would sell below its new cost.

**To correct a GRN that was already saved**, select it in the list and press
*Edit* (the pencil). The same screen opens with its lines; change them and
save. The old quantities are taken back out and the new ones put in. **Delete**
on that screen takes the whole GRN back out of stock. Both are refused if the
stock has already been sold. *Payable* shows what each vendor has invoiced.

## Receiving a supplier's invoice from its PDF

Instead of typing a delivery line by line, as the PURCHASE account:

1. Go to *Modules → Pur/GRN (Direct Invoice)* → **Upload Supplier Invoice (PDF)**
   (the button is also on the **+** entry screen) and choose the PDF the
   supplier sent.
2. The review shows every line it read: item code, description, qty, unit
   cost and amount. At the top, a green **✓ Lines add up to the invoice
   subtotal** confirms nothing was missed. A red ⚠ means check the PDF
   against the list.
3. Each line is matched to a medicine you already have, by item code first,
   then by name. Matches show in green; anything else shows as **NEW
   MEDICINE**. To match a line to an existing medicine with a different
   name, type that medicine's name in *Medicine in stock*.

   **Spelling autocorrect.** Names on the document are often misspelt
   (handwritten order books especially). Each name is compared, letter by
   letter, with this chemist's medicines and with the whole company's medicine
   / price list (every chemist's medicines). Strength, size and form count:
   `CALPO 60ML` becomes *CALPOL SUSPENSION (60ML)*, not the 100ML bottle, and
   `CETRIZINE TABS` becomes the tablets, not the syrup.
   - **✓ corrected:** sure enough to use. The corrected name is shown in bold
     with *read: …* (what the document said) under it. Check it.
   - **Did you mean…?** (orange): a close name with a different size or form,
     or not sure. Pick the right one from the list, or *Keep as read (new
     medicine)*. Untouched, the line is received as a new medicine with the
     name as read.
   - A medicine found only in another chemist's list comes in as new here,
     with that chemist's code, selling price, Best Price and pack size filled
     in. Check them.
   - **Size** shows what one pack holds, from the medicine's name: e.g. *100
     tabs*, *10 caps*, *60 ml*. Pcs/Pack is filled from it for tablets and
     capsules, and recorded on the medicine for next time. Check it before
     receiving. On an order book, Qty × Pcs/Pack is the number of units that
     go into stock.
   **Everything on a line can be edited** before receiving:
   - **Description:** type over the name. On a new medicine it becomes its
     name. On a medicine already in stock it renames that medicine (the line
     says *renames …*). To receive it as a new medicine instead, set
     *Medicine in stock* to NEW MEDICINE. Typing a name that is already in
     the list links the line to it, and the *Did you mean…?* list is refreshed.
   - **Item Code** (new medicines), **Size** (typing e.g. `30 tabs` also sets
     Pcs/Pack), **Qty**, **Pcs/Pack**, **Sell By**, **Pack Cost**, **Amount**
     (sets the Pack Cost), **Cost of 1** (sets the Pack Cost), **Selling
     Price**, **Best Price** and **VAT**.
   The company list needs the server (online). Offline, names are matched
   against this chemist's medicines only.
4. **Packs and pieces.** Qty and Pack Cost are as on the invoice (packs or boxes).
   On each line, check:
   - **Pcs/Pack:** read from the description where it says e.g. `100S`, `30'S`,
     `10X10`, `PACK OF 3` (shaded when read; volumes like `60ML` are ignored).
     Type it if it is wrong.
   - **Sell By:** *Each (1)*, *Pair (2)*, … or *Whole pack*.
   - **Units** = Qty × Pcs/Pack ÷ Sell By: this is what goes into stock.
   - **Cost of 1** = Pack Cost ÷ units in a pack: the cost of one unit, so you
     know what to charge.

   Example: 2 packs of 100 tablets at 315.00, sold each, gives 200 units at
   3.15. Face masks, 50 per pack at 135.00, sold in pairs, give 25 units at
   5.40 a pair. The medicine remembers its pack size and Sell By for its
   next invoice.
5. **Selling Price and Best Price** are per unit. A blank Selling Price keeps
   the medicine's current price; for a new medicine it is Cost of 1 +
   **Markup % for new**. **Best Price** is the lowest a unit may be sold for
   (KES, not %). It can't be above the Selling Price, and the lines warn if
   either is below the Cost of 1. Tick **VAT** for new medicines that carry VAT.
6. **Medicines counted per pack before.** The first time such a medicine comes in by
   the piece, *In stock* shows e.g. `2 → 200` with **convert old stock**
   ticked. Its old packs become units and its old prices are divided down to
   one unit. Untick it if the old stock was already counted in pieces.
7. Untick anything that did not arrive, fix a quantity if the delivery was
   short, then press **Receive … line(s) into stock**. **◀ Back** leaves
   without receiving.

One Pur/GRN (Direct Invoice) is filed with the PDF attached. Stock goes up by
each line's Units, and the cost price becomes its Cost of 1. The supplier
is added to the Party Master if it is new. Uploading the same supplier and
invoice number twice asks before adding the stock again.

**Order documents** (e.g. a *Daily Order Book*, LPO or delivery note that
lists the item, description and Units but leaves the prices blank) upload the
same way. Every line with a quantity is read. A yellow note lists any row with
no quantity (those aren't received). Type each line's **Pack Cost** from the
supplier's invoice. A Pack Cost left at 0 keeps the medicine's current cost,
and new medicines need a Selling Price. The order's item codes (001, 002 …)
are row numbers, so lines are matched to your medicines by name.

Only PDFs with selectable text can be read, i.e. the ones a supplier's system
produces. A scanned photo of a paper invoice has no text to read.
