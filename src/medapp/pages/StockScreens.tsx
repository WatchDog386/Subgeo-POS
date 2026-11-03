// Stock screens (legacy screenshots 31 Oct 2026):
//   GrnEntry          Pur/GRN (Direct Invoice) → +  : VENDOR DETAILS / PRODUCT DETAILS
//   StockAdjustEntry  Stock Adjust − and Stock Adjust +(DBH) : HEADER / DETAIL
// Saving moves stock right away (one transaction); editing a saved document
// first undoes its old quantities; deleting undoes them.
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { DocLine, DocRecord, Product, Supplier } from '../../db/types'
import { toCents } from '../../lib/money'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { amt, dmy, nextDocNo, parseDmy, peekDocNo, useMedDefaults } from '../data'
import { EyeIcon } from '../icons'
import { Btn, Check, DateField, Dialog, Grid, IBtn, Input, PickList, Select } from '../ui'
import { Cell, DeleteX, Field, LookupBtn, RefreshGlyph, SubTabs, c2, head, n, openSms, panel, printSheet, useEntryKeys } from './EntryScreens'
import { ProductLookup } from './ProductLookup'
import { useInvoiceUpload } from './InvoiceImport'

const GRN = 'pur-grn-direct-invoice'
export const ADJUST_MINUS = 'stock-adjust-minus'
export const ADJUST_PLUS = 'stock-adjust-plus'

/* ── Stock effects (also used by the tests) ─────────────────────────────── */

/**
 * Receive (sign 1) or undo (sign −1) a GRN's lines. Receiving tops each
 * medicine up, sets its cost to the line's net unit cost and, when the line
 * sets one, its selling price. Call inside a transaction on products + movements.
 */
export async function applyGrn(doc: Pick<DocRecord, 'values' | 'lines'>, sign: 1 | -1, userId?: number, supplierId?: number): Promise<void> {
  const now = Date.now()
  for (const l of doc.lines ?? []) {
    if (l.productId === undefined || l.qty <= 0) continue
    const p = await db.products.get(l.productId)
    if (!p) continue
    const change = sign * l.qty
    const patch: Partial<Product> = { stock: p.stock + change, updatedAt: now }
    if (sign > 0) {
      if (l.cost > 0) patch.cost = l.cost
      if (l.retail && l.retail > 0) patch.price = l.retail
      if (l.best && l.best > 0) patch.minPrice = l.best
      if (p.supplierId === undefined && supplierId !== undefined) patch.supplierId = supplierId
    }
    await db.products.update(p.id!, patch)
    await db.movements.add({
      productId: p.id!,
      change,
      reason: sign > 0 ? 'receive' : 'adjust',
      reference: doc.values.docNo,
      note: sign > 0 ? `GRN ${doc.values.vendorName ?? ''} ${doc.values.invoice ?? ''}`.trim() : `GRN ${doc.values.docNo ?? ''} changed / deleted`,
      userId,
      at: now,
    })
  }
}

/** Types of adjustment, and the stock-ledger reason each one is filed under. */
export const ADJUST_TYPES: Record<string, { label: string; reason: 'damage' | 'count' | 'adjust' }[]> = {
  [ADJUST_MINUS]: [
    { label: 'Expiry', reason: 'damage' },
    { label: 'Damage', reason: 'damage' },
    { label: 'Loss / Theft', reason: 'damage' },
    { label: 'Count Shortage', reason: 'count' },
    { label: 'Internal Use', reason: 'adjust' },
    { label: 'Return To Supplier', reason: 'adjust' },
  ],
  [ADJUST_PLUS]: [
    { label: 'Expiry', reason: 'adjust' },
    { label: 'Opening Stock', reason: 'adjust' },
    { label: 'Count Excess', reason: 'count' },
    { label: 'Found', reason: 'count' },
    { label: 'Return From Patient', reason: 'adjust' },
    { label: 'Donation Received', reason: 'adjust' },
  ],
}

/** Apply (sign 1) or undo (sign −1) a stock adjustment. Minus takes stock off, plus adds it. */
export async function applyAdjust(slug: string, doc: Pick<DocRecord, 'values' | 'lines'>, sign: 1 | -1, userId?: number): Promise<void> {
  const dir = slug === ADJUST_MINUS ? -1 : 1
  const now = Date.now()
  for (const l of doc.lines ?? []) {
    if (l.productId === undefined || l.qty <= 0) continue
    const p = await db.products.get(l.productId)
    if (!p) continue
    const change = dir * sign * l.qty
    const patch: Partial<Product> = { stock: p.stock + change, updatedAt: now }
    // Stock Adjust + may set the cost / selling price (e.g. opening stock).
    if (dir > 0 && sign > 0) {
      if (l.cost > 0 && l.cost !== p.cost) patch.cost = l.cost
      if (l.rate > 0 && l.rate !== p.price) patch.price = l.rate
      if (l.best && l.best > 0 && l.best !== p.minPrice) patch.minPrice = l.best
    }
    await db.products.update(p.id!, patch)
    const reason = ADJUST_TYPES[slug]?.find((t) => t.label === l.reason)?.reason ?? 'adjust'
    await db.movements.add({ productId: p.id!, change, reason, reference: doc.values.docNo, note: `${l.reason ?? 'ADJUSTMENT'}${sign < 0 ? ' (changed / deleted)' : ''}`, userId, at: now })
  }
}

/**
 * Would replacing `previous` with `lines` take any medicine below zero?
 * direction −1: the lines take stock off (Stock Adjust −); +1: they add it.
 */
export async function shortfall(lines: DocLine[], previous: DocLine[] | undefined, direction: -1 | 1): Promise<string | undefined> {
  const delta = new Map<number, number>()
  for (const l of lines) if (l.productId !== undefined) delta.set(l.productId, (delta.get(l.productId) ?? 0) + direction * l.qty)
  for (const l of previous ?? []) if (l.productId !== undefined) delta.set(l.productId, (delta.get(l.productId) ?? 0) - direction * l.qty)
  for (const [pid, change] of delta) {
    if (change >= 0) continue
    const p = await db.products.get(pid)
    if (p?.trackStock && p.stock + change < 0) return `Only ${p.stock} of ${p.name} in stock`
  }
  return undefined
}

/* ══════════════════════ Pur/GRN (Direct Invoice) ══════════════════════════ */
type GLine = { key: string; productId?: number; name: string; code: string; qty: string; rate: string; discPct: string; less: string; vatPct: string; expiry: string; batch: string; retail: string; best: string }

function gCalc(l: GLine) {
  const qty = n(l.qty)
  const rate = toCents(l.rate || '0')
  const gross = Math.round(qty * rate)
  const discPct = Math.min(100, Math.max(0, n(l.discPct)))
  const discAmt = Math.round((gross * discPct) / 100)
  const less = Math.max(0, toCents(l.less || '0'))
  const net = Math.max(0, gross - discAmt - less)
  const vatPct = Math.max(0, n(l.vatPct))
  const vat = Math.round((net * vatPct) / 100)
  return { qty, rate, gross, discPct, discAmt, less, net, vatPct, vat, total: net + vat, unitCost: qty > 0 ? Math.round(net / qty) : 0, retail: l.retail.trim() ? toCents(l.retail) : 0, best: l.best.trim() ? toCents(l.best) : undefined }
}

const GRN_STATUS = ['GOOD RECEIVED', 'PARTLY RECEIVED', 'ON HOLD']
const DEFAULT_EXPENSE = 'PURCHASES MEDICINE'

export function GrnEntry({ editId, onClose }: { editId?: number; onClose: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const products = useLiveQuery(() => db.products.filter((p) => !/^SRV-/i.test(p.sku)).toArray(), [], [] as Product[])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const register = useLiveQuery(() => db.docs.where('slug').equals(GRN).toArray(), [], [] as DocRecord[])
  const upload = useInvoiceUpload(onClose)
  const [tab, setTab] = useState<'vendor' | 'product'>('vendor')
  const blank = (): GLine => ({ key: `${Date.now()}-${Math.random()}`, name: '', code: '', qty: '0.0', rate: '', discPct: '0.0', less: '0.0', vatPct: '0.0', expiry: '', batch: '', retail: '', best: '' })
  const [v, setV] = useState({ location: '', docNo: '', date: dmy(Date.now(), '/'), status: 'GOOD RECEIVED', receivedBy: '', vendor: '', phone: '', address: '', email: '', invoice: '', expense: '' })
  const [lines, setLines] = useState<GLine[]>([blank()])
  const [orig, setOrig] = useState<DocRecord>()
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ kind: 'product'; key: string } | { kind: 'vendor' | 'location' | 'status' | 'expense' } | null>(null)
  const [payable, setPayable] = useState(false)
  const [all, setAll] = useState(false)

  const expenses = useMemo(() => [...new Set([DEFAULT_EXPENSE, ...register.map((r) => (r.values.expense ?? '').toUpperCase()).filter(Boolean)])], [register])
  // A new GRN: next number, today, this chemist, the usual expense account.
  useEffect(() => {
    if (editId !== undefined) return
    void peekDocNo('MRN').then((no) => setV((x) => ({ ...x, docNo: no })))
  }, [editId])
  useEffect(() => {
    if (editId !== undefined) return
    setV((x) => ({ ...x, location: x.location || d.location, receivedBy: x.receivedBy || (user?.name.toUpperCase() ?? ''), expense: x.expense || [...register].sort((a, b) => b.createdAt - a.createdAt)[0]?.values.expense || DEFAULT_EXPENSE }))
  }, [d.location, user?.name, register.length, editId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Editing: load the saved GRN.
  useEffect(() => {
    if (editId === undefined) return
    void db.docs.get(editId).then(async (doc) => {
      if (!doc) return toast('That GRN no longer exists', 'error')
      setOrig(doc)
      const x = doc.values
      setV({ location: x.location ?? '', docNo: x.docNo ?? '', date: (x.mrnDate ?? dmy(doc.createdAt)).replace(/-/g, '/'), status: x.status ?? 'GOOD RECEIVED', receivedBy: x.receivedBy ?? '', vendor: x.vendorName ?? '', phone: x.phoneNo ?? '', address: x.address ?? '', email: x.email ?? '', invoice: x.invoice ?? '', expense: x.expense ?? '' })
      const ls: GLine[] = []
      for (const [i, l] of (doc.lines ?? []).entries()) {
        const p = l.productId !== undefined ? await db.products.get(l.productId) : undefined
        // Lines from an uploaded invoice keep the unit cost in "cost" and no discount detail.
        const typed = l.discPct !== undefined || l.retail !== undefined
        ls.push({ key: `e${i}`, productId: l.productId, name: l.name, code: l.sku ?? '', qty: String(l.qty), rate: c2(typed ? l.rate : l.cost), discPct: String(l.discPct ?? 0), less: c2(l.less ?? 0), vatPct: String(l.vatPct ?? 0), expiry: l.expiry ?? '', batch: l.batch ?? '', retail: c2(l.retail ?? p?.price ?? 0), best: l.best ? c2(l.best) : p?.minPrice ? c2(p.minPrice) : '' })
      }
      setLines(ls.length ? ls : [blank()])
    })
  }, [editId]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = lines.map(gCalc)
  const sum = calc.reduce((s, c) => ({ disc: s.disc + c.discAmt + c.less, vat: s.vat + c.vat, total: s.total + c.total }), { disc: 0, vat: 0, total: 0 })
  const setLine = (key: string, patch: Partial<GLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addRow = () => {
    setLines((ls) => [...ls, blank()])
    setTab('product')
  }
  const takeProduct = (key: string, p: Product) => {
    if (lines.some((l) => l.key !== key && l.productId === p.id)) return toast(`${p.name} is already on this GRN — change its Qty`, 'error')
    const cur = lines.find((l) => l.key === key)
    setLine(key, { productId: p.id, name: p.name, code: p.sku, rate: cur?.rate || c2(p.cost), retail: c2(p.price), best: p.minPrice ? c2(p.minPrice) : '', vatPct: cur && n(cur.vatPct) ? cur.vatPct : p.taxable ? '16' : '0.0', qty: cur && n(cur.qty) > 0 ? cur.qty : '1' })
  }
  const typedName = (key: string, name: string) => {
    const t = name.trim().toUpperCase()
    const p = products.find((x) => x.name.toUpperCase() === t || `${x.name} [${x.sku}]`.toUpperCase() === t)
    if (p) takeProduct(key, p)
    else setLine(key, { name, productId: undefined })
  }
  const pickVendor = (name: string) => {
    const s = suppliers.find((x) => x.name.toUpperCase() === name.toUpperCase())
    setV((x) => ({ ...x, vendor: name.toUpperCase(), phone: x.phone || s?.contactPhone || s?.phone || '', address: x.address || s?.address || s?.notes || '', email: x.email || s?.email || '' }))
  }

  const save = async () => {
    if (saving || !user) return
    const vendor = v.vendor.trim().toUpperCase()
    if (!vendor) {
      setTab('vendor')
      return toast('VENDOR DETAILS: type or look up the Vendor Name', 'error')
    }
    const dateMs = parseDmy(v.date)
    if (dateMs === undefined) {
      setTab('vendor')
      return toast('Mran Date must be dd/mm/yyyy', 'error')
    }
    if (v.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) return toast('Email ID does not look right', 'error')
    const filled = lines.map((l, i) => ({ l, c: calc[i] })).filter(({ l }) => l.name.trim())
    if (!filled.length) {
      setTab('product')
      return toast('PRODUCT DETAILS: look up at least one medicine', 'error')
    }
    for (const { l, c } of filled) {
      if (c.qty <= 0 || !Number.isInteger(c.qty)) return (setTab('product'), toast(`${l.name}: Qty must be a whole number above 0`, 'error'))
      if (c.rate <= 0) return (setTab('product'), toast(`${l.name}: enter the Rate (cost per unit on the invoice)`, 'error'))
      const p = l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined
      if (!p && c.retail <= 0) return (setTab('product'), toast(`${l.name} is a new medicine: enter its Selling Price`, 'error'))
      if (l.retail.trim() && !/^\d+(\.\d{0,2})?$/.test(l.retail.trim())) return (setTab('product'), toast(`${l.name}: Selling Price must be an amount, e.g. 150.00`, 'error'))
      if (l.best.trim() && !/^\d+(\.\d{0,2})?$/.test(l.best.trim())) return (setTab('product'), toast(`${l.name}: Best Price must be an amount in KES, e.g. 120.00 (not a %)`, 'error'))
      if (c.best !== undefined && c.best <= 0) return (setTab('product'), toast(`${l.name}: Best Price must be above 0 (leave it blank for none)`, 'error'))
      const sell = c.retail || p?.price || 0
      const floor = c.best ?? p?.minPrice
      if (sell > 0 && floor && sell < floor) return (setTab('product'), toast(`${l.name}: Best Price ${c2(floor)} is above the Selling Price ${c2(sell)} — the best price is the lowest it may be sold for`, 'error'))
    }
    // Editing down: what was received may already be sold.
    if (orig) {
      for (const o of orig.lines ?? []) {
        if (o.productId === undefined) continue
        const p = products.find((x) => x.id === o.productId)
        if (!p?.trackStock) continue
        const oldQty = (orig.lines ?? []).filter((x) => x.productId === o.productId).reduce((s, x) => s + x.qty, 0)
        const newQty = filled.filter(({ l }) => l.productId === o.productId).reduce((s, { c }) => s + c.qty, 0)
        if (p.stock - oldQty + newQty < 0) return (setTab('product'), toast(`${p.name}: only ${p.stock} left, so this GRN can't be cut by ${oldQty - newQty} (some was sold)`, 'error'))
      }
    }
    // Above the maximum level? Ask (deliveries can't always be split).
    const over: string[] = []
    for (const { l, c } of filled) {
      const p = l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined
      const before = (orig?.lines ?? []).filter((o) => o.productId === l.productId).reduce((s, o) => s + o.qty, 0)
      if (p?.maxStock !== undefined && p.stock - before + c.qty > p.maxStock) over.push(`${p.name}: ${p.stock - before + c.qty} (max ${p.maxStock})`)
    }
    if (over.length && !confirm(`This takes these medicines above their maximum level:\n\n${over.slice(0, 12).join('\n')}\n\nReceive anyway?`)) return
    // Selling below the new cost loses money on every unit: ask.
    // The cashier may come down to the Best Price, so check that too.
    const loss = filled
      .map(({ l, c }) => {
        const p = l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined
        const sell = c.retail || p?.price || 0
        const best = c.best ?? p?.minPrice
        return { l, c, sell, low: best && best < sell ? best : sell, isBest: !!best && best < sell }
      })
      .filter(({ c, low }) => low > 0 && c.unitCost > low)
      .map(({ l, c, low, isBest }) => `${l.name.toUpperCase()}: ${isBest ? 'Best Price' : 'sells at'} ${c2(low)}, costs ${c2(c.unitCost)}`)
    if (loss.length && !confirm(`These would sell below their new cost:\n\n${loss.slice(0, 12).join('\n')}\n\nSave anyway? (Change the Selling Price / Best Price to fix it.)`)) return
    setSaving(true)
    try {
      let docNo = v.docNo
      let id = editId
      await db.transaction('rw', [db.products, db.movements, db.suppliers, db.docs, db.kv], async () => {
        let supplier = (await db.suppliers.toArray()).find((s) => s.name.toUpperCase() === vendor)
        if (!supplier) {
          const sid = (await db.suppliers.add({ name: vendor, phone: v.phone.trim() || undefined, address: v.address.trim() || undefined, email: v.email.trim() || undefined } as Supplier)) as number
          supplier = await db.suppliers.get(sid)
        } else {
          const patch: Partial<Supplier> = {}
          if (!supplier.phone && v.phone.trim()) patch.phone = v.phone.trim()
          if (!supplier.address && v.address.trim()) patch.address = v.address.trim()
          if (!supplier.email && v.email.trim()) patch.email = v.email.trim()
          if (Object.keys(patch).length) await db.suppliers.update(supplier.id!, patch)
        }
        if (orig) await applyGrn(orig, -1, user.id)
        if (!orig) docNo = await nextDocNo('MRN')
        const docLines: DocLine[] = []
        for (const { l, c } of filled) {
          let pid = l.productId
          if (pid === undefined) {
            // A new medicine, created from this GRN.
            let sku = l.code.trim().toUpperCase()
            if (!sku || (await db.products.where('sku').equals(sku).first())) sku = await nextDocNo('PRD00')
            pid = (await db.products.add({ sku, barcode: sku, name: l.name.trim().toUpperCase(), fitment: [], cost: c.unitCost, price: c.retail, minPrice: c.best, stock: 0, reorderLevel: 0, supplierId: supplier?.id, taxable: c.vatPct > 0, serialized: false, trackStock: true, active: true, createdAt: Date.now(), updatedAt: Date.now() } as Product)) as number
          }
          const p = (await db.products.get(pid))!
          docLines.push({ productId: pid, name: p.name, sku: p.sku, qty: c.qty, cost: c.unitCost, rate: c.rate, vatPct: c.vatPct, vat: c.vat, discount: c.discAmt + c.less, total: c.total, batch: l.batch.trim().toUpperCase() || undefined, expiry: l.expiry.trim() || undefined, discPct: c.discPct, less: c.less, retail: c.retail || undefined, best: c.best })
        }
        const values: Record<string, string> = {
          ...(orig?.values ?? {}),
          docNo,
          mrnDate: dmy(dateMs),
          location: v.location.trim().toUpperCase(),
          status: v.status.trim().toUpperCase(),
          receivedBy: v.receivedBy.trim().toUpperCase(),
          vendorName: vendor,
          phoneNo: v.phone.trim(),
          address: v.address.trim(),
          email: v.email.trim(),
          invoice: v.invoice.trim(),
          expense: v.expense.trim().toUpperCase(),
          total: c2(docLines.reduce((s, x) => s + x.total, 0)),
        }
        const doc = { values, lines: docLines }
        if (id === undefined) id = (await db.docs.add({ slug: GRN, docNo, ...doc, createdAt: Date.now(), updatedAt: Date.now(), createdBy: user.id } as DocRecord)) as number
        else await db.docs.update(id, { ...doc, docNo, updatedAt: Date.now() })
        await applyGrn(doc, 1, user.id, supplier?.id)
      })
      toast(`${docNo} saved — ${filled.length} medicine(s) received into stock`)
      if (jasper)
        printSheet(
          `${d.companyName} — Pur/GRN (Direct Invoice) ${docNo}`,
          [
            ['Vendor', vendor],
            ['Invoice/Receipt No', v.invoice],
            ['Mran Date', v.date],
            ['Received By', v.receivedBy],
          ],
          ['#', 'Medicine', 'Qty', 'Rate', 'Disc', 'VAT', 'Total', 'Batch', 'Expiry'],
          filled.map(({ l, c }, i) => [String(i + 1), l.name.toUpperCase(), String(c.qty), c2(c.rate), c2(c.discAmt + c.less), c2(c.vat), c2(c.total), l.batch, l.expiry]),
          [['TOTAL VALUE', amt(sum.total)]],
        )
      if (sms) openSms(v.phone, `${d.companyName}: received invoice ${v.invoice || docNo}, total KES ${c2(sum.total)}. Thank you.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!orig || !user) return
    for (const l of orig.lines ?? []) {
      const p = l.productId !== undefined ? await db.products.get(l.productId) : undefined
      if (p?.trackStock && p.stock < l.qty) return toast(`Can't delete: ${p.name} has only ${p.stock} left of the ${l.qty} received (some was sold)`, 'error')
    }
    if (!confirm(`Delete ${orig.values.docNo}? Its ${orig.lines?.length ?? 0} line(s) are taken back out of stock.`)) return
    await db.transaction('rw', [db.products, db.movements, db.docs], async () => {
      await applyGrn(orig, -1, user.id)
      await db.docs.delete(orig.id)
    })
    toast(`${orig.values.docNo} deleted`)
    onClose()
  }
  useEntryKeys({ save: () => void save(), back: onClose, newRow: addRow })

  const W = { name: 138, qty: 46, rate: 62, pct: 46, amt: 58, vat: 44, total: 68, exp: 80, batch: 74, retail: 64 }
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px 18px', height: 32 }}>
        <span className="ma-title" style={{ minWidth: 280 }}>
          Pur/GRN (Direct Invoice){orig ? ` — ${orig.values.docNo ?? ''}` : ''}
        </span>
        <IBtn lg title="View the list" onClick={onClose}>
          <EyeIcon />
        </IBtn>
        <IBtn lg title="Clear the form" onClick={() => !orig && setLines([blank()])}>
          <RefreshGlyph />
        </IBtn>
        {!orig && (
          <span style={{ marginLeft: 120 }}>
            <Btn onClick={upload.pick} disabled={upload.busy} title="Read the supplier's PDF instead of typing it">
              {upload.busy ? 'Reading PDF…' : 'Upload Supplier Invoice (PDF)'}
            </Btn>
          </span>
        )}
        {upload.element}
      </div>
      <SubTabs
        tabs={[
          { id: 'vendor', label: 'VENDOR DETAILS' },
          { id: 'product', label: 'PRODUCT DETAILS' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'vendor' ? (
        <div style={{ ...panel, paddingTop: 34, display: 'flex', gap: 26 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '100px 180px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Location">
              <span style={{ display: 'inline-flex' }}>
                <Input value={v.location} onChange={(x) => setV({ ...v, location: x.toUpperCase() })} width={140} placeholder="Stock location" />
                <LookupBtn title="Pick a location" onClick={() => setPick({ kind: 'location' })} />
              </span>
            </Field>
            <Field label="Mran No">
              <Input value={v.docNo || '(auto)'} readOnly width={100} />
            </Field>
            <Field label="Mran Date">
              <DateField value={v.date} onChange={(x) => setV({ ...v, date: x })} />
            </Field>
            <Field label="Status">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={v.status} list="ma-grn-status" aria-label="Status" placeholder="e.g. GOOD RECEIVED" onChange={(e) => setV({ ...v, status: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick a status" onClick={() => setPick({ kind: 'status' })} />
              </span>
            </Field>
            <Field label="Received By">
              <Input value={v.receivedBy} onChange={(x) => setV({ ...v, receivedBy: x.toUpperCase() })} width={100} placeholder="Who received it" />
            </Field>
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '100px 220px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Vendor Name">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={v.vendor} list="ma-grn-vendors" aria-label="Vendor Name" placeholder="Type or look up" onChange={(e) => pickVendor(e.target.value)} />
                <LookupBtn title="Look up a vendor" onClick={() => setPick({ kind: 'vendor' })} />
              </span>
            </Field>
            <Field label="Phone No">
              <Input value={v.phone} onChange={(x) => setV({ ...v, phone: x })} width={100} placeholder="e.g. 0712 345 678" />
            </Field>
            <Field label="Address">
              <Input value={v.address} onChange={(x) => setV({ ...v, address: x })} width={200} placeholder="Town / street" />
            </Field>
            <Field label="Email ID">
              <Input value={v.email} onChange={(x) => setV({ ...v, email: x })} width={180} placeholder="orders@vendor.co.ke" />
            </Field>
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '110px 160px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Invoice/Receipt No">
              <Input value={v.invoice} onChange={(x) => setV({ ...v, invoice: x })} width={100} placeholder="Vendor's invoice no." />
            </Field>
            <Field label="Expense A/c">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={v.expense} list="ma-grn-expense" aria-label="Expense A/c" placeholder="e.g. PURCHASES MEDICINE" onChange={(e) => setV({ ...v, expense: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick an expense account" onClick={() => setPick({ kind: 'expense' })} />
              </span>
            </Field>
            <Field label="TOTAL VALUE">
              <Cell value={c2(sum.total)} width={100} right readOnly label="TOTAL VALUE" />
            </Field>
          </div>
          <datalist id="ma-grn-vendors">{suppliers.map((s) => <option key={s.id} value={s.name.toUpperCase()} />)}</datalist>
          <datalist id="ma-grn-status">{GRN_STATUS.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="ma-grn-expense">{expenses.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
      ) : (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="ma-label" style={{ fontSize: 11 }}>
              PRODUCT DETAILS FORM
            </span>
            <Btn onClick={addRow}>NEW ROW(F7)</Btn>
            <span className="ma-label" style={{ fontSize: 10 }}>
              Press the lookup to pick a medicine already in stock (it is topped up); type a new name to add a new medicine.
            </span>
          </div>
          <table style={{ borderCollapse: 'separate', borderSpacing: '3px 4px' }}>
            <thead>
              <tr>
                {[['S NO', 30], ['Medicine Name', W.name + 26], ['Qty', W.qty], ['Rate', W.rate], ['Disc%', W.pct], ['Disc Amt', W.amt], ['Less discount', W.amt], ['VAT %', W.vat], ['VAT Amt', W.amt], ['Total Amnt', W.total], ['Expiary Date', W.exp], ['Batch No', W.batch], ['Selling Price', W.retail], ['Best Price', W.retail], ['', 20]].map(([h, w]) => (
                  <th key={String(h) || 'x'} style={{ ...head, width: w as number }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = calc[i]
                const p = l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined
                return (
                  <tr key={l.key}>
                    <td style={{ fontSize: 11 }}>{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input
                        className="ma-input"
                        style={{ width: W.name, color: l.name && !p ? '#e65100' : undefined }}
                        value={l.name}
                        list="ma-grn-products"
                        placeholder="Look up or type"
                        aria-label="Medicine Name"
                        title={p ? `${p.name} (${p.sku}) — ${p.stock} in stock${p.maxStock !== undefined ? `, max ${p.maxStock}` : ''}` : l.name ? 'New medicine: it is added when you save' : ''}
                        onChange={(e) => typedName(l.key, e.target.value)}
                      />
                      <LookupBtn title="LookUp Box" onClick={() => setPick({ kind: 'product', key: l.key })} />
                    </td>
                    <td><Cell value={l.qty} onChange={(x) => setLine(l.key, { qty: x })} width={W.qty} right label="Qty" /></td>
                    <td><Cell value={l.rate} onChange={(x) => setLine(l.key, { rate: x })} width={W.rate} right label="Rate" placeholder="cost" /></td>
                    <td><Cell value={l.discPct} onChange={(x) => setLine(l.key, { discPct: x })} width={W.pct} right label="Disc%" /></td>
                    <td><Cell value={c2(c.discAmt)} width={W.amt} right readOnly label="Disc Amt" /></td>
                    <td><Cell value={l.less} onChange={(x) => setLine(l.key, { less: x })} width={W.amt} right label="Less discount" /></td>
                    <td><Cell value={l.vatPct} onChange={(x) => setLine(l.key, { vatPct: x })} width={W.vat} right label="VAT %" /></td>
                    <td><Cell value={c2(c.vat)} width={W.amt} right readOnly label="VAT Amt" /></td>
                    <td><Cell value={c2(c.total)} width={W.total} right readOnly label="Total Amnt" /></td>
                    <td><Cell value={l.expiry} onChange={(x) => setLine(l.key, { expiry: x })} width={W.exp} placeholder="dd-mm-yyyy" label="Expiary Date" /></td>
                    <td><Cell value={l.batch} onChange={(x) => setLine(l.key, { batch: x.toUpperCase() })} width={W.batch} placeholder="Batch no." label="Batch No" /></td>
                    <td><Cell value={l.retail} onChange={(x) => setLine(l.key, { retail: x })} width={W.retail} right label="Selling Price" placeholder={p ? '' : 'required'} /></td>
                    <td><Cell value={l.best} onChange={(x) => setLine(l.key, { best: x })} width={W.retail} right label="Best Price" placeholder="lowest" /></td>
                    <td>{lines.length > 1 && <DeleteX title="Remove this row" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}</td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ fontSize: 11 }}>SUM</td>
                <td colSpan={4} />
                <td>
                  <Cell value={c2(sum.disc)} width={W.amt} right readOnly label="SUM Disc" />
                </td>
                <td colSpan={2} />
                <td>
                  <Cell value={c2(sum.vat)} width={W.amt} right readOnly label="SUM VAT" />
                </td>
                <td>
                  <Cell value={c2(sum.total)} width={W.total} right readOnly label="SUM Total" />
                </td>
              </tr>
            </tbody>
          </table>
          <datalist id="ma-grn-products">{products.map((p) => <option key={p.id} value={p.name.toUpperCase()} />)}</datalist>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 190 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save (F2)
        </Btn>
        {orig && <Btn onClick={() => void remove()}>Delete</Btn>}
        <span style={{ width: 230 }} />
        <Check checked onChange={() => {}} disabled dark title="Receiving always posts to stock">
          Accounts?
        </Check>
        <Select value="Direct GRN" options={['Direct GRN']} width={110} disabled />
        <Check checked={jasper} onChange={setJasper} dark title="Print the GRN after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS to the vendor after saving">
          Send Sms
        </Check>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 60, marginTop: 10, paddingLeft: 120 }}>
        <Btn onClick={() => setPayable(true)} title="What has been invoiced by this vendor">
          Payable
        </Btn>
        <Check checked={all} onChange={setAll} dark title="Payable: every vendor">
          ALL
        </Check>
      </div>

      {pick?.kind === 'product' && (
        <ProductLookup
          products={products}
          onClose={() => setPick(null)}
          onPick={(p) => {
            takeProduct(pick.key, p)
            setPick(null)
          }}
          onNew={(typed) => {
            setLine(pick.key, { productId: undefined, name: typed.toUpperCase(), code: '', retail: '', best: '' })
            setPick(null)
            toast('New medicine: check its name, then type the Qty, Rate, Selling Price and Best Price — it is added to the Medicine list when you save')
          }}
        />
      )}
      {pick?.kind === 'vendor' && <PickList title="Vendor" options={suppliers.map((s) => s.name.toUpperCase())} onClose={() => setPick(null)} onPick={(x) => { pickVendor(x); setPick(null) }} />}
      {pick?.kind === 'location' && <PickList title="Location" options={d.locations} onClose={() => setPick(null)} onPick={(x) => { setV({ ...v, location: x }); setPick(null) }} />}
      {pick?.kind === 'status' && <PickList title="Status" options={GRN_STATUS} onClose={() => setPick(null)} onPick={(x) => { setV({ ...v, status: x }); setPick(null) }} />}
      {pick?.kind === 'expense' && <PickList title="Expense A/c" options={expenses} onClose={() => setPick(null)} onPick={(x) => { setV({ ...v, expense: x }); setPick(null) }} />}
      {payable && <PayableDialog register={register} vendor={all ? undefined : v.vendor.trim().toUpperCase() || undefined} onClose={() => setPayable(false)} />}
    </div>
  )
}

/** What each vendor has invoiced on Pur/GRN (Direct Invoice). */
function PayableDialog({ register, vendor, onClose }: { register: DocRecord[]; vendor?: string; onClose: () => void }) {
  const byVendor = new Map<string, { n: number; total: number; last: number }>()
  for (const r of register) {
    const name = (r.values.vendorName ?? '').toUpperCase()
    if (!name || (vendor && name !== vendor)) continue
    const cur = byVendor.get(name) ?? { n: 0, total: 0, last: 0 }
    byVendor.set(name, { n: cur.n + 1, total: cur.total + toCents(r.values.total || '0'), last: Math.max(cur.last, r.createdAt) })
  }
  const rows = [...byVendor].sort((a, b) => b[1].total - a[1].total)
  return (
    <Dialog title={vendor ? `Payable — ${vendor}` : 'Payable — all vendors'} onClose={onClose} width={560}>
      <Grid
        cols={[
          { key: 'v', label: 'Vendor', width: 240 },
          { key: 'n', label: 'Invoices', width: 70, align: 'right' },
          { key: 'last', label: 'Last', width: 90 },
          { key: 't', label: 'Invoiced', width: 110, align: 'right' },
        ]}
        rows={rows.map(([k, x]) => ({ id: k, cells: { v: k, n: String(x.n), last: dmy(x.last), t: amt(x.total) } }))}
        height={260}
      />
      <div className="ma-label" style={{ marginTop: 6 }}>
        {rows.length ? `Total invoiced: ${amt(rows.reduce((s, [, x]) => s + x.total, 0))}` : 'Nothing invoiced yet.'}
      </div>
    </Dialog>
  )
}

/* ══════════════════════ Stock Adjust − / Stock Adjust +(DBH) ══════════════ */
type ALine = { key: string; productId?: number; name: string; batch: string; expiry: string; qty: string; price: string; best: string; cost: string; reason: string }

export function StockAdjustEntry({ slug, editId, onClose }: { slug: typeof ADJUST_MINUS | typeof ADJUST_PLUS; editId?: number; onClose: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const minus = slug === ADJUST_MINUS
  const title = minus ? 'Stock Adjust -' : 'Stock Adjust +(DBH)'
  const prefix = minus ? 'SAM' : 'SAP'
  const types = ADJUST_TYPES[slug]
  const products = useLiveQuery(() => db.products.filter((p) => p.trackStock).toArray(), [], [] as Product[])
  const register = useLiveQuery(async () => (await db.docs.where('slug').equals(slug).toArray()).sort((a, b) => a.createdAt - b.createdAt), [slug], [] as DocRecord[])
  const [current, setCurrent] = useState<number | undefined>(editId)
  const [tab, setTab] = useState<'header' | 'detail'>('header')
  const blank = (): ALine => ({ key: `${Date.now()}-${Math.random()}`, name: '', batch: '', expiry: '', qty: '0.0', price: '', best: '', cost: '', reason: types[0].label })
  const [h, setH] = useState({ date: dmy(Date.now(), '/'), docNo: '', location: '' })
  const [lines, setLines] = useState<ALine[]>([blank()])
  const [orig, setOrig] = useState<DocRecord>()
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ kind: 'product'; key: string } | { kind: 'location' } | null>(null)

  const loadNew = async () => {
    setOrig(undefined)
    setLines([blank()])
    setH({ date: dmy(Date.now(), '/'), docNo: await peekDocNo(prefix), location: d.location })
  }
  useEffect(() => {
    if (current === undefined) {
      void loadNew()
      return
    }
    void db.docs.get(current).then((doc) => {
      if (!doc) return toast('That adjustment no longer exists', 'error')
      setOrig(doc)
      setH({ date: (doc.values.date ?? dmy(doc.createdAt)).replace(/-/g, '/'), docNo: doc.values.docNo ?? '', location: doc.values.location ?? '' })
      setLines((doc.lines ?? []).map((l, i) => ({ key: `e${i}`, productId: l.productId, name: l.name, batch: l.batch ?? '', expiry: l.expiry ?? '', qty: String(l.qty), price: c2(l.rate), best: l.best ? c2(l.best) : '', cost: c2(l.cost), reason: l.reason ?? types[0].label })))
    })
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (current === undefined) setH((x) => ({ ...x, location: x.location || d.location }))
  }, [d.location, current])

  const setLine = (key: string, patch: Partial<ALine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addRow = () => {
    setLines((ls) => [...ls, blank()])
    setTab('detail')
  }
  const takeProduct = (key: string, p: Product) => {
    if (lines.some((l) => l.key !== key && l.productId === p.id)) return toast(`${p.name} is already on this adjustment`, 'error')
    const cur = lines.find((l) => l.key === key)
    setLine(key, { productId: p.id, name: p.name, price: c2(p.price), best: p.minPrice ? c2(p.minPrice) : '', cost: c2(p.cost), qty: cur && n(cur.qty) > 0 ? cur.qty : '1' })
  }
  const typedName = (key: string, name: string) => {
    const p = products.find((x) => x.name.toUpperCase() === name.trim().toUpperCase())
    if (p) takeProduct(key, p)
    else setLine(key, { name, productId: undefined })
  }

  // ← → move between saved adjustments.
  const pos = current === undefined ? register.length : register.findIndex((r) => r.id === current)
  const go = (step: -1 | 1) => {
    const i = pos + step
    if (i < 0) return toast('This is the first adjustment', 'error')
    if (i >= register.length) {
      setCurrent(undefined)
      return
    }
    setCurrent(register[i].id)
  }
  const status = orig ? orig.values.approval || 'Not Assigned' : 'New'

  const save = async () => {
    if (saving || !user) return
    const dateMs = parseDmy(h.date)
    if (dateMs === undefined) return (setTab('header'), toast('Date must be dd/mm/yyyy', 'error'))
    const filled = lines.filter((l) => l.name.trim())
    if (!filled.length) return (setTab('detail'), toast('DETAIL: look up at least one product', 'error'))
    const docLines: DocLine[] = []
    for (const l of filled) {
      if (l.productId === undefined) return (setTab('detail'), toast(`${l.name} is not in the medicine list — pick it with the lookup`, 'error'))
      const qty = n(l.qty)
      if (qty <= 0 || !Number.isInteger(qty)) return (setTab('detail'), toast(`${l.name}: Qty must be a whole number above 0`, 'error'))
      if (!types.some((t) => t.label === l.reason)) return toast(`${l.name}: pick the Type Of Adjustment`, 'error')
      const p = products.find((x) => x.id === l.productId)!
      const price = l.price.trim() ? toCents(l.price) : p.price
      const cost = l.cost.trim() ? toCents(l.cost) : p.cost
      // Stock Adjust + may set the Best Price (an amount, the lowest it may be sold for).
      if (!minus && l.best.trim() && !/^\d+(\.\d{0,2})?$/.test(l.best.trim())) return (setTab('detail'), toast(`${p.name}: Best Price must be an amount in KES, e.g. 120.00`, 'error'))
      const best = !minus && l.best.trim() ? toCents(l.best) : undefined
      if (best !== undefined && best <= 0) return (setTab('detail'), toast(`${p.name}: Best Price must be above 0 (leave it blank for none)`, 'error'))
      const floor = best ?? p.minPrice
      if (!minus && floor && price < floor) return (setTab('detail'), toast(`${p.name}: Best Price ${c2(floor)} is above the Selling Price ${c2(price)}`, 'error'))
      docLines.push({ productId: p.id, name: p.name, sku: p.sku, qty, cost, rate: price, vatPct: 0, vat: 0, discount: 0, total: Math.round(qty * cost), batch: l.batch.trim().toUpperCase() || undefined, expiry: l.expiry.trim() || undefined, reason: l.reason, best })
    }
    const short = await shortfall(docLines, orig?.lines, minus ? -1 : 1)
    if (short) return toast(`${short} — can't take off more than is on the shelf`, 'error')
    setSaving(true)
    try {
      let docNo = h.docNo
      await db.transaction('rw', [db.products, db.movements, db.docs, db.kv], async () => {
        if (orig) await applyAdjust(slug, orig, -1, user.id)
        if (!orig) docNo = await nextDocNo(prefix)
        const values: Record<string, string> = {
          ...(orig?.values ?? {}),
          docNo,
          date: dmy(dateMs),
          location: h.location.trim().toUpperCase(),
          user: user.name.toUpperCase(),
          items: String(docLines.length),
          qty: String(docLines.reduce((s, l) => s + l.qty, 0)),
          total: c2(docLines.reduce((s, l) => s + l.total, 0)),
          types: [...new Set(docLines.map((l) => l.reason))].join(', '),
        }
        if (orig) await db.docs.update(orig.id, { values, docNo, lines: docLines, updatedAt: Date.now() })
        else await db.docs.add({ slug, docNo, values, lines: docLines, createdAt: Date.now(), updatedAt: Date.now(), createdBy: user.id } as DocRecord)
        await applyAdjust(slug, { values, lines: docLines }, 1, user.id)
      })
      toast(`${title} ${docNo} saved — stock ${minus ? 'taken off' : 'added'}`)
      if (jasper)
        printSheet(
          `${d.companyName} — ${title} ${docNo}`,
          [
            ['Date', h.date],
            ['Location', h.location],
          ],
          ['#', 'Product', 'Batch', 'Exp dt', 'Qty', 'Selling Price', 'Cost Rate', 'Type'],
          docLines.map((l, i) => [String(i + 1), l.name, l.batch ?? '', l.expiry ?? '', String(l.qty), c2(l.rate), c2(l.cost), l.reason ?? '']),
          [['Value at cost', amt(docLines.reduce((s, l) => s + l.total, 0))]],
        )
      if (sms) openSms(undefined, `${d.companyName}: ${title} ${docNo} — ${docLines.length} product(s).`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!orig || !user) return
    if (!minus) {
      const short = await shortfall(orig.lines ?? [], undefined, -1)
      if (short) return toast(`Can't delete: ${short}`, 'error')
    }
    if (!confirm(`Delete ${orig.values.docNo}? Its stock change is undone.`)) return
    await db.transaction('rw', [db.products, db.movements, db.docs], async () => {
      await applyAdjust(slug, orig, -1, user.id)
      await db.docs.delete(orig.id)
    })
    toast(`${orig.values.docNo} deleted`)
    onClose()
  }
  useEntryKeys({ save: () => void save(), back: onClose, newRow: addRow })

  const W = { name: 160, batch: 120, exp: 95, qty: 70, price: 85, cost: 85, type: 150 }
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px 18px', height: 32 }}>
        {minus ? (
          <>
            <span style={{ color: '#1a73c9', fontSize: 18 }}>➜</span>
            <span className="ma-title" style={{ color: '#1a73c9', fontSize: 13, minWidth: 170 }}>
              {title.toUpperCase()}
              {orig ? ` · ${orig.values.docNo}` : ''}
            </span>
          </>
        ) : (
          <span className="ma-title" style={{ minWidth: 200 }}>
            {title}
            {orig ? ` · ${orig.values.docNo}` : ''}
          </span>
        )}
        <IBtn lg title="View the list" onClick={onClose}>
          <EyeIcon />
        </IBtn>
        <IBtn lg title="New adjustment" onClick={() => setCurrent(undefined)}>
          <RefreshGlyph />
        </IBtn>
        <span className="ma-label" style={{ color: '#1a73c9', fontWeight: 'bold', marginLeft: 30 }}>
          Status :
        </span>
        <span className="ma-label" style={{ color: '#1a73c9', fontWeight: 'bold', minWidth: 90 }}>
          {status}
        </span>
        <IBtn bare title="Previous adjustment" onClick={() => go(-1)}>
          <span style={{ color: '#1a73c9', fontSize: 16 }}>⬅</span>
        </IBtn>
        <IBtn bare title="Next adjustment" onClick={() => go(1)}>
          <span style={{ color: '#1a73c9', fontSize: 16 }}>➡</span>
        </IBtn>
        <span className="ma-label" style={{ fontSize: 10 }}>
          {register.length ? `${pos < register.length ? pos + 1 : 'new'} of ${register.length}` : 'none saved yet'}
        </span>
      </div>
      <SubTabs
        tabs={[
          { id: 'header', label: 'HEADER' },
          { id: 'detail', label: 'DETAIL' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'header' ? (
        <div style={{ ...panel, paddingTop: 40 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '90px 220px', rowGap: 8 }}>
            <Field label="Date">
              <DateField value={h.date} onChange={(x) => setH({ ...h, date: x })} />
            </Field>
            <Field label="Doc No">
              <Input value={h.docNo || '(auto)'} readOnly width={100} />
            </Field>
            <Field label="Location">
              <span style={{ display: 'inline-flex' }}>
                <Input value={h.location} onChange={(x) => setH({ ...h, location: x.toUpperCase() })} width={140} placeholder="Stock location" />
                <LookupBtn title="Pick a location" onClick={() => setPick({ kind: 'location' })} />
              </span>
            </Field>
          </div>
          <div className="ma-label" style={{ marginTop: 20, marginLeft: 10, fontSize: 10 }}>
            {minus ? 'Takes stock off: expired, damaged, lost or counted short. Pick the products under DETAIL.' : 'Adds stock: opening stock, counted over, found or returned. Pick the products under DETAIL.'}
          </div>
        </div>
      ) : (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="ma-label" style={{ fontSize: 11 }}>
              DETAIL FORM
            </span>
            <Btn onClick={addRow}>NEW ROW(F7)</Btn>
          </div>
          <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px' }}>
            <thead>
              <tr>
                {[['S NO', 30], ['Product Name', W.name + 26], ['Batch No', W.batch], ['Exp dt', W.exp], ['Qty', W.qty], ['Selling Price', W.price], ['Best Price', W.price], ['Cost Rate', W.cost], ['Type Of Adjustment', W.type], ['In Stock', 60], ['', 20]].map(([hd, w]) => (
                  <th key={String(hd) || 'x'} style={{ ...head, width: w as number }}>
                    {hd}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined
                return (
                  <tr key={l.key}>
                    <td style={{ fontSize: 11 }}>{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input className="ma-input" style={{ width: W.name }} value={l.name} list="ma-adj-products" placeholder="Look up" aria-label="Product Name" onChange={(e) => typedName(l.key, e.target.value)} />
                      <LookupBtn title="LookUp Box" onClick={() => setPick({ kind: 'product', key: l.key })} />
                    </td>
                    <td><Cell value={l.batch} onChange={(x) => setLine(l.key, { batch: x.toUpperCase() })} width={W.batch} placeholder="Batch no." label="Batch No" /></td>
                    <td><Cell value={l.expiry} onChange={(x) => setLine(l.key, { expiry: x })} width={W.exp} placeholder="dd-mm-yyyy" label="Exp dt" /></td>
                    <td><Cell value={l.qty} onChange={(x) => setLine(l.key, { qty: x })} width={W.qty} right label="Qty" /></td>
                    <td><Cell value={l.price} onChange={(x) => setLine(l.key, { price: x })} width={W.price} right readOnly={minus} label="Selling Price" /></td>
                    <td><Cell value={l.best} onChange={(x) => setLine(l.key, { best: x })} width={W.price} right readOnly={minus} label="Best Price" placeholder={minus ? '' : 'lowest'} /></td>
                    <td><Cell value={l.cost} onChange={(x) => setLine(l.key, { cost: x })} width={W.cost} right readOnly={minus} label="Cost Rate" /></td>
                    <td>
                      <Select value={l.reason} onChange={(x) => setLine(l.key, { reason: x })} options={types.map((t) => t.label)} width={W.type} />
                    </td>
                    <td style={{ fontSize: 11, textAlign: 'right' }}>{p ? p.stock : '—'}</td>
                    <td>{lines.length > 1 && <DeleteX title="Remove this row" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="ma-adj-products">{products.map((p) => <option key={p.id} value={p.name.toUpperCase()} />)}</datalist>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 300 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save (F2)
        </Btn>
        {orig && <Btn onClick={() => void remove()}>Delete</Btn>}
        <span style={{ width: 300 }} />
        <Check checked={jasper} onChange={setJasper} dark title="Print after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS after saving">
          Send Sms
        </Check>
      </div>
      {pick?.kind === 'product' && (
        <ProductLookup
          products={products}
          onClose={() => setPick(null)}
          onPick={(p) => {
            takeProduct(pick.key, p)
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'location' && <PickList title="Location" options={d.locations} onClose={() => setPick(null)} onPick={(x) => { setH({ ...h, location: x }); setPick(null) }} />}
    </div>
  )
}
