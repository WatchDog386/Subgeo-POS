// Pur/GRN (Direct Invoice) → "Upload Supplier Invoice (PDF)".
// Reads every item line of a supplier's invoice / proforma / sales order,
// matches each to a medicine already in stock (by item code, then name),
// lets the buyer check it, then receives it in one go: stock up, cost
// updated, new medicines created, and one MRN document filed with the PDF
// attached and every line (synced to the server like any document).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { logActivity } from '../../db/logs'
import type { DocLine, DocRecord, Product, Supplier } from '../../db/types'
import { toCents } from '../../lib/money'
import { invoiceDate, type ParsedInvoice } from '../../lib/invoiceParse'
import { matchMedicine, medKey, packContents, type MedKey } from '../../lib/medMatch'
import { api } from '../../db/sync'
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
  /** The description exactly as read from the document (name = the corrected one). */
  read: string
  /** How the name was found: exact, autocorrected, picked by the buyer, or still unsure / none. */
  fix: 'exact' | 'auto' | 'picked' | 'ask' | 'none'
  /** Close medicines from the company list, best first (for "Did you mean"). */
  options: { name: string; score: number }[]
}

/** One medicine of the company's price list (every chemist): GET /admin/catalogue. */
export type CatalogueItem = { name: string; sku: string; price: number; cost: number; minPrice: number | null; taxable: boolean; packSize: number | null; sellBy: number | null; chem?: string }
/** A medicine a line can be corrected to: one in this chemist's stock, or one from the company list. */
export type MedCandidate = { name: string; sku: string; productId?: number; price?: number; minPrice?: number; taxable: boolean; packSize?: number; sellBy?: number; chem?: string }

/** This chemist's medicines first, then the company list's others (same name = same medicine). */
export function candidatesFrom(products: Product[], catalogue: CatalogueItem[]): MedCandidate[] {
  const out: MedCandidate[] = products.filter((p) => p.active !== false && !/^SRV-/i.test(p.sku)).map((p) => ({ name: p.name.toUpperCase(), sku: p.sku, productId: p.id, taxable: p.taxable }))
  const have = new Set(out.map((c) => norm(c.name)))
  for (const c of catalogue) {
    if (have.has(norm(c.name))) continue
    have.add(norm(c.name))
    out.push({ name: c.name.toUpperCase(), sku: c.sku, price: c.price || undefined, minPrice: c.minPrice ?? undefined, taxable: c.taxable, packSize: c.packSize ?? undefined, sellBy: c.sellBy ?? undefined, chem: c.chem })
  }
  return out
}

/**
 * Autocorrect one name read from a document (often handwritten, misspelt)
 * against the medicine list: the medicine to use when sure, and the close
 * ones to offer either way.
 */
export function autocorrect(read: string, cands: MedCandidate[], keys?: Map<MedCandidate, MedKey>): { use?: MedCandidate; score?: number; options: { item: MedCandidate; score: number }[] } {
  const exact = cands.find((c) => norm(c.name) === norm(read))
  if (exact) return { use: exact, score: 1, options: [{ item: exact, score: 1 }] }
  const m = matchMedicine(read, cands, (c) => c.name, keys)
  return { use: m.auto?.item, score: m.auto?.score, options: m.best }
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
/** A short plain number (001, 12, 330): a row number, never a medicine's code. */
export const isRowNumber = (code: string) => /^\d{1,4}$/.test(code.trim())

/** Medicine already in stock for an invoice line: same item code, else same name. */
export function matchProduct(products: Product[], code: string | undefined, name: string): Product | undefined {
  const c = (code ?? '').trim().toUpperCase()
  // 001, 002 … on an order book are row numbers, not item codes.
  if (c && !isRowNumber(c)) {
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
  const mult = t.match(/\b(\d{1,3})\s*[X×]\s*(\d{1,3})(?:\s*'?S)?\b(?!\s*(?:ML|MG|G|GM|L|MCG|IU|%))/)
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
      // The same new medicine twice on one document: the second line tops up the first.
      if (!p && l.productId === undefined) p = await db.products.filter((x) => norm(x.name) === norm(l.name)).first()
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
          // An order document with no price: keep the medicine's current cost.
          ...(l.costCents > 0 ? { cost: l.costCents } : {}),
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
        if (!sku || isRowNumber(sku)) sku = await nextDocNo('PRD00')
        if (await db.products.where('sku').equals(sku).first()) sku = `${sku}-${now.toString(36).toUpperCase()}-${added}`
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
      const unitCost = l.costCents > 0 ? l.costCents : p!.cost
      const total = l.packs && l.packCostCents ? Math.round(l.packs * l.packCostCents) : Math.round(l.qty * unitCost)
      docLines.push({
        productId: p!.id,
        name: p!.name,
        sku: p!.sku,
        qty: l.qty,
        cost: unitCost,
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
        const values: Record<string, string> = { ...(doc?.values ?? { docNo: p!.sku, name: p!.name.toUpperCase(), type: 'S' }), packSize: String(l.perPack), sellBy: String(l.sellBy ?? 1), cost: (unitCost / 100).toFixed(2), retail: (p!.price / 100).toFixed(2), ...(packContents(p!.name).label ? { contents: packContents(p!.name).label } : {}) }
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

/** Pick the PDF, read it, then show the review. */
export function useInvoiceUpload(onDone?: () => void) {
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{ file: { name: string; data: string }; inv: ParsedInvoice } | null>(null)
  const pick = () => input.current?.click()
  const onFile = async (f: File) => {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast('Choose the supplier invoice as a PDF file', 'error')
    if (f.size > 10 * 1024 * 1024) return toast('PDF is too big (max 10 MB)', 'error')
    setBusy(true)
    try {
      const { readInvoicePdf } = await import('../../lib/pdf')
      const inv = await readInvoicePdf(f)
      if (!inv.lines.length)
        throw new Error(
          inv.textChars < 20
            ? 'This PDF is a scanned picture: it has no text to read. Ask the supplier for the PDF their system produces, or key the lines in with Pur/GRN (Direct Invoice) → +.'
            : 'No item lines found in this PDF. It needs a table with a Description and a Qty/Units column (and prices, or prices left blank). Key the lines in with Pur/GRN (Direct Invoice) → + instead.',
        )
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = () => rej(r.error)
        r.readAsDataURL(f)
      })
      setReview({ file: { name: f.name, data }, inv })
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
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      {review && (
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
  // The company's medicine / price list (all chemists) to autocorrect names; [] offline.
  const [catalogue, setCatalogue] = useState<CatalogueItem[] | null>(null)
  useEffect(() => {
    let live = true
    api<CatalogueItem[]>('/admin/catalogue', { timeoutMs: 8000 })
      .then((c) => live && setCatalogue(Array.isArray(c) ? c : []))
      .catch(() => live && setCatalogue([]))
    return () => {
      live = false
    }
  }, [])
  const cands = useMemo(() => (loaded && catalogue ? candidatesFrom(loaded, catalogue) : []), [loaded, catalogue])
  const candKeys = useMemo(() => new Map(cands.map((c) => [c, medKey(c.name)])), [cands])
  const markupV = markup ?? savedMarkup
  const expenseV = expense ?? lastExpense

  /** Pack size / sell-by remembered for a medicine from an earlier invoice (Medicine form record). */
  const remembered = (p: Product | undefined) => {
    if (!p) return undefined
    const d = (medDocs ?? []).find((x) => (x.values.docNo ?? '').trim().toUpperCase() === p.sku.trim().toUpperCase()) ?? (medDocs ?? []).find((x) => (x.values.name ?? '').trim().toUpperCase() === p.name.trim().toUpperCase())
    const per = Math.round(Number(d?.values.packSize) || 0)
    return per >= 1 && d?.values.sellBy ? { perPack: per, sellBy: Math.max(1, Math.round(Number(d.values.sellBy) || 1)) } : undefined
  }
  const packFor = (p: Product | undefined, ...names: string[]) => {
    const r = remembered(p)
    if (r) return { perPack: String(r.perPack), sellBy: r.sellBy, from: 'medicine' as const }
    const n = names.map(packSizeFrom).find((x) => x > 1) ?? 1
    return { perPack: String(n), sellBy: 1, from: n > 1 ? ('invoice' as const) : ('none' as const) }
  }
  /** Line fields for a medicine picked from the list (in stock here, or new from the company list). */
  const fromCand = (c: MedCandidate, l: { code: string; read: string; cost: number }): Partial<ImportLine> => {
    const p = c.productId !== undefined ? products.find((x) => x.id === c.productId) : undefined
    if (p) {
      const pk = packFor(p, p.name, l.read)
      return { productId: p.id, name: p.name.toUpperCase(), vat: p.taxable, price: '', best: '', ...pk, convert: pk.from !== 'medicine' && looksPerPack(p, Number(pk.perPack), l.cost) }
    }
    const pk = c.packSize && c.packSize >= 1 ? { perPack: String(c.packSize), sellBy: c.sellBy && c.packSize % c.sellBy === 0 ? c.sellBy : 1, from: 'medicine' as const } : packFor(undefined, c.name, l.read)
    return {
      productId: undefined,
      name: c.name,
      // Order books number their rows (001, 002…): use the code the medicine has in the price list.
      code: !l.code.trim() || isRowNumber(l.code) ? c.sku : l.code,
      price: c.price ? (c.price / 100).toFixed(2) : '',
      best: c.minPrice ? (c.minPrice / 100).toFixed(2) : '',
      vat: c.taxable,
      ...pk,
      convert: false,
    }
  }

  /** Old per-pack medicine: convert by default only when its price still looks like a pack price. */
  // No pack cost (an order book): nothing to compare with, so leave it unticked.
  const looksPerPack = (p: Product | undefined, perPack: number, packCostKes: number) => !!p && perPack > 1 && packCostKes > 0 && p.price >= 0.6 * Math.round(packCostKes * 100)

  // Match once the medicines (and their pack sizes) have loaded.
  if (lines === null && loaded && medDocs && catalogue) {
    setLines(
      inv.lines.map((l, i) => {
        const read = l.name.toUpperCase().replace(/\s+/g, ' ').trim()
        const base = { key: i, include: true, code: l.code ?? '', name: read, read, qty: String(l.qty), cost: l.unitPrice.toFixed(2), price: '', best: '', convert: false }
        // Same item code or exactly the same name: no correction needed.
        const p = matchProduct(products, l.code, l.name)
        if (p) {
          const pk = packFor(p, l.name)
          return { ...base, productId: p.id, name: p.name.toUpperCase(), vat: p.taxable, ...pk, convert: pk.from !== 'medicine' && looksPerPack(p, Number(pk.perPack), l.unitPrice), fix: 'exact' as const, options: [] }
        }
        // Misspelt / handwritten: the closest medicine of this chemist or of the company list.
        const ac = autocorrect(read, cands, candKeys)
        const options = ac.options.map((o) => ({ name: o.item.name, score: o.score }))
        if (ac.use) return { ...base, vat: false, ...packFor(undefined, read), ...fromCand(ac.use, { code: base.code, read, cost: l.unitPrice }), fix: norm(ac.use.name) === norm(read) ? ('exact' as const) : ('auto' as const), options } as ImportLine
        return { ...base, productId: undefined, vat: false, ...packFor(undefined, read), fix: options.length ? ('ask' as const) : ('none' as const), options }
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
  /** The buyer picks a medicine for a line by name (a suggestion, or any in the list); '' = keep it as read, new. */
  const pick = (l: ImportLine, name: string) => {
    const v = name.trim().toUpperCase()
    if (!v || v === 'NEW MEDICINE' || v === l.read) {
      return set(l.key, { productId: undefined, name: l.read, price: '', best: '', convert: false, ...packFor(undefined, l.read), fix: 'none' })
    }
    const c = cands.find((x) => x.name === v)
    if (c) set(l.key, { ...fromCand(c, { code: l.code, read: l.read, cost: Number(l.cost) || 0 }), fix: 'picked' })
  }
  const corrected = list.filter((l) => l.fix === 'auto').length
  const unsure = list.filter((l) => l.fix === 'ask' && l.include).length
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
      {inv.unpriced > 0 && (
        <div className="ma-note" style={{ margin: '8px 0 0', padding: '6px 10px', border: '1px solid #e0c96a', background: '#fff8d6', fontSize: 11, lineHeight: 1.4 }}>
          <b>{inv.title ?? 'Order document'}:</b> {inv.unpriced === list.length ? 'it lists quantities only, no prices' : `${inv.unpriced} line(s) have no price`}. Type each line&apos;s <b>Pack Cost</b> from the supplier&apos;s invoice (Cost of 1 follows). A Pack Cost
          left at 0 keeps the medicine&apos;s current cost. New medicines need a Selling Price. Item codes 001, 002… are row numbers: lines are matched to your medicines by name. Untick lines that did not arrive.
          {inv.skipped.length > 0 && (
            <div style={{ marginTop: 4, color: '#8a5a00' }}>
              <b>No quantity on the document, not received:</b> {inv.skipped.join(' · ')}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '8px 0', fontSize: 11, flexWrap: 'wrap' }}>
        <span>
          <b>{list.length}</b> lines read from {inv.pages} page(s){inv.date ? ` · dated ${inv.date}` : ''} · {chosen.reduce((s, l) => s + (Number(l.qty) || 0), 0)} item(s) in all
        </span>
        <span style={{ color: inv.unpriced === list.length ? '#8a5a00' : adds ? '#2e7d32' : '#c00', fontWeight: 'bold', display: inv.unpriced === list.length ? 'none' : undefined }}>
          {inv.subtotal === undefined ? `Lines total ${amt(Math.round(inv.linesTotal * 100))} (no subtotal printed to check against)` : adds ? `✓ Lines add up to the invoice subtotal ${amt(Math.round(inv.subtotal * 100))}` : `⚠ Lines total ${amt(Math.round(inv.linesTotal * 100))} but the invoice subtotal is ${amt(Math.round(inv.subtotal * 100))} — check for missed lines`}
        </span>
        {inv.vat !== undefined && <span>VAT {amt(Math.round(inv.vat * 100))}</span>}
        {inv.total !== undefined && <span>Invoice total {amt(Math.round(inv.total * 100))}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {corrected > 0 && <span style={{ color: '#2e7d32', marginRight: 10 }}>✓ {corrected} name(s) corrected</span>}
          {unsure > 0 && <b style={{ color: '#ef6c00', marginRight: 10 }}>{unsure} to check (Did you mean…?)</b>}
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
              <th style={th} title="Corrected to the medicine list; what the document said is shown under it">Description (corrected)</th>
              <th style={th} title="What one pack holds: tablets / capsules / pieces, or ml for a syrup">Size</th>
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
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 240, ...(l.fix === 'ask' && l.include ? { background: '#fff3e0' } : {}) }}>
                    <span style={{ fontWeight: l.fix === 'auto' || l.fix === 'picked' ? 'bold' : undefined }}>{l.name}</span>
                    {l.fix === 'auto' && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: '#2e7d32' }} title="Spelling corrected from the medicine list — check it">
                        ✓ corrected
                      </span>
                    )}
                    {l.read !== l.name && (
                      <div style={{ fontSize: 10, color: '#777' }} title="As written on the document">
                        read: {l.read}
                      </div>
                    )}
                    {l.options.length > 0 && (l.fix === 'ask' || l.fix === 'auto' || l.fix === 'picked' || l.fix === 'none') && (
                      <select
                        className="ma-input"
                        style={{ display: 'block', width: 230, height: 19, fontSize: 10, marginTop: 1, ...(l.fix === 'ask' ? { borderColor: '#ef6c00' } : {}) }}
                        value={l.fix === 'ask' ? '?' : l.fix === 'none' ? '' : l.name}
                        onChange={(e) => e.target.value !== '?' && pick(l, e.target.value)}
                        aria-label={`Did you mean ${l.read}`}
                      >
                        {l.fix === 'ask' && <option value="?">Did you mean…? ({l.options.length})</option>}
                        {l.options.map((o) => (
                          <option key={o.name} value={o.name}>
                            {o.name} ({Math.round(o.score * 100)}%)
                          </option>
                        ))}
                        <option value="">Keep as read (new medicine)</option>
                      </select>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 10, color: '#37474f' }} title="What one pack holds (from the medicine's name)">
                    {packContents(l.name).label || packContents(l.read).label || '—'}
                  </td>
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
                        if (!v || v === 'NEW MEDICINE') set(l.key, { productId: undefined })
                        else if (cands.some((x) => x.productId !== undefined && x.name === v)) pick(l, v)
                      }}
                      aria-label={`Medicine in stock for ${l.name}`}
                      title={p ? `Adds to ${p.name} (${p.sku})` : `Will be created as a new medicine named ${l.name}. Type an existing name to match it instead.`}
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
          {cands
            .filter((c) => c.productId !== undefined)
            .map((c) => (
              <option key={c.productId} value={c.name} />
            ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Btn onClick={onClose}>◀ Back</Btn>
        <Btn onClick={() => void receive()} disabled={saving || !loaded || !medDocs || !catalogue || !chosen.length}>
          {saving ? 'Receiving…' : !loaded || !medDocs || !catalogue ? 'Matching…' : `Receive ${chosen.length} line(s) into stock`}
        </Btn>
        <span className="ma-label ma-note" style={{ fontSize: 10 }}>
          Files one Pur/GRN (Direct Invoice) with this PDF attached; stock goes up by each line&apos;s Units and the cost price becomes its Cost of 1.
        </span>
      </div>
    </Dialog>
  )
}
