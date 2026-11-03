// Read the item lines of a supplier's invoice / proforma / sales order PDF.
// Works on positioned text (what pdf.js gives): rebuilds the rows by their
// height on the page, then recognises "code · description · qty · unit price ·
// amount" rows, checking qty × price ≈ amount so headers and footers are
// never mistaken for items. No pdf.js here, so it can be unit-tested.

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

const after = (row: TextItem[], label: RegExp): string | undefined => {
  const i = row.findIndex((c) => label.test(c.str.trim()))
  if (i < 0) return undefined
  const own = row[i].str.trim().replace(label, '').replace(/^[\s:#.-]+/, '').trim()
  return own || row[i + 1]?.str.trim()
}

/** Parse every page (one array of positioned text items per page). */
export function parseInvoiceText(pages: TextItem[][]): ParsedInvoice {
  const lines: InvoiceLine[] = []
  const res: ParsedInvoice = { lines, linesTotal: 0, pages: pages.length }
  pages.forEach((items, p) => {
    const rs = rows(items)
    if (p === 0 && rs.length) {
      // The supplier's name is the first line at the top-left of the first page.
      const left = [...items].filter((i) => i.str.trim() && !/^(tel|telesales|phone|p\.?o\.?|e-?mail)/i.test(i.str.trim())).sort((a, b) => b.y - a.y)
      const top = left.filter((i) => i.x < 200 && /[A-Z]{3,}/.test(i.str))[0]
      if (top) res.supplier = top.str.trim().toUpperCase()
    }
    let last: { line: InvoiceLine; y: number; descX: number } | undefined
    for (const r of rs) {
      const item = itemFromRow(r, p + 1)
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
  return res
}

/** "28/10/26" → "28-10-2026" (the app's date format). */
export function invoiceDate(s?: string): string | undefined {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec((s ?? '').trim())
  if (!m) return undefined
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${y}`
}
