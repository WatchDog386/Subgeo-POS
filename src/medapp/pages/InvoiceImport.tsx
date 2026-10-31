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
  /** Selling price for a new medicine (KES); blank = from the markup. */
  price: string
  vat: boolean
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

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

/** Selling price from cost and markup %, rounded up to the next whole shilling. */
export const priceFromMarkup = (costKes: number, markupPct: number) => Math.ceil(costKes * (1 + markupPct / 100))

/**
 * Receive the checked lines into stock and file the MRN. One transaction:
 * either everything is received or nothing is.
 */
export async function receiveInvoice(input: {
  lines: { code?: string; name: string; qty: number; costCents: number; priceCents?: number; productId?: number; vat: boolean }[]
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
        await db.products.update(p.id!, { stock: p.stock + l.qty, cost: l.costCents, supplierId: p.supplierId ?? supplier?.id, updatedAt: now })
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
      const total = Math.round(l.qty * l.costCents)
      docLines.push({ productId: p!.id, name: p!.name, sku: p!.sku, qty: l.qty, cost: l.costCents, rate: p!.price, vatPct: 0, vat: 0, discount: 0, total })
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
      if (!inv.lines.length) throw new Error('No item lines found. Is it a scanned photo? Only PDFs with selectable text can be read.')
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

  // Match once the medicines have loaded.
  if (lines === null && loaded) {
    setLines(
      inv.lines.map((l, i) => {
        const p = matchProduct(products, l.code, l.name)
        return { key: i, include: true, code: l.code ?? '', name: l.name.toUpperCase(), qty: String(l.qty), cost: l.unitPrice.toFixed(2), productId: p?.id, price: '', vat: p?.taxable ?? false }
      }),
    )
  }
  const list = lines ?? []
  const byId = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products])
  const set = (key: number, patch: Partial<ImportLine>) => setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const priceOf = (l: ImportLine) => (l.price.trim() ? Number(l.price) : markupV.trim() ? priceFromMarkup(Number(l.cost) || 0, Number(markupV) || 0) : 0)
  const chosen = list.filter((l) => l.include)
  const linesSum = chosen.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0)
  const newCount = chosen.filter((l) => l.productId === undefined).length
  const matchedCount = chosen.length - newCount
  const adds = inv.subtotal !== undefined && Math.abs(inv.linesTotal - inv.subtotal) < 0.05
  const shown = list.filter((l) => !q.trim() || `${l.code} ${l.name}`.toUpperCase().includes(q.trim().toUpperCase()))

  const receive = async () => {
    if (saving || !user) return
    if (!chosen.length) return toast('Tick at least one line to receive', 'error')
    const noPrice = chosen.find((l) => l.productId === undefined && priceOf(l) <= 0)
    if (noPrice) return toast(`${noPrice.name} is new: type its selling price, or a Markup % for all new medicines`, 'error')
    const dup = (await db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).find(
      (d) => invoiceNo.trim() && d.values.invoice === invoiceNo.trim() && (d.values.vendorName ?? '').toUpperCase() === vendor.trim().toUpperCase(),
    )
    const over = chosen
      .map((l) => ({ p: l.productId !== undefined ? products.find((x) => x.id === l.productId) : undefined, qty: Number(l.qty) || 0 }))
      .filter(({ p, qty }) => p?.maxStock !== undefined && p.stock + qty > p.maxStock)
      .map(({ p, qty }) => `${p!.name}: ${p!.stock + qty} (max ${p!.maxStock})`)
    if (over.length && !confirm(`This takes these medicines above their maximum level:\n\n${over.slice(0, 12).join('\n')}\n\nReceive anyway?`)) return
    if (dup && !confirm(`${vendor} invoice ${invoiceNo} was already received as ${dup.values.docNo}. Receive it again (stock will be added twice)?`)) return
    setSaving(true)
    try {
      if (markupV.trim()) await setKv(MARKUP_KEY, markupV.trim())
      const r = await receiveInvoice({
        lines: chosen.map((l) => ({ code: l.code || undefined, name: l.name, qty: Number(l.qty) || 0, costCents: toCents(l.cost || '0'), priceCents: l.productId === undefined ? toCents(String(priceOf(l))) : undefined, productId: l.productId, vat: l.vat })),
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

  const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#e9e9e9', fontSize: 11, textAlign: 'left', padding: '4px 4px', borderBottom: '1px solid #bbb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { fontSize: 11, padding: '2px 4px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const small = (w: number, right = true): React.CSSProperties => ({ width: w, height: 19, fontSize: 11, textAlign: right ? 'right' : 'left', padding: '0 3px' })
  return (
    <Dialog title={`Upload Supplier Invoice — ${file.name}`} onClose={onClose} width={1180}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <label className="ma-label" title="Selling price of NEW medicines = cost + this %, rounded up to the shilling">
          Markup % for new <Input value={markupV} onChange={setMarkup} width={50} placeholder="e.g. 33" />
        </label>
        <datalist id="ma-imp-vendors">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name.toUpperCase()} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '8px 0', fontSize: 11 }}>
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <Input value={q} onChange={setQ} width={260} placeholder="Find a line by code or name" />
        <Check checked={list.length > 0 && list.every((l) => l.include)} onChange={(v) => setLines((ls) => (ls ?? []).map((l) => ({ ...l, include: v })))} dark>
          All
        </Check>
        <span className="ma-label" style={{ fontSize: 10 }}>
          Untick lines you did not receive. To match a line to a medicine you already have, type that medicine's name under "Medicine in stock".
        </span>
      </div>
      <div style={{ height: 380, overflow: 'auto', border: '1px solid #c3c3c3', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th} />
              <th style={th}>Item Code</th>
              <th style={th}>Description (on invoice)</th>
              <th style={th}>Qty</th>
              <th style={th}>Unit Cost</th>
              <th style={th}>Amount</th>
              <th style={th}>Medicine in stock</th>
              <th style={th}>In stock</th>
              <th style={th}>Selling Price</th>
              <th style={th}>VAT</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const p = l.productId !== undefined ? byId.get(l.productId) : undefined
              const cost = Number(l.cost) || 0
              const sell = p ? p.price / 100 : priceOf(l)
              return (
                <tr key={l.key} style={{ background: l.include ? undefined : '#f3f3f3', color: l.include ? undefined : '#999' }}>
                  <td style={td}>
                    <input type="checkbox" checked={l.include} onChange={(e) => set(l.key, { include: e.target.checked })} aria-label={`Receive ${l.name}`} />
                  </td>
                  <td style={td}>{l.code}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 260 }}>{l.name}</td>
                  <td style={td}>
                    <input className="ma-input" style={small(46)} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label={`Qty ${l.name}`} />
                  </td>
                  <td style={td}>
                    <input className="ma-input" style={small(62)} value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} aria-label={`Cost ${l.name}`} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{((Number(l.qty) || 0) * cost).toFixed(2)}</td>
                  <td style={td}>
                    <input
                      className="ma-input"
                      style={{ ...small(210, false), color: p ? '#1b5e20' : '#e65100', fontWeight: 'bold' }}
                      list="ma-imp-products"
                      value={p ? p.name : 'NEW MEDICINE'}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value.trim().toUpperCase()
                        const m = products.find((x) => x.name.toUpperCase() === v)
                        if (m) set(l.key, { productId: m.id, vat: m.taxable })
                        else if (!v || v === 'NEW MEDICINE') set(l.key, { productId: undefined })
                      }}
                      aria-label={`Medicine in stock for ${l.name}`}
                      title={p ? `Adds to ${p.name} (${p.sku})` : 'Will be created as a new medicine. Type an existing name to match it instead.'}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: p?.maxStock !== undefined && p.stock + (Number(l.qty) || 0) > p.maxStock ? '#c00' : undefined }} title={p?.maxStock !== undefined ? `Max level ${p.maxStock}` : undefined}>
                    {p ? p.stock : '—'}
                    {p?.maxStock !== undefined && p.stock + (Number(l.qty) || 0) > p.maxStock ? ' ⚠' : ''}
                  </td>
                  <td style={td}>
                    {p ? (
                      <span style={{ color: p.price < Math.round(cost * 100) ? '#c00' : undefined }} title={p.price < Math.round(cost * 100) ? 'Selling price is below the new cost — update it in Medicine / Inventory' : 'Current selling price (kept)'}>
                        {(p.price / 100).toFixed(2)}
                        {p.price < Math.round(cost * 100) ? ' ⚠' : ''}
                      </span>
                    ) : (
                      <input className="ma-input" style={small(62)} value={l.price} placeholder={sell ? sell.toFixed(2) : 'price'} onChange={(e) => set(l.key, { price: e.target.value })} aria-label={`Selling price ${l.name}`} />
                    )}
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <Btn onClick={() => void receive()} disabled={saving || !loaded || !chosen.length}>
          {saving ? 'Receiving…' : !loaded ? 'Matching…' : `Receive ${chosen.length} line(s) into stock`}
        </Btn>
        <Btn onClick={onClose}>cancel</Btn>
        <span className="ma-label" style={{ fontSize: 10 }}>
          Files one Pur/GRN (Direct Invoice) with this PDF attached; stock goes up by each Qty and the cost price becomes the invoice's unit cost.
        </span>
      </div>
    </Dialog>
  )
}
