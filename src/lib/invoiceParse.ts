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
/** qty × price ≈ amount, allowing rounding of the printed figures. */
const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.02)
const DOC_LABEL = /^(PI\s*#|Invoice\s*(?:No\.?|#)|Order\s*(?:No\.?|#)|Proforma\s*(?:No\.?|#)|Our\s*(?:Reference|Ref\.?))/i
const DATE_LABEL = /^(Quotation Date|Invoice Date|Order Date|Date)\b/i
const SUB_LABEL = /^Sub\s*total\b/i
const TOTAL_LABEL = /^(Total Amount|Grand Total|Total(?:\s*\(Incl[^)]*\))?)/i
const VAT_LABEL = /^(VAT|Tax)\b/i

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
  const amount = money(cells[cells.length - 1])
  if (amount === undefined) return undefined
  // From the right: amount, unit price, quantity.
  let qtyIdx = cells.length - 3
  let qty = money(cells[qtyIdx])
  let unitPrice = money(cells[cells.length - 2])
  // The price may sit further left: invoices with Disc % / Tax % columns print
  // their figures between the price and the amount (a bare tax "0" here).
  if (qty === undefined || unitPrice === undefined || qty <= 0 || !within(qty * unitPrice, amount)) {
    qty = unitPrice = undefined
    for (let j = cells.length - 2; j > 0 && qty === undefined; j--) {
      const price = money(cells[j])
      if (price === undefined || price < 0) continue
      for (let i = j - 1; i >= 0; i--) {
        const q = money(cells[i])
        if (q === undefined || q <= 0 || !within(q * price, amount)) continue
        qty = q
        unitPrice = price
        qtyIdx = i
        break
      }
    }
  }
  if (qty === undefined || unitPrice === undefined || qty <= 0) return undefined
  let rest = cells.slice(0, qtyIdx)
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

/**
 * The value after a label such as "Invoice No: 12345" — either in the same
 * item, the next one on the row, or (form layouts with a label row above a
 * values row, "Our Reference" → NBINV65905) below it in the same column.
 * Only tries cells that contain a digit so the next label is never taken
 * for the value ("Order No" ⇒ "Delivery Note").
 */
const after = (rs: TextItem[][], rIdx: number, label: RegExp, below: boolean): string | undefined => {
  const row = rs[rIdx]
  for (let i = 0; i < row.length; i++) {
    if (!label.test(row[i].str.trim())) continue
    const own = row[i].str.trim().replace(label, '').replace(/^[\s:#.-]+/, '').trim()
    if (own) return own
    for (let j = i + 1; j < row.length; j++) {
      const cell = row[j].str.trim()
      if (/^\(.*\)?$/.test(cell)) continue
      if (/\d/.test(cell)) return cell
      break
    }
    if (!below) continue
    for (let k = rIdx + 1; k < Math.min(rIdx + 3, rs.length); k++) {
      const under = rs[k].filter((c) => /\d/.test(c.str.trim()) && Math.abs(c.x - row[i].x) <= 40)
      if (under.length) return under[under.length - 1].str.trim()
    }
  }
  return undefined
}

/** Parse every page (one array of positioned text items per page). */
export function parseInvoiceText(pages: TextItem[][]): ParsedInvoice {
  const lines: InvoiceLine[] = []
  const res: ParsedInvoice = { lines, linesTotal: 0, pages: pages.length }
  /** The printed "Total (Excl)" — the item amounts may be print-inclusively. */
  let excl: number | undefined
  pages.forEach((items, p) => {
    const rs = rows(items)
    if (p === 0 && rs.length) {
      // The supplier's name is the first line at the top-left of the first page.
      const left = [...items].filter((i) => i.str.trim() && !/^(tel|telesales|phone|p\.?o\.?|e-?mail)/i.test(i.str.trim())).sort((a, b) => b.y - a.y)
      const top = left.filter((i) => i.x < 200 && /[A-Z]{3,}/.test(i.str))[0]
      if (top) res.supplier = top.str.trim().replace(/\s+/g, ' ').toUpperCase()
    }
    let last: { line: InvoiceLine; y: number; descX: number } | undefined
    for (let rIdx = 0; rIdx < rs.length; rIdx++) {
      const r = rs[rIdx]
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
      res.docNo ??= after(rs, rIdx, DOC_LABEL, true)
      res.date ??= after(rs, rIdx, DATE_LABEL, true)
      const exclCell = r.find((c) => /^Total\s*\(Excl/i.test(c.str.trim()))
      if (exclCell) {
        const v = r.map((c) => money(c.str)).filter((x): x is number => x !== undefined).pop()
        if (v !== undefined) excl ??= v
      } else {
        const sub = after(rs, rIdx, SUB_LABEL, false)
        if (sub && money(sub) !== undefined) res.subtotal ??= money(sub)
        const tot = after(rs, rIdx, TOTAL_LABEL, false)
        if (tot && money(tot) !== undefined) res.total ??= money(tot)
      }
      const vatCell = r.find((c) => VAT_LABEL.test(c.str.trim()))
      if (vatCell) {
        const v = r.map((c) => money(c.str)).filter((x): x is number => x !== undefined).pop()
        if (v !== undefined) res.vat ??= v
      }
    }
  })
  res.linesTotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  // The item amounts can print with VAT in them: when the lines add up to the
  // printed grand total rather than the (Excl) figure, the grand total is what
  // the lines are checked against.
  if (
    excl !== undefined &&
    res.total !== undefined &&
    Math.abs(res.linesTotal - res.total) <= 0.05 &&
    !(res.subtotal !== undefined && Math.abs(res.linesTotal - res.subtotal) <= 0.05)
  )
    res.subtotal = res.total
  return res
}

/** "28/10/26" → "28-10-2026" (the app's date format). */
export function invoiceDate(s?: string): string | undefined {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec((s ?? '').trim())
  if (!m) return undefined
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${y}`
}
