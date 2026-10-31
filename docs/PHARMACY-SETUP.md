# Setting up a pharmacy (chemist)

All pharmacies run from **one server** (`https://pos.subgeoholding.com`) and
**one company database**. Every pharmacy is a *chemist*, numbered `CHEM1`,
`CHEM2`, `CHEM3`… Each chemist has its own medicines, stock, bills, customers,
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
6. **M-Pesa STK** (optional): fill in `.env` on the server. See
   [MPESA.md](MPESA.md).

---

## Part B. For each pharmacy

Do these steps as the **admin**. Replace `N` with the chemist's number.

### 1. Create the chemist

1. Go to *Utilities → Chemists (Branches)* → **New Chemist**.
2. Fill in:
   - **Chemist No.:** the next free number, e.g. `2`. This makes it `CHEM2`.
   - **Name:** e.g. `SCL KAYOLE`
   - **Location**, **Phone**
   - **Status:** active
3. Save. The new chemist starts with no medicines, bills or documents.

> The very first chemist already exists as **CHEMIST 1** (`CHEM1`). Select it
> → **Edit Selected** and give it its real name and location.

### 2. Open the chemist and set its own values

1. On the Chemists page, select the chemist and press *Key in Medicines /
   Stock*. Or use the **Chemist** switcher in the admin header. The header now
   reads `… -CHEMN`.
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
| Counter / cashier | **CASHIER** | `CHEMN` | at least 4 characters |
| Pharmacist in charge | **MANAGER** | `CHEMN` | at least 4 characters |
| Buyer (purchases dashboard) | **PURCHASE** | `CHEMN` | leave **blank** to sign in with no password, or set one |

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
- **Purchases dashboard:** sign in as the chemist's PURCHASE account, then
  *Modules → Medicine*, press **+** and fill in the form, once per
  medicine. Each box shows what it expects: product group, unit, retail
  price, cost price, pack size, and `S`/`N` for stock or non-stock. Saving
  adds the medicine to the chemist's stock list.
- **Import a CSV:** *Utilities → Data Management* → import products.
- **Opening stock:** receive a purchase order, or use the stock adjustment on
  the *Inventory* screen (stock entry / count).

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
   sqlite3 data/subgeo.db "SELECT * FROM v_daily_sales WHERE chemist = 'CHEMN';"
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
| Purchase | *Modules → Petty Cash Voucher* | Petty cash spent |
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

## When something looks wrong

| Problem | Fix |
|---|---|
| *"Server refused N change(s): …"* on a till | The account tried to change something it isn't allowed to (another chemist's data, staff, someone else's message). The till has put the server's copy back. The message says why. |
| *"Your chemist is closed or not set"* at sign-in | As admin, set the profile's **Chemist No.** and make sure that chemist is **active**. |
| Till stuck on *Offline* | Check the internet. Everything keeps working and uploads later. Don't clear the browser data while changes are waiting. |
| A report on the server looks out of date | Run `npm run db:rebuild` on the server. |
