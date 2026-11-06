// Read the item lines of a supplier's invoice / proforma / sales order PDF,
// or of an order document (Daily Order Book, LPO, delivery note) that lists
// quantities with the prices left blank.
// Works on positioned text (what pdf.js gives): rebuilds the rows by their
// height on the page, then recognises "code · description · qty · unit price ·
// amount" rows, checking qty × price ≈ amount so headers and footers are
// never mistaken for items. Rows without prices are read by the columns of the
// table's header row (Item Code · Description · Units/Qty). No pdf.js here, so
// it can be unit-tested.

export interface TextItem {
  x: number
  y: number
  str: string
}

export interface InvoiceLine {
  code?: string
  name: string
  qty: number
  /** Unit price on the invoice, KES (not cents). */
  unitPrice: number
  /** Line amount on the invoice, KES. */
  amount: number
  page: number
}

export interface ParsedInvoice {
  supplier?: string
  docNo?: string
  date?: string
  subtotal?: number
  vat?: number
  total?: number
  lines: InvoiceLine[]
  /** Sum of the line amounts. */
  linesTotal: number
  pages: number
  /** Lines read without a price (an order document): the buyer types the costs. */
  unpriced: number
  /** The document's title when it names its kind, e.g. "DAILY ORDER BOOK". */
  title?: string
  /** Item rows of an order table with no quantity written: shown to the buyer, not received. */
  skipped: string[]
}

const money = (s: string): number | undefined => {
  const t = s.replace(/^(KSh|KES|Ksh|Kshs|Sh)\.?\s*/i, '').replace(/,/g, '').trim()
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : undefined
}
const isMoney = (s: string) => money(s) !== undefined
/** An item code: one word with a digit, e.g. I07302, P-1203, 40125. */
const CODE = /^(?=.*\d)[A-Z0-9][A-Z0-9/.-]{0,19}$/i

/** Group text items into rows: items whose heights differ by ≤ tolerance share a row. */
export function rows(items: TextItem[], tolerance = 3): TextItem[][] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
  const out: { y: number; items: TextItem[] }[] = []
  for (const it of sorted) {
    const row = out.find((r) => Math.abs(r.y - it.y) <= tolerance)
    if (row) row.items.push(it)
    else out.push({ y: it.y, items: [it] })
  }
  return out.sort((a, b) => b.y - a.y).map((r) => r.items.sort((a, b) => a.x - b.x))
}

/** One row → an item line, or undefined when the row isn't one. */
function itemFromRow(row: TextItem[], page: number): InvoiceLine | undefined {
  const cells = row.map((c) => c.str.trim()).filter(Boolean)
  if (cells.length < 4) return undefined
  // From the right: amount, unit price, quantity.
  const amount = money(cells[cells.length - 1])
  const unitPrice = money(cells[cells.length - 2])
  const qty = money(cells[cells.length - 3])
  if (amount === undefined || unitPrice === undefined || qty === undefined || qty <= 0 || unitPrice < 0) return undefined
  // A real item line adds up (allow rounding of the printed figures).
  if (Math.abs(qty * unitPrice - amount) > Math.max(1, amount * 0.02)) return undefined
  let rest = cells.slice(0, -3)
  let code: string | undefined
  // A bare 1-3 digit number first is the row's serial number, not part of the name.
  if (rest.length > 1 && /^\d{1,3}\.?$/.test(rest[0])) rest = rest.slice(1)
  if (rest.length > 1 && CODE.test(rest[0])) {
    code = rest[0].toUpperCase()
    rest = rest.slice(1)
  }
  const name = rest.join(' ').replace(/\s+/g, ' ').trim()
  if (!name || isMoney(name) || /^(sub ?total|total|vat|freight|discount)\b/i.test(name)) return undefined
  return { code, name, qty, unitPrice, amount, page }
}

/** Words of a column / field heading: never a value (an empty "Order No" box next to "Delivery Note"). */
const HEADING = /^(account|date|order\s*no|delivery\s*note|our\s*reference|reference|invoice|units?|qty|quantity|price|rate|disc|tax|vat|total|amount|item|description|code)\b/i

const after = (row: TextItem[], label: RegExp): string | undefined => {
  const i = row.findIndex((c) => label.test(c.str.trim()))
  if (i < 0) return undefined
  const own = row[i].str.trim().replace(label, '').replace(/^[\s:#.-]+/, '').trim()
  const v = own || row[i + 1]?.str.trim()
  return v && /[A-Z0-9]/i.test(v) && !HEADING.test(v) ? v : undefined
}

/** Columns of an item table, from its header row: Item Code · Description · Units/Qty · Price. */
type Columns = { y: number; qtyX: number; codeX?: number; descX?: number; priceX?: number }
function headerOf(row: TextItem[]): Columns | undefined {
  const find = (re: RegExp) => row.find((c) => re.test(c.str.trim()))
  const qty = find(/^(units?|qty\.?|quantity|qty\s*ordered|ordered)$/i)
  const desc = find(/^(item\s*)?(description|product|item\s*name|particulars|details)$/i)
  if (!qty || !desc) return undefined
  return { y: row[0].y, qtyX: qty.x, codeX: find(/^(item\s*)?code$|^(item\s*)?no\.?$/i)?.x, descX: desc.x, priceX: find(/^(unit\s*)?(price|rate|cost)\b/i)?.x }
}

/**
 * A row of an order table without prices: code · description · units (the
 * number under the Units column). Anything else on the row (a price, if one
 * was written) is taken when it sits under its own column.
 */
function orderRowFrom(row: TextItem[], cols: Columns, page: number): InvoiceLine | undefined {
  const near = (x: number, target?: number, tol = 40) => target !== undefined && Math.abs(x - target) <= tol
  const qtyCell = row.find((c) => near(c.x, cols.qtyX) && money(c.str.trim()) !== undefined)
  const qty = qtyCell ? money(qtyCell.str.trim())! : undefined
  if (qty === undefined || qty <= 0) return undefined
  const left = row.filter((c) => c.x < qtyCell!.x - 2 && c.str.trim())
  if (!left.length) return undefined
  let code: string | undefined
  let nameCells = left
  if (left.length > 1 && CODE.test(left[0].str.trim()) && (cols.codeX === undefined || near(left[0].x, cols.codeX, 25))) {
    code = left[0].str.trim().toUpperCase()
    nameCells = left.slice(1)
  }
  const name = nameCells.map((c) => c.str.trim()).join(' ').replace(/\s+/g, ' ').trim()
  if (!name || isMoney(name) || !/[A-Z]{2,}/i.test(name) || /^(sub ?total|total|vat|freight|discount|page)\b/i.test(name)) return undefined
  // Other figures on the row: none (prices left blank), or one price under the
  // Price column. A row with a total must add up — itemFromRow checks those.
  const figures = row.filter((c) => c !== qtyCell && c.x > qtyCell!.x - 2 && money(c.str.trim()) !== undefined)
  if (figures.length > 1) return undefined
  if (figures.length === 1 && !near(figures[0].x, cols.priceX, 30)) return undefined
  const unitPrice = figures.length ? money(figures[0].str.trim())! : 0
  return { code, name, qty, unitPrice, amount: Math.round(qty * unitPrice * 100) / 100, page }
}

/** Parse every page (one array of positioned text items per page). */
export function parseInvoiceText(pages: TextItem[][]): ParsedInvoice {
  const lines: InvoiceLine[] = []
  const res: ParsedInvoice = { lines, linesTotal: 0, pages: pages.length, unpriced: 0, skipped: [] }
  pages.forEach((items, p) => {
    const rs = rows(items)
    if (p === 0 && rs.length) {
      // The supplier's name is the first line at the top-left of the first page.
      const left = [...items].filter((i) => i.str.trim() && !/^(tel|telesales|phone|p\.?o\.?|e-?mail)/i.test(i.str.trim())).sort((a, b) => b.y - a.y)
      const top = left.filter((i) => i.x < 200 && /[A-Z]{3,}/.test(i.str))[0]
      if (top) res.supplier = top.str.trim().toUpperCase()
      const title = rs.slice(0, 3).map((r) => r.map((c) => c.str.trim()).join(' ')).find((t) => /\b(ORDER|INVOICE|PROFORMA|DELIVERY NOTE|QUOTATION)\b/i.test(t))
      if (title) res.title = title.toUpperCase()
    }
    let last: { line: InvoiceLine; y: number; descX: number } | undefined
    let cols: Columns | undefined
    for (const r of rs) {
      if (!cols) {
        const h = headerOf(r)
        if (h) {
          cols = h
          continue
        }
      }
      const item = itemFromRow(r, p + 1) ?? (cols && r[0].y < cols.y ? orderRowFrom(r, cols, p + 1) : undefined)
      // An order row with a code and a name but no quantity: tell the buyer.
      if (!item && cols && r[0].y < cols.y) {
        const t = r.map((c) => c.str.trim()).filter(Boolean)
        if (t.length >= 2 && CODE.test(t[0]) && cols.codeX !== undefined && Math.abs(r.find((c) => c.str.trim())!.x - cols.codeX) <= 25 && /[A-Z]{2,}/i.test(t.slice(1).join(' ')) && !t.slice(1).some(isMoney)) {
          res.skipped.push(`${t[0]} ${t.slice(1).join(' ')}`)
          continue
        }
      }
      if (item) {
        lines.push(item)
        const desc = r.find((c) => item.name.startsWith(c.str.trim())) ?? r[0]
        last = { line: item, y: r[0].y, descX: desc.x }
        continue
      }
      // A description wrapped onto the next line: one text, just below, in the description column.
      const texts = r.map((c) => c.str.trim()).filter(Boolean)
      if (last && texts.length === 1 && !isMoney(texts[0]) && last.y - r[0].y > 0 && last.y - r[0].y < 14 && Math.abs(r[0].x - last.descX) < 12) {
        last.line.name = `${last.line.name} ${texts[0]}`
        last.y = r[0].y
        continue
      }
      res.docNo ??= after(r, /^(PI\s*#|Invoice\s*(No\.?|#)|Order\s*(No\.?|#)|Proforma\s*(No\.?|#))/i)
      res.date ??= after(r, /^(Quotation Date|Invoice Date|Order Date|Date)\b/i)
      const sub = after(r, /^Sub\s*total\b/i)
      if (sub && money(sub) !== undefined) res.subtotal = money(sub)
      const vat = r.find((c) => /^VAT\b/i.test(c.str.trim()))
      if (vat) {
        const v = r.map((c) => money(c.str)).filter((x): x is number => x !== undefined).pop()
        if (v !== undefined) res.vat = v
      }
      const tot = after(r, /^(Total Amount|Grand Total|Total)\b/i)
      if (tot && money(tot) !== undefined) res.total = money(tot)
    }
  })
  res.linesTotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  res.unpriced = lines.filter((l) => !(l.unitPrice > 0)).length
  return res
}

/** "28/10/26" → "28-10-2026" (the app's date format). */
export function invoiceDate(s?: string): string | undefined {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec((s ?? '').trim())
  if (!m) return undefined
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${y}`
}
