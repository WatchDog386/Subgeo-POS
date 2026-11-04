// Pur/GRN (Direct Invoice) → "Upload Supplier Invoice (PDF)".
// Reads every item line of a supplier's invoice / proforma / sales order,
// matches each to a medicine already in stock (by item code, then name),
// lets the buyer check it, then receives it in one go: stock up, cost
// updated, new medicines created, and one MRN document filed with the PDF
// attached and every line (synced to the server like any document).
import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { logActivity } from '../../db/logs'
import type { DocLine, DocRecord, Product, Supplier } from '../../db/types'
import { toCents } from '../../lib/money'
import { invoiceDate, type ParsedInvoice } from '../../lib/invoiceParse'
import { parseCsv } from '../../lib/csv'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { amt, dmy, getKv, nextDocNo, setKv } from '../data'
import { Btn, Check, Dialog, Input } from '../ui'

export type ImportLine = {
  key: number
  include: boolean
  code: string
  name: string
  qty: string
  cost: string
  /** Matched medicine; undefined = create a new one. */
  productId?: number
  /** Selling price of one unit (KES); blank = keep the current one / from the markup. */
  price: string
  /** Best Price (KES): the lowest it may be sold for; blank = keep / none. */
  best: string
  vat: boolean
  /** Pieces in one pack on the invoice, and how many pieces are sold at a time. */
  perPack: string
  sellBy: number
  /** Where Pcs/Pack came from: the description, this medicine's last invoice, typed, or not found. */
  from: 'invoice' | 'medicine' | 'typed' | 'none'
  /**
   * A medicine stocked before pack sizes were recorded (counted per pack):
   * turn its old stock into units and its prices into per-unit prices first.
   */
  convert: boolean
}

/** One line from a chemist's exported stock report (CSV). */
export type StockReportLine = {
  key: number
  include: boolean
  /** Item code on the report (may be blank). */
  code: string
  /** Product name (required). */
  name: string
  /** Unit of measure (may be blank). */
  uom: string
  /** Stock on hand before this transfer (may be blank). */
  opening: string
  /** Qty received from the other chemist (added to stock). */
  received: string
  /** Qty issued (informational). */
  issued: string
  /** Closing stock (informational, or used to set stock when received is blank). */
  closing: string
  /** Retail selling price per unit. */
  retail: string
  /** Whole-sale selling price per unit. */
  whole: string
  /** Best Price (lowest it may be sold for). */
  best: string
  /** Matched medicine; undefined = create a new one. */
  productId?: number
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

/** Find the column index by trying several likely header names (case-insensitive). */
function colIdx(headers: string[], ...names: string[]): number {
  const upper = headers.map((h) => h.trim().toUpperCase())
  for (const name of names) {
    const n = name.trim().toUpperCase()
    const i = upper.findIndex((h) => h === n || h.includes(n))
    if (i >= 0) return i
  }
  return -1
}

/** Parse a stock report CSV into StockReportLine[] with flexible column detection. */
export function parseStockReportCsv(text: string): StockReportLine[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0]
  const iName = colIdx(headers, 'PRODUCT NAME', 'NAME', 'ITEM', 'MEDICINE', 'PRODUCT')
  const iCode = colIdx(headers, 'PRODUCT CODE', 'CODE', 'SKU', 'ITEM CODE', 'BARCODE')
  const iUom = colIdx(headers, 'UOM', 'UNIT', 'UNIT OF MEASURE')
  const iOpening = colIdx(headers, 'OPENING STOCK', 'OPENING', 'OPEN STOCK')
  const iReceived = colIdx(headers, 'RECEIVED', 'RECEIPT', 'IN', 'STOCK IN')
  const iIssued = colIdx(headers, 'ISSUED', 'ISSUE', 'OUT', 'STOCK OUT')
  const iClosing = colIdx(headers, 'CLOSING STOCK', 'CLOSING', 'CLOSE STOCK', 'BALANCE')
  const iRetail = colIdx(headers, 'RETAIL', 'RETAIL SALE', 'SELLING PRICE', 'SALE PRICE', 'PRICE')
  const iWhole = colIdx(headers, 'WHOLE', 'WHOLE SALE', 'WHOLESALE', 'TRADE PRICE')
  const iBest = colIdx(headers, 'BEST PRICE', 'BEST', 'MIN PRICE', 'MINIMUM PRICE')

  if (iName < 0) throw new Error('CSV must have a "Product Name" column')

  const out: StockReportLine[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] ?? '').trim() : '')
    const name = get(iName)
    if (!name) continue
    out.push({
      key: r,
      include: true,
      code: iCode >= 0 ? get(iCode) : '',
      name: name.toUpperCase(),
      uom: iUom >= 0 ? get(iUom) : '',
      opening: iOpening >= 0 ? get(iOpening) : '',
      received: iReceived >= 0 ? get(iReceived) : '',
      issued: iIssued >= 0 ? get(iIssued) : '',
      closing: iClosing >= 0 ? get(iClosing) : '',
      retail: iRetail >= 0 ? get(iRetail) : '',
      whole: iWhole >= 0 ? get(iWhole) : '',
      best: iBest >= 0 ? get(iBest) : '',
    })
  }
  return out
}

/** Receive the checked stock-report lines into stock and file one MRN. */
export async function receiveStockReport(input: {
  lines: {
    code?: string
    name: string
    uom: string
    qty: number
    costCents: number
    priceCents?: number
    wholeCents?: number
    bestCents?: number
    productId?: number
    taxable: boolean
  }[]
  vendor: string
  invoiceNo: string
  invoiceDate?: string
  totalCents: number
  expense: string
  receivedBy: string
  userId?: number
}): Promise<{ docNo: string; added: number; updated: number; docId: number }> {
  if (!input.lines.length) throw new Error('No lines to receive')
  if (!input.vendor.trim()) throw new Error('Type or pick the Vendor Name')
  return db.transaction('rw', [db.products, db.movements, db.suppliers, db.docs, db.kv], async () => {
    const vendor = input.vendor.trim().toUpperCase()
    let supplier: Supplier | undefined = (await db.suppliers.toArray()).find((s) => s.name.toUpperCase() === vendor)
    if (!supplier) {
      const id = (await db.suppliers.add({ name: vendor, notes: 'Added from a stock report import' })) as number
      supplier = await db.suppliers.get(id)
    }
    const docNo = await nextDocNo('MRN')
    const now = Date.now()
    let added = 0
    let updated = 0
    const docLines: DocLine[] = []
    for (const l of input.lines) {
      if (l.qty <= 0) throw new Error(`${l.name}: quantity must be above 0`)
      let p = l.productId !== undefined ? await db.products.get(l.productId) : undefined
      if (p) {
        await db.products.update(p.id!, {
          stock: p.stock + l.qty,
          cost: l.costCents,
          supplierId: p.supplierId ?? supplier?.id,
          ...(l.priceCents && l.priceCents > 0 ? { price: l.priceCents } : {}),
          ...(l.bestCents && l.bestCents > 0 ? { minPrice: l.bestCents } : {}),
          updatedAt: now,
        })
        p = await db.products.get(p.id!)
        updated++
      } else {
        if (!l.priceCents || l.priceCents <= 0) throw new Error(`${l.name}: set a selling price (Retail) for this new medicine`)
        let sku = (l.code ?? '').trim().toUpperCase()
        if (!sku || (await db.products.where('sku').equals(sku).first())) sku = `${sku || 'MED'}-${now.toString(36).toUpperCase()}-${added}`
        const id = (await db.products.add({
          sku,
          name: l.name.trim().toUpperCase(),
          barcode: sku,
          fitment: [],
          cost: l.costCents,
          price: l.priceCents,
          minPrice: l.bestCents && l.bestCents > 0 ? l.bestCents : undefined,
          stock: l.qty,
          reorderLevel: 0,
          supplierId: supplier?.id,
          taxable: l.taxable,
          serialized: false,
          trackStock: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        } as Product)) as number
        p = await db.products.get(id)
        added++
      }
      await db.movements.add({ productId: p!.id!, change: l.qty, reason: 'receive', reference: docNo, note: `Stock report import ${input.invoiceNo}`.trim(), userId: input.userId, at: now })
      docLines.push({
        productId: p!.id,
        name: p!.name,
        sku: p!.sku,
        qty: l.qty,
        cost: l.costCents,
        rate: p!.price,
        vatPct: 0,
        vat: 0,
        discount: 0,
        total: Math.round(l.qty * l.costCents),
        best: l.bestCents && l.bestCents > 0 ? l.bestCents : undefined,
      })
      // Remember the medicine-form details (UOM, whole sale price) from the report.
      const docs = await db.docs.where('slug').equals('medicine').toArray()
      const code = p!.sku.trim().toUpperCase()
      const doc = docs.find((d) => (d.values.docNo ?? '').trim().toUpperCase() === code) ?? docs.find((d) => (d.values.name ?? '').trim().toUpperCase() === p!.name.trim().toUpperCase())
      const values: Record<string, string> = {
        ...(doc?.values ?? { docNo: p!.sku, name: p!.name.toUpperCase(), type: 'S' }),
        uom: l.uom.trim().toUpperCase(),
        whole: l.wholeCents !== undefined ? (l.wholeCents / 100).toFixed(2) : '',
        cost: (l.costCents / 100).toFixed(2),
        retail: (p!.price / 100).toFixed(2),
      }
      if (doc) await db.docs.update(doc.id, { values, updatedAt: now })
      else await db.docs.add({ slug: 'medicine', docNo: p!.sku, values, createdAt: now, updatedAt: now, createdBy: input.userId } as unknown as DocRecord)
    }
    const values: Record<string, string> = {
      docNo,
      mrnDate: dmy(now),
      invoice: input.invoiceNo.trim(),
      vendorName: vendor,
      total: (input.totalCents / 100).toFixed(2),
      expense: input.expense.trim().toUpperCase(),
      receivedBy: input.receivedBy.toUpperCase(),
      status: 'GOOD RECEIVED',
      phoneNo: supplier?.contactPhone || supplier?.phone || '',
      ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
    }
    const docId = (await db.docs.add({ slug: 'pur-grn-direct-invoice', docNo, values, lines: docLines, createdAt: now, updatedAt: now, createdBy: input.userId } as DocRecord)) as number
    return { docNo, added, updated, docId }
  })
}

/** Medicine already in stock for an invoice line: same item code, else same name. */
export function matchProduct(products: Product[], code: string | undefined, name: string): Product | undefined {
  const c = (code ?? '').trim().toUpperCase()
  if (c) {
    const byCode = products.find((p) => p.sku.trim().toUpperCase() === c || (p.barcode ?? '').trim().toUpperCase() === c)
    if (byCode) return byCode
  }
  const n = norm(name)
  return products.find((p) => norm(p.name) === n)
}

/**
 * Pieces in one pack, read from an invoice description: "(100S)", "30'S",
 * "10X10", "PACK OF 3", "100 TABS". Volumes and strengths (60ML, 500MG) are
 * not counts. 1 when nothing is found.
 */
export function packSizeFrom(name: string): number {
  const t = ` ${name.toUpperCase()} `
  const ok = (n: number) => Number.isInteger(n) && n > 1 && n <= 5000
  const mult = t.match(/\b(\d{1,3})\s*[X×]\s*(\d{1,3})\b(?!\s*(?:ML|MG|G|GM|L|MCG|IU|%))/)
  if (mult && ok(Number(mult[1]) * Number(mult[2]))) return Number(mult[1]) * Number(mult[2])
  const packOf = t.match(/PACK\s+OF\s+(\d{1,4})\b/)
  if (packOf && ok(Number(packOf[1]))) return Number(packOf[1])
  const s = t.match(/\b(\d{1,4})\s*'?\s*S\b/)
  if (s && ok(Number(s[1]))) return Number(s[1])
  const unit = t.match(/\b(\d{1,4})\s*(?:TABS?|TABLETS|CAPS?|CAPSULES|PCS|PIECES|SACHETS|VIALS|AMPOULES|AMPS|PESSARIES|SUPPOSITORIES)\b/)
  if (unit && ok(Number(unit[1]))) return Number(unit[1])
  return 1
}

/** Sell-by choices for a pack: each, a pair, … the whole pack (only sizes that divide the pack). */
export function sellByChoices(perPack: number): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [{ value: 1, label: 'Each (1)' }]
  if (perPack >= 4 && perPack % 2 === 0) out.push({ value: 2, label: 'Pair (2)' })
  for (const n of [3, 5, 10]) if (perPack > n && perPack % n === 0) out.push({ value: n, label: `${n} pcs` })
  if (perPack > 1) out.push({ value: perPack, label: `Whole pack (${perPack})` })
  return out
}

/**
 * What one invoice line puts in stock. packs × perPack pieces, sold sellBy at a
 * time: units = packs × perPack ÷ sellBy, and one unit costs
 * packCost ÷ (perPack ÷ sellBy).
 */
export function lineUnits(packs: number, perPack: number, sellBy: number, packCostCents: number): { units: number; unitCost: number; error?: string } {
  if (!(packs > 0)) return { units: 0, unitCost: 0, error: 'Qty must be above 0' }
  if (!Number.isInteger(perPack) || perPack < 1) return { units: 0, unitCost: 0, error: 'Pcs/Pack must be a whole number, 1 or more' }
  if (!Number.isInteger(sellBy) || sellBy < 1 || sellBy > perPack || perPack % sellBy !== 0) return { units: 0, unitCost: 0, error: `Sell By must divide the ${perPack} pcs in a pack` }
  const perUnit = perPack / sellBy
  const units = packs * perUnit
  if (!Number.isInteger(units)) return { units: 0, unitCost: 0, error: 'Qty × Pcs/Pack must come to whole units' }
  return { units, unitCost: Math.round(packCostCents / perUnit) }
}

/** Selling price from cost and markup %, rounded up to the next whole shilling. */
export const priceFromMarkup = (costKes: number, markupPct: number) => Math.ceil(costKes * (1 + markupPct / 100))

/**
 * Receive the checked lines into stock and file the MRN. One transaction:
 * either everything is received or nothing is.
 */
export async function receiveInvoice(input: {
  /**
   * qty / costCents: units put in stock and the cost of one unit. When the
   * invoice is in packs, packs × perPack pieces sold sellBy at a time
   * (lineUnits) — kept on the line and on the medicine for next time.
   */
  lines: {
    code?: string
    name: string
    qty: number
    costCents: number
    /** New medicine: its selling price per unit. Matched: a new selling price (blank = keep). */
    priceCents?: number
    bestCents?: number
    productId?: number
    vat: boolean
    packs?: number
    perPack?: number
    sellBy?: number
    packCostCents?: number
    /** Old stock was counted per pack: multiply it by this (units per pack) and divide its prices. */
    convertFactor?: number
  }[]
  vendor: string
  invoiceNo: string
  invoiceDate?: string
  totalCents: number
  expense: string
  receivedBy: string
  userId?: number
  attachment?: { name: string; data: string }
}): Promise<{ docNo: string; added: number; updated: number; docId: number }> {
  if (!input.lines.length) throw new Error('No lines to receive')
  if (!input.vendor.trim()) throw new Error('Type or pick the Vendor Name')
  return db.transaction('rw', [db.products, db.movements, db.suppliers, db.docs, db.kv], async () => {
    const vendor = input.vendor.trim().toUpperCase()
    let supplier: Supplier | undefined = (await db.suppliers.toArray()).find((s) => s.name.toUpperCase() === vendor)
    if (!supplier) {
      const id = (await db.suppliers.add({ name: vendor, notes: 'Added from an uploaded supplier invoice' })) as number
      supplier = await db.suppliers.get(id)
    }
    const docNo = await nextDocNo('MRN')
    const now = Date.now()
    let added = 0
    let updated = 0
    const docLines: DocLine[] = []
    for (const l of input.lines) {
      if (l.qty <= 0) throw new Error(`${l.name}: quantity must be above 0`)
      let p = l.productId !== undefined ? await db.products.get(l.productId) : undefined
      if (p) {
        // Old stock in packs → units, and its prices per unit, before adding this delivery.
        const f = l.convertFactor && l.convertFactor > 1 ? l.convertFactor : 1
        if (f > 1) {
          await db.products.update(p.id!, { stock: p.stock * f, price: Math.round(p.price / f), ...(p.minPrice ? { minPrice: Math.round(p.minPrice / f) } : {}), updatedAt: now })
          await db.movements.add({ productId: p.id!, change: p.stock * (f - 1), reason: 'adjust', reference: docNo, note: `${p.stock} pack(s) counted as ${p.stock * f} units (${f} per pack)`, userId: input.userId, at: now })
          p = (await db.products.get(p.id!))!
        }
        await db.products.update(p.id!, {
          stock: p.stock + l.qty,
          cost: l.costCents,
          supplierId: p.supplierId ?? supplier?.id,
          ...(l.priceCents && l.priceCents > 0 ? { price: l.priceCents } : {}),
          ...(l.bestCents && l.bestCents > 0 ? { minPrice: l.bestCents } : {}),
          updatedAt: now,
        })
        p = await db.products.get(p.id!)
        updated++
      } else {
        if (!l.priceCents || l.priceCents <= 0) throw new Error(`${l.name}: set a selling price (or a markup %) for this new medicine`)
        let sku = (l.code ?? '').trim().toUpperCase()
        if (!sku || (await db.products.where('sku').equals(sku).first())) sku = `${sku || 'MED'}-${now.toString(36).toUpperCase()}-${added}`
        const id = (await db.products.add({
          sku,
          name: l.name.trim().toUpperCase(),
          barcode: sku,
          fitment: [],
          cost: l.costCents,
          price: l.priceCents,
          minPrice: l.bestCents && l.bestCents > 0 ? l.bestCents : undefined,
          stock: l.qty,
          reorderLevel: 0,
          supplierId: supplier?.id,
          taxable: l.vat,
          serialized: false,
          trackStock: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        } as Product)) as number
        p = await db.products.get(id)
        added++
      }
      await db.movements.add({ productId: p!.id!, change: l.qty, reason: 'receive', reference: docNo, note: `${vendor} invoice ${input.invoiceNo}`.trim(), userId: input.userId, at: now })
      const total = l.packs && l.packCostCents !== undefined ? Math.round(l.packs * l.packCostCents) : Math.round(l.qty * l.costCents)
      docLines.push({
        productId: p!.id,
        name: p!.name,
        sku: p!.sku,
        qty: l.qty,
        cost: l.costCents,
        rate: p!.price,
        vatPct: 0,
        vat: 0,
        discount: 0,
        total,
        best: l.bestCents && l.bestCents > 0 ? l.bestCents : undefined,
        ...(l.perPack && l.perPack > 1 ? { packs: l.packs, perPack: l.perPack, sellBy: l.sellBy ?? 1 } : {}),
      })
      // Remember how this medicine comes and is sold (Medicine form: Pack Size).
      if (l.perPack && l.perPack >= 1) {
        const docs = await db.docs.where('slug').equals('medicine').toArray()
        const code = p!.sku.trim().toUpperCase()
        const doc = docs.find((d) => (d.values.docNo ?? '').trim().toUpperCase() === code) ?? docs.find((d) => (d.values.name ?? '').trim().toUpperCase() === p!.name.trim().toUpperCase())
        const values: Record<string, string> = { ...(doc?.values ?? { docNo: p!.sku, name: p!.name.toUpperCase(), type: 'S' }), packSize: String(l.perPack), sellBy: String(l.sellBy ?? 1), cost: (l.costCents / 100).toFixed(2), retail: (p!.price / 100).toFixed(2) }
        if (doc) await db.docs.update(doc.id, { values, updatedAt: now })
        else await db.docs.add({ slug: 'medicine', docNo: p!.sku, values, createdAt: now, updatedAt: now, createdBy: input.userId } as unknown as DocRecord)
      }
    }
    const values: Record<string, string> = {
      docNo,
      mrnDate: dmy(now),
      invoice: input.invoiceNo.trim(),
      vendorName: vendor,
      total: (input.totalCents / 100).toFixed(2),
      expense: input.expense.trim().toUpperCase(),
      receivedBy: input.receivedBy.toUpperCase(),
      status: 'GOOD RECEIVED',
      phoneNo: supplier?.contactPhone || supplier?.phone || '',
      ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
      ...(input.attachment ? { attachment: input.attachment.data, attachmentName: input.attachment.name } : {}),
    }
    const docId = (await db.docs.add({ slug: 'pur-grn-direct-invoice', docNo, values, lines: docLines, createdAt: now, updatedAt: now, createdBy: input.userId } as DocRecord)) as number
    return { docNo, added, updated, docId }
  })
}

const MARKUP_KEY = 'medapp:import-markup'

/** Pick the PDF or CSV, read it, then show the review. */
export function useInvoiceUpload(onDone?: () => void) {
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{ file: { name: string; data: string }; inv: ParsedInvoice } | { file: { name: string; data: string }; stock: StockReportLine[] } | null>(null)
  const pick = () => input.current?.click()
  const onFile = async (f: File) => {
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
    const isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv'
    if (!isPdf && !isCsv) return toast('Choose a supplier invoice PDF or a stock report CSV file', 'error')
    if (f.size > 10 * 1024 * 1024) return toast('File is too big (max 10 MB)', 'error')
    setBusy(true)
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = () => rej(r.error)
        r.readAsDataURL(f)
      })
      if (isPdf) {
        const { readInvoicePdf } = await import('../../lib/pdf')
        const inv = await readInvoicePdf(f)
        if (!inv.lines.length) throw new Error('No item lines found. Is it a scanned photo? Only PDFs with selectable text can be read.')
        setReview({ file: { name: f.name, data }, inv })
      } else {
        const text = await f.text()
        const stock = parseStockReportCsv(text)
        if (!stock.length) throw new Error('No usable rows found. The CSV needs a "Product Name" column at minimum.')
        setReview({ file: { name: f.name, data }, stock })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const element = (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,text/csv,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      {review && 'inv' in review && (
        <InvoiceReview
          inv={review.inv}
          file={review.file}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null)
            onDone?.()
          }}
        />
      )}
      {review && !('inv' in review) && (
        <StockReportReview
          stock={review.stock}
          file={review.file}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null)
            onDone?.()
          }}
        />
      )}
    </>
  )
  return { pick, busy, element }
}

function InvoiceReview({ inv, file, onClose, onDone }: { inv: ParsedInvoice; file: { name: string; data: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  // undefined until loaded, so lines are matched against the real list.
  const loaded = useLiveQuery(() => db.products.toArray(), [])
  const medDocs = useLiveQuery(() => db.docs.where('slug').equals('medicine').toArray(), [])
  const products = loaded ?? []
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const lastExpense = useLiveQuery(async () => (await db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).sort((a, b) => b.createdAt - a.createdAt)[0]?.values.expense ?? '', [], '')
  const savedMarkup = useLiveQuery(() => getKv<string>(MARKUP_KEY, ''), [], '')
  const [vendor, setVendor] = useState(inv.supplier ?? '')
  const [invoiceNo, setInvoiceNo] = useState(inv.docNo ?? '')
  const [expense, setExpense] = useState<string>()
  const [markup, setMarkup] = useState<string>()
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<ImportLine[] | null>(null)
  const markupV = markup ?? savedMarkup
  const expenseV = expense ?? lastExpense

  /** Pack size / sell-by remembered for a medicine from an earlier invoice (Medicine form record). */
  const remembered = (p: Product | undefined) => {
    if (!p) return undefined
    const d = (medDocs ?? []).find((x) => (x.values.docNo ?? '').trim().toUpperCase() === p.sku.trim().toUpperCase()) ?? (medDocs ?? []).find((x) => (x.values.name ?? '').trim().toUpperCase() === p.name.trim().toUpperCase())
    const per = Math.round(Number(d?.values.packSize) || 0)
    return per >= 1 && d?.values.sellBy ? { perPack: per, sellBy: Math.max(1, Math.round(Number(d.values.sellBy) || 1)) } : undefined
  }
  const packFor = (p: Product | undefined, name: string) => {
    const r = remembered(p)
    if (r) return { perPack: String(r.perPack), sellBy: r.sellBy, from: 'medicine' as const }
    const n = packSizeFrom(name)
    return { perPack: String(n), sellBy: 1, from: n > 1 ? ('invoice' as const) : ('none' as const) }
  }

  /** Old per-pack medicine: convert by default only when its price still looks like a pack price. */
  const looksPerPack = (p: Product | undefined, perPack: number, packCostKes: number) => !!p && perPack > 1 && p.price >= 0.6 * Math.round(packCostKes * 100)

  // Match once the medicines (and their pack sizes) have loaded.
  if (lines === null && loaded && medDocs) {
    setLines(
      inv.lines.map((l, i) => {
        const p = matchProduct(products, l.code, l.name)
        const pk = packFor(p, l.name)
        const conv = pk.from !== 'medicine' && looksPerPack(p, Number(pk.perPack), l.unitPrice)
        return { key: i, include: true, code: l.code ?? '', name: l.name.toUpperCase(), qty: String(l.qty), cost: l.unitPrice.toFixed(2), productId: p?.id, price: '', best: '', vat: p?.taxable ?? false, ...pk, convert: conv }
      }),
    )
  }
  const list = lines ?? []
  const byId = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products])
  const set = (key: number, patch: Partial<ImportLine>) => setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)))
  /** Stock units, the cost of one unit (cents) and any problem with the pack figures. */
  const unitsOf = (l: ImportLine) => lineUnits(Number(l.qty) || 0, Number(l.perPack), l.sellBy, toCents(l.cost || '0'))
  /** Units in one pack when the medicine's old per-pack stock and prices are converted, else 1. */
  const factorOf = (l: ImportLine) => {
    const per = Number(l.perPack)
    return l.convert && l.productId !== undefined && per > 1 && per % l.sellBy === 0 ? per / l.sellBy : 1
  }
  /** Selling price of one unit (KES): typed, else the current one (per unit), else cost of 1 + markup. */
  const priceOf = (l: ImportLine) => {
    if (l.price.trim()) return Number(l.price)
    const p = l.productId !== undefined ? byId.get(l.productId) : undefined
    if (p) return Math.round(p.price / factorOf(l)) / 100
    return markupV.trim() ? priceFromMarkup(unitsOf(l).unitCost / 100, Number(markupV) || 0) : 0
  }
  /** The medicine's current Best Price per unit (cents), after any conversion. */
  const currentBest = (l: ImportLine) => {
    const p = l.productId !== undefined ? byId.get(l.productId) : undefined
    return p?.minPrice ? Math.round(p.minPrice / factorOf(l)) : undefined
  }
  const chosen = list.filter((l) => l.include)
  const linesSum = chosen.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0)
  const newCount = chosen.filter((l) => l.productId === undefined).length
  const matchedCount = chosen.length - newCount
  const adds = inv.subtotal !== undefined && Math.abs(inv.linesTotal - inv.subtotal) < 0.05
  const shown = list.filter((l) => !q.trim() || `${l.code} ${l.name}`.toUpperCase().includes(q.trim().toUpperCase()))
  const AMOUNT = /^\d+(\.\d{0,2})?$/

  const receive = async () => {
    if (saving || !user) return
    if (!chosen.length) return toast('Tick at least one line to receive', 'error')
    for (const l of chosen) {
      const u = unitsOf(l)
      if (u.error) return toast(`${l.name}: ${u.error}`, 'error')
      if (l.price.trim() && (!AMOUNT.test(l.price.trim()) || toCents(l.price) <= 0)) return toast(`${l.name}: Selling Price must be an amount above 0`, 'error')
      if (l.productId === undefined && priceOf(l) <= 0) return toast(`${l.name} is new: type its selling price (per ${l.sellBy === 1 ? 'piece' : `${l.sellBy} pcs`}), or a Markup % for all new medicines`, 'error')
      // Best Price: an amount (not %), above 0, and not above the selling price.
      const sell = Math.round(priceOf(l) * 100)
      const t = l.best.trim()
      if (t && (!AMOUNT.test(t) || toCents(t) <= 0)) return toast(`${l.name}: Best Price must be an amount in KES above 0, e.g. 120.00 (not a %)`, 'error')
      const floor = t ? toCents(t) : currentBest(l)
      if (floor && sell > 0 && floor > sell) return toast(`${l.name}: Best Price ${(floor / 100).toFixed(2)} is above the selling price ${(sell / 100).toFixed(2)} — the best price is the lowest it may be sold for`, 'error')
    }
    const loss = chosen
      .map((l) => ({ l, u: unitsOf(l), sell: Math.round(priceOf(l) * 100), best: l.best.trim() ? toCents(l.best) : currentBest(l) }))
      .filter(({ u, sell, best }) => u.unitCost > 0 && Math.min(sell, best ?? sell) < u.unitCost)
      .map(({ l, u, sell, best }) => `${l.name}: ${best !== undefined && best < sell ? `Best Price ${(best / 100).toFixed(2)}` : `sells at ${(sell / 100).toFixed(2)}`}, one costs ${(u.unitCost / 100).toFixed(2)}`)
    if (loss.length && !confirm(`These would sell below their cost:\n\n${loss.slice(0, 12).join('\n')}\n\nReceive anyway?`)) return
    const dup = (await db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).find(
      (d) => invoiceNo.trim() && d.values.invoice === invoiceNo.trim() && (d.values.vendorName ?? '').toUpperCase() === vendor.trim().toUpperCase(),
    )
    const over = chosen
      .map((l) => ({ p: l.productId !== undefined ? byId.get(l.productId) : undefined, qty: unitsOf(l).units, f: factorOf(l) }))
      .filter(({ p, qty, f }) => p?.maxStock !== undefined && p.stock * f + qty > p.maxStock)
      .map(({ p, qty, f }) => `${p!.name}: ${p!.stock * f + qty} (max ${p!.maxStock})`)
    if (over.length && !confirm(`This takes these medicines above their maximum level:\n\n${over.slice(0, 12).join('\n')}\n\nReceive anyway?`)) return
    if (dup && !confirm(`${vendor} invoice ${invoiceNo} was already received as ${dup.values.docNo}. Receive it again (stock will be added twice)?`)) return
    setSaving(true)
    try {
      if (markupV.trim()) await setKv(MARKUP_KEY, markupV.trim())
      const r = await receiveInvoice({
        lines: chosen.map((l) => {
          const u = unitsOf(l)
          const isNew = l.productId === undefined
          return {
            code: l.code || undefined,
            name: l.name,
            qty: u.units,
            costCents: u.unitCost,
            priceCents: isNew ? toCents(String(priceOf(l))) : l.price.trim() ? toCents(l.price) : undefined,
            bestCents: l.best.trim() ? toCents(l.best) : undefined,
            productId: l.productId,
            vat: l.vat,
            packs: Number(l.qty) || 0,
            perPack: Number(l.perPack),
            sellBy: l.sellBy,
            packCostCents: toCents(l.cost || '0'),
            convertFactor: factorOf(l) > 1 ? factorOf(l) : undefined,
          }
        }),
        vendor,
        invoiceNo,
        invoiceDate: invoiceDate(inv.date),
        // The whole invoice: its printed total (with VAT). Part of it: the cost of what was received.
        totalCents: Math.round((chosen.length === list.length && inv.total !== undefined ? inv.total : linesSum) * 100),
        expense: expenseV,
        receivedBy: user.name,
        userId: user.id,
        attachment: file,
      })
      await logActivity('stock', `Supplier invoice received (${r.docNo})`, { detail: `${vendor} ${invoiceNo}: ${r.updated} medicine(s) topped up, ${r.added} new`, userId: user.id, userName: user.name })
      toast(`${r.docNo}: ${r.updated + r.added} medicine(s) received — ${r.updated} topped up, ${r.added} new`)
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, background: '#e9e9e9', fontSize: 11, textAlign: 'left', padding: '4px 4px', borderBottom: '1px solid #bbb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { fontSize: 11, padding: '2px 4px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const small = (w: number, right = true): React.CSSProperties => ({ width: w, height: 19, fontSize: 11, textAlign: right ? 'right' : 'left', padding: '0 3px' })
  const bad = (on: boolean): React.CSSProperties => (on ? { borderColor: '#e57373', background: '#fff1f1' } : {})
  return (
    <Dialog title={`Upload Supplier Invoice — ${file.name}`} onClose={onClose} width={1320}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn onClick={onClose} title="Back to Pur/GRN (Direct Invoice) without receiving">
          ◀ Back
        </Btn>
        <label className="ma-label">
          Vendor Name{' '}
          <input className="ma-input" style={{ width: 230 }} value={vendor} list="ma-imp-vendors" onChange={(e) => setVendor(e.target.value.toUpperCase())} placeholder="Supplier on the invoice" aria-label="Vendor Name" />
        </label>
        <label className="ma-label">
          Invoice/Receipt <Input value={invoiceNo} onChange={setInvoiceNo} width={100} placeholder="Invoice / PI no." />
        </label>
        <label className="ma-label">
          Expense A/c <Input value={expenseV} onChange={setExpense} width={170} placeholder="e.g. PURCHASES MEDICINE" />
        </label>
        <label className="ma-label" title="Selling price of NEW medicines = cost of 1 + this %, rounded up to the shilling">
          Markup % for new <Input value={markupV} onChange={setMarkup} width={50} placeholder="e.g. 33" />
        </label>
        <datalist id="ma-imp-vendors">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name.toUpperCase()} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '8px 0', fontSize: 11, flexWrap: 'wrap' }}>
        <span>
          <b>{list.length}</b> lines read from {inv.pages} page(s){inv.date ? ` · dated ${inv.date}` : ''}
        </span>
        <span style={{ color: adds ? '#2e7d32' : '#c00', fontWeight: 'bold' }}>
          {inv.subtotal === undefined ? `Lines total ${amt(Math.round(inv.linesTotal * 100))} (no subtotal printed to check against)` : adds ? `✓ Lines add up to the invoice subtotal ${amt(Math.round(inv.subtotal * 100))}` : `⚠ Lines total ${amt(Math.round(inv.linesTotal * 100))} but the invoice subtotal is ${amt(Math.round(inv.subtotal * 100))} — check for missed lines`}
        </span>
        {inv.vat !== undefined && <span>VAT {amt(Math.round(inv.vat * 100))}</span>}
        {inv.total !== undefined && <span>Invoice total {amt(Math.round(inv.total * 100))}</span>}
        <span style={{ marginLeft: 'auto' }}>
          Receiving <b>{chosen.length}</b>: {matchedCount} already in stock, <b style={{ color: newCount ? '#e65100' : undefined }}>{newCount} new</b> · cost {amt(Math.round(linesSum * 100))}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <Input value={q} onChange={setQ} width={260} placeholder="Find a line by code or name" />
        <Check checked={list.length > 0 && list.every((l) => l.include)} onChange={(v) => setLines((ls) => (ls ?? []).map((l) => ({ ...l, include: v })))} dark>
          All
        </Check>
        <span className="ma-label ma-note" style={{ fontSize: 10 }}>
          Qty and Pack Cost are as on the invoice (packs / boxes). Check <b>Pcs/Pack</b> (read from the description where it says e.g. 100S, 10X10) and choose <b>Sell By</b>: each, a pair, or the whole pack. Stock goes up by <b>Units</b>; <b>Cost of 1</b> = Pack Cost ÷ units in a pack. Selling
          Price and <b>Best Price</b> (the lowest it may be sold for, KES) are per unit.
        </span>
      </div>
      <div style={{ height: 380, overflow: 'auto', border: '1px solid #c3c3c3', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th} />
              <th style={th}>Item Code</th>
              <th style={th}>Description (on invoice)</th>
              <th style={th} title="Packs / boxes on the invoice">Qty</th>
              <th style={th} title="Pieces in one pack">Pcs/Pack</th>
              <th style={th} title="How it is sold: one piece, a pair, … or the whole pack">Sell By</th>
              <th style={th} title="Units put in stock = Qty × Pcs/Pack ÷ Sell By">Units</th>
              <th style={th} title="Price of one pack on the invoice">Pack Cost</th>
              <th style={th}>Amount</th>
              <th style={th} title="Cost of one selling unit = Pack Cost ÷ units in a pack">Cost of 1</th>
              <th style={th}>Medicine in stock</th>
              <th style={th}>In stock</th>
              <th style={th} title="Selling price of one unit (blank = keep the current one)">Selling Price</th>
              <th style={th} title="Lowest price one unit may be sold for (KES)">Best Price</th>
              <th style={th}>VAT</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const p = l.productId !== undefined ? byId.get(l.productId) : undefined
              const u = unitsOf(l)
              const per = Number(l.perPack)
              const unitCostKes = u.unitCost / 100
              const sell = priceOf(l)
              const cb = currentBest(l)
              const bestN = l.best.trim() ? Number(l.best) : cb !== undefined ? cb / 100 : undefined
              const f = factorOf(l)
              const legacy = !!p && l.from !== 'medicine' && per > 1
              const dim = l.include ? undefined : '#999'
              return (
                <tr key={l.key} style={{ background: l.include ? undefined : '#f3f3f3', color: dim }}>
                  <td style={td}>
                    <input type="checkbox" checked={l.include} onChange={(e) => set(l.key, { include: e.target.checked })} aria-label={`Receive ${l.name}`} />
                  </td>
                  <td style={td}>{l.code}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>{l.name}</td>
                  <td style={td}>
                    <input className="ma-input" style={small(40)} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label={`Qty ${l.name}`} />
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(44), ...(l.from === 'invoice' ? { background: '#fff8d6' } : {}), ...bad(!!u.error && /Pcs/.test(u.error)) }}
                      value={l.perPack}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d]/g, '')
                        const n = Number(v) || 0
                        set(l.key, { perPack: v, from: 'typed', sellBy: n >= 1 && n % l.sellBy === 0 && l.sellBy <= n ? l.sellBy : 1 })
                      }}
                      aria-label={`Pcs per pack ${l.name}`}
                      title={l.from === 'invoice' ? 'Read from the description — check it' : l.from === 'medicine' ? 'As this medicine came last time' : 'Pieces in one pack (1 if it is sold as it comes)'}
                    />
                  </td>
                  <td style={td}>
                    <select className="ma-input" style={{ width: 96, height: 19, fontSize: 11 }} value={l.sellBy} disabled={!(per > 1)} onChange={(e) => set(l.key, { sellBy: Number(e.target.value) })} aria-label={`Sell by ${l.name}`}>
                      {sellByChoices(per > 1 ? per : 1).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 'bold', color: u.error ? '#c00' : dim }} title={u.error ?? `${l.qty} × ${per} pcs ÷ ${l.sellBy}`}>
                    {u.error ? '✖' : u.units}
                  </td>
                  <td style={td}>
                    <input className="ma-input" style={small(58)} value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} aria-label={`Cost ${l.name}`} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{((Number(l.qty) || 0) * (Number(l.cost) || 0)).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 'bold' }} title={`Cost of one ${l.sellBy === 1 ? 'piece' : `unit of ${l.sellBy} pcs`}`}>
                    {u.error ? '—' : unitCostKes.toFixed(2)}
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(190, false), color: p ? '#1b5e20' : '#e65100', fontWeight: 'bold' }}
                      list="ma-imp-products"
                      value={p ? p.name : 'NEW MEDICINE'}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value.trim().toUpperCase()
                        const m = products.find((x) => x.name.toUpperCase() === v)
                        if (m) {
                          const pk = packFor(m, l.name)
                          set(l.key, { productId: m.id, vat: m.taxable, best: '', ...pk, convert: pk.from !== 'medicine' && looksPerPack(m, Number(pk.perPack), Number(l.cost) || 0) })
                        }
                        else if (!v || v === 'NEW MEDICINE') set(l.key, { productId: undefined })
                      }}
                      aria-label={`Medicine in stock for ${l.name}`}
                      title={p ? `Adds to ${p.name} (${p.sku})` : 'Will be created as a new medicine. Type an existing name to match it instead.'}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: p?.maxStock !== undefined && p.stock * f + u.units > p.maxStock ? '#c00' : undefined }} title={p?.maxStock !== undefined ? `Max level ${p.maxStock}` : undefined}>
                    {p ? (f > 1 ? `${p.stock} → ${p.stock * f}` : p.stock) : '—'}
                    {p?.maxStock !== undefined && p.stock * f + u.units > p.maxStock ? ' ⚠' : ''}
                    {legacy && (
                      <label style={{ display: 'block', fontSize: 10, color: '#8a5a00', whiteSpace: 'nowrap' }} title={`This medicine was counted per pack before. Ticked: its ${p!.stock} in stock become ${p!.stock * (per / l.sellBy)} units, and its prices are divided by ${per / l.sellBy}.`}>
                        <input type="checkbox" checked={l.convert} onChange={(e) => set(l.key, { convert: e.target.checked })} aria-label={`Convert old stock ${l.name}`} /> convert old stock
                      </label>
                    )}
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(62), ...(sell > 0 && u.unitCost > 0 && sell * 100 < u.unitCost ? { color: '#c00' } : {}) }}
                      value={l.price}
                      placeholder={sell ? sell.toFixed(2) : 'price'}
                      onChange={(e) => set(l.key, { price: e.target.value })}
                      aria-label={`Selling price ${l.name}`}
                      title={p ? `Current selling price ${(p.price / 100).toFixed(2)}${f > 1 ? ` per pack = ${(Math.round(p.price / f) / 100).toFixed(2)} per unit` : ' per unit'} — type a new one to change it` : 'Selling price of one unit (blank = cost of 1 + markup)'}
                    />
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(62), background: '#fff8d6', ...bad(bestN !== undefined && sell > 0 && bestN > sell) }}
                      value={l.best}
                      placeholder={cb !== undefined ? (cb / 100).toFixed(2) : 'lowest'}
                      onChange={(e) => set(l.key, { best: e.target.value })}
                      aria-label={`Best Price ${l.name}`}
                      title="Lowest price one unit may be sold for (KES, not %)"
                    />
                  </td>
                  <td style={td}>
                    <input type="checkbox" checked={l.vat} disabled={!!p} onChange={(e) => set(l.key, { vat: e.target.checked })} title={p ? 'As set on the medicine' : 'Tick if VAT is charged when this medicine is sold'} aria-label={`VAT ${l.name}`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="ma-imp-products">
          <option value="NEW MEDICINE" />
          {products.map((p) => (
            <option key={p.id} value={p.name.toUpperCase()} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Btn onClick={onClose}>◀ Back</Btn>
        <Btn onClick={() => void receive()} disabled={saving || !loaded || !medDocs || !chosen.length}>
          {saving ? 'Receiving…' : !loaded || !medDocs ? 'Matching…' : `Receive ${chosen.length} line(s) into stock`}
        </Btn>
        <span className="ma-label ma-note" style={{ fontSize: 10 }}>
          Files one Pur/GRN (Direct Invoice) with this PDF attached; stock goes up by each line&apos;s Units and the cost price becomes its Cost of 1.
        </span>
      </div>
    </Dialog>
  )
}

/** Review and receive a stock report CSV imported from another chemist. */
function StockReportReview({ stock, file, onClose, onDone }: { stock: StockReportLine[]; file: { name: string; data: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const loaded = useLiveQuery(() => db.products.toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const lastExpense = useLiveQuery(async () => (await db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).sort((a, b) => b.createdAt - a.createdAt)[0]?.values.expense ?? '', [], '')
  const products = loaded ?? []
  const byId = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products])
  const [vendor, setVendor] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [expense, setExpense] = useState<string>()
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<StockReportLine[] | null>(null)
  const expenseV = expense ?? lastExpense

  if (lines === null && loaded) {
    setLines(
      stock.map((l) => {
        const p = matchProduct(products, l.code, l.name)
        return { ...l, productId: p?.id }
      }),
    )
  }
  const list = lines ?? []
  const set = (key: number, patch: Partial<StockReportLine>) => setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const chosen = list.filter((l) => l.include)
  const AMOUNT = /^\d+(\.\d{0,2})?$/

  const receive = async () => {
    if (saving || !user) return
    if (!chosen.length) return toast('Tick at least one line to receive', 'error')
    for (const l of chosen) {
      const received = Number(l.received || l.closing || '0')
      if (!(received > 0)) return toast(`${l.name}: enter Received or Closing Stock above 0`, 'error')
      if (l.retail.trim() && (!AMOUNT.test(l.retail.trim()) || toCents(l.retail) <= 0)) return toast(`${l.name}: Retail Price must be an amount above 0`, 'error')
      if (l.whole.trim() && (!AMOUNT.test(l.whole.trim()) || toCents(l.whole) <= 0)) return toast(`${l.name}: Whole Price must be an amount above 0`, 'error')
      if (l.best.trim() && (!AMOUNT.test(l.best.trim()) || toCents(l.best) <= 0)) return toast(`${l.name}: Best Price must be an amount above 0`, 'error')
      if (l.productId === undefined && toCents(l.retail || '0') <= 0) return toast(`${l.name} is new: type its Retail Price`, 'error')
    }
    const dup = (await db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).find(
      (d) => invoiceNo.trim() && d.values.invoice === invoiceNo.trim() && (d.values.vendorName ?? '').toUpperCase() === vendor.trim().toUpperCase(),
    )
    if (dup && !confirm(`${vendor} invoice ${invoiceNo} was already received as ${dup.values.docNo}. Receive it again (stock will be added twice)?`)) return
    setSaving(true)
    try {
      const r = await receiveStockReport({
        lines: chosen.map((l) => {
          const qty = Number(l.received || l.closing || '0')
          const cost = toCents(l.retail || '0') // no cost column on stock report: treat retail as cost basis when no cost is known
          return {
            code: l.code || undefined,
            name: l.name,
            uom: l.uom,
            qty,
            costCents: cost,
            priceCents: l.productId === undefined ? toCents(l.retail) : l.retail.trim() ? toCents(l.retail) : undefined,
            wholeCents: l.whole.trim() ? toCents(l.whole) : undefined,
            bestCents: l.best.trim() ? toCents(l.best) : undefined,
            productId: l.productId,
            taxable: false,
          }
        }),
        vendor: vendor || 'OTHER CHEMIST',
        invoiceNo,
        totalCents: chosen.reduce((s, l) => s + Number(l.received || l.closing || '0') * toCents(l.retail || '0'), 0),
        expense: expenseV,
        receivedBy: user.name,
        userId: user.id,
      })
      await logActivity('stock', `Stock report received (${r.docNo})`, { detail: `${vendor} ${invoiceNo}: ${r.updated} topped up, ${r.added} new`, userId: user.id, userName: user.name })
      toast(`${r.docNo}: ${r.updated + r.added} medicine(s) received — ${r.updated} topped up, ${r.added} new`)
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, background: '#e9e9e9', fontSize: 11, textAlign: 'left', padding: '4px 4px', borderBottom: '1px solid #bbb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { fontSize: 11, padding: '2px 4px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const small = (w: number, right = true): React.CSSProperties => ({ width: w, height: 19, fontSize: 11, textAlign: right ? 'right' : 'left', padding: '0 3px' })
  const shown = list.filter((l) => !q.trim() || `${l.code} ${l.name}`.toUpperCase().includes(q.trim().toUpperCase()))
  return (
    <Dialog title={`Upload Stock Report — ${file.name}`} onClose={onClose} width={1400}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn onClick={onClose} title="Back to Pur/GRN (Direct Invoice) without receiving">
          ◀ Back
        </Btn>
        <label className="ma-label">
          Vendor / Other Chemist{' '}
          <input className="ma-input" style={{ width: 230 }} value={vendor} list="ma-sr-vendors" onChange={(e) => setVendor(e.target.value.toUpperCase())} placeholder="Supplier / chemist name" aria-label="Vendor Name" />
        </label>
        <label className="ma-label">
          Doc / Ref No <Input value={invoiceNo} onChange={setInvoiceNo} width={120} placeholder="Reference no." />
        </label>
        <label className="ma-label">
          Expense A/c <Input value={expenseV} onChange={setExpense} width={170} placeholder="e.g. PURCHASES MEDICINE" />
        </label>
        <datalist id="ma-sr-vendors">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name.toUpperCase()} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '8px 0', fontSize: 11, flexWrap: 'wrap' }}>
        <span>
          <b>{list.length}</b> lines read from {file.name}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          Receiving <b>{chosen.length}</b> line(s)
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <Input value={q} onChange={setQ} width={260} placeholder="Find a line by code or name" />
        <Check checked={list.length > 0 && list.every((l) => l.include)} onChange={(v) => setLines((ls) => (ls ?? []).map((l) => ({ ...l, include: v })))} dark>
          All
        </Check>
        <span className="ma-label ma-note" style={{ fontSize: 10 }}>
          Qty received is added to stock. For new medicines the Retail Price is required. Whole Price and Best Price are stored on the medicine form. UOM is saved with the medicine.
        </span>
      </div>
      <div style={{ height: 400, overflow: 'auto', border: '1px solid #c3c3c3', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th} />
              <th style={th}>Item Code</th>
              <th style={th}>Product Name</th>
              <th style={th}>UOM</th>
              <th style={th}>Opening</th>
              <th style={th}>Received</th>
              <th style={th}>Issued</th>
              <th style={th}>Closing</th>
              <th style={th}>Retail Price</th>
              <th style={th}>Whole Price</th>
              <th style={th}>Best Price</th>
              <th style={th}>Match Medicine</th>
              <th style={th}>In Stock</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const p = l.productId !== undefined ? byId.get(l.productId) : undefined
              const dim = l.include ? undefined : '#999'
              return (
                <tr key={l.key} style={{ background: l.include ? undefined : '#f3f3f3', color: dim }}>
                  <td style={td}>
                    <input type="checkbox" checked={l.include} onChange={(e) => set(l.key, { include: e.target.checked })} aria-label={`Receive ${l.name}`} />
                  </td>
                  <td style={td}>{l.code}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 200 }}>{l.name}</td>
                  <td style={td}>
                    <input className="ma-input" style={small(50, false)} value={l.uom} onChange={(e) => set(l.key, { uom: e.target.value.toUpperCase() })} placeholder="ML, MG, TABS" aria-label={`UOM ${l.name}`} />
                  </td>
                  <td style={td}>{l.opening}</td>
                  <td style={td}>
                    <input className="ma-input" style={small(50)} value={l.received} onChange={(e) => set(l.key, { received: e.target.value })} placeholder="Qty received" aria-label={`Received ${l.name}`} />
                  </td>
                  <td style={td}>{l.issued}</td>
                  <td style={td}>{l.closing}</td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(62), ...(l.retail.trim() && !AMOUNT.test(l.retail.trim()) ? { color: '#c00' } : {}) }}
                      value={l.retail}
                      onChange={(e) => set(l.key, { retail: e.target.value })}
                      placeholder="0.00"
                      aria-label={`Retail Price ${l.name}`} />
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(62), ...(l.whole.trim() && !AMOUNT.test(l.whole.trim()) ? { color: '#c00' } : {}) }}
                      value={l.whole}
                      onChange={(e) => set(l.key, { whole: e.target.value })}
                      placeholder="0.00"
                      aria-label={`Whole Price ${l.name}`} />
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(62), ...(l.best.trim() && !AMOUNT.test(l.best.trim()) ? { color: '#c00' } : {}) }}
                      value={l.best}
                      onChange={(e) => set(l.key, { best: e.target.value })}
                      placeholder="lowest"
                      aria-label={`Best Price ${l.name}`} />
                  </td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(170, false), color: p ? '#1b5e20' : '#e65100', fontWeight: 'bold' }}
                      list="ma-sr-products"
                      value={p ? p.name : 'NEW MEDICINE'}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value.trim().toUpperCase()
                        const m = products.find((x) => x.name.toUpperCase() === v)
                        if (m) set(l.key, { productId: m.id })
                        else if (!v || v === 'NEW MEDICINE') set(l.key, { productId: undefined })
                      }}
                      aria-label={`Medicine match ${l.name}`} />
                  </td>
                  <td style={td}>{p ? String(p.stock) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="ma-sr-products">
          <option value="NEW MEDICINE" />
          {products.map((p) => (
            <option key={p.id} value={p.name.toUpperCase()} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Btn onClick={onClose}>◀ Back</Btn>
        <Btn onClick={() => void receive()} disabled={saving || !loaded || !chosen.length}>
          {saving ? 'Receiving…' : !loaded ? 'Matching…' : `Receive ${chosen.length} line(s) into stock`}
        </Btn>
        <span className="ma-label ma-note" style={{ fontSize: 10 }}>
          Files one Pur/GRN (Direct Invoice); stock goes up by each line's Received qty and prices are saved on the medicine.
        </span>
      </div>
    </Dialog>
  )
}
