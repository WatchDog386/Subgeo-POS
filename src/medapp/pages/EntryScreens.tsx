// Full-page entry screens opened by "+" on the cashier's transaction lists
// (legacy screenshots, 31 Oct 2026):
//   WholesaleEntry  Sales Quotation, Delivery Note, Whole Sale Invoice, Credit Notes
//                   tabs ADD PRODUCT / CUSTOMER DETAILS, "ADJUST <source>" pulls lines
//                   from an earlier document.
//   OtcEntry        OTC Medicine Issue/Bill and OTC Medicine Isse Return
//                   tabs PAYMENT DETAILS / DETAIL / PATIENT INFORMATION; the return's
//                   "ADJUST OTC Medicine Issue/Bill" picks the bill being returned.
//   AdjustmentDialog  the shared "Adjustment" picker.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { completeSale, refundSale } from '../../db/sales'
import { getSettings, nextNumber, useSettings } from '../../db/settings'
import type { Customer, DocLine, DocRecord, Payment, Product, Sale, SaleLine } from '../../db/types'
import { toCents } from '../../lib/money'
import { printReceipt } from '../../lib/printReceipt'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { amt, billNo, dmy, nextDocNo, parseDmy, peekDocNo, useMedDefaults } from '../data'
import { EyeIcon, MagnifierIcon } from '../icons'
import { Btn, Check, DateField, Dialog, Grid, IBtn, Input, PickList, Rows, SearchBar, Select, type Col } from '../ui'

/* ── Small shared pieces ───────────────────────────────────────────────── */
const n = (s: string) => {
  const v = parseFloat(String(s ?? '').replace(/,/g, ''))
  return Number.isFinite(v) ? v : 0
}
const c2 = (cents: number) => (cents / 100).toFixed(2)
const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function RefreshGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M15.5 7A6.5 6.5 0 0 0 4 6" stroke="#888" strokeWidth="2.4" fill="none" />
      <path d="M4.5 13A6.5 6.5 0 0 0 16 14" stroke="#888" strokeWidth="2.4" fill="none" />
      <path d="M16.5 2.5v5h-5z" fill="#888" />
      <path d="M3.5 17.5v-5h5z" fill="#888" />
    </svg>
  )
}
function RoundGlyph({ kind }: { kind: 'x' | 'ok' | 'plus' }) {
  const fill = kind === 'x' ? '#e53935' : '#43a047'
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="8" fill={fill} stroke="#fff" strokeWidth="1.2" />
      {kind === 'x' && <path d="M5.6 5.6l6.8 6.8M12.4 5.6l-6.8 6.8" stroke="#fff" strokeWidth="2.2" />}
      {kind === 'ok' && <path d="M4.8 9.3l2.8 2.8 5.6-6" stroke="#fff" strokeWidth="2.2" fill="none" />}
      {kind === 'plus' && <path d="M9 4.5v9M4.5 9h9" stroke="#fff" strokeWidth="2.2" />}
    </svg>
  )
}
function DeleteX({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} style={{ border: 0, background: 'none', cursor: 'pointer', color: '#e53935', fontSize: 18, fontWeight: 'bold', lineHeight: 1 }}>
      ✕
    </button>
  )
}

/** Plain legacy text box sized for the line grids. */
function Cell({ value, onChange, width, right, readOnly, placeholder, inputRef, onEnter, label }: { value: string; onChange?: (v: string) => void; width: number; right?: boolean; readOnly?: boolean; placeholder?: string; inputRef?: React.Ref<HTMLInputElement>; onEnter?: () => void; label?: string }) {
  return (
    <input
      ref={inputRef}
      className="ma-input"
      style={{ width, textAlign: right ? 'right' : undefined, background: readOnly ? '#f4f4f4' : undefined }}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      aria-label={label}
      title={placeholder ?? label}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      onFocus={(e) => e.target.select()}
    />
  )
}

function LookupBtn({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" className="ma-lookup" onClick={onClick} title={title} aria-label={title}>
      <MagnifierIcon size={13} />
    </button>
  )
}

function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="ma-subtabs" style={{ paddingLeft: 6 }}>
      {tabs.map((t) => (
        <span key={t.id} className={`ma-subtab is-white${value === t.id ? ' is-active' : ''}`} style={{ cursor: 'pointer' }} onClick={() => onChange(t.id)}>
          {t.label}
        </span>
      ))}
    </div>
  )
}

function EntryHeader({ title, adjust, onAdjust, onView, onRefresh }: { title: string; adjust?: string; onAdjust?: () => void; onView: () => void; onRefresh: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px 18px', height: 32 }}>
      <span className="ma-title" style={{ minWidth: 280 }}>
        {title}
      </span>
      <IBtn lg title="View the list" onClick={onView}>
        <EyeIcon />
      </IBtn>
      <IBtn lg title="Clear the form" onClick={onRefresh}>
        <RefreshGlyph />
      </IBtn>
      {adjust && (
        <span style={{ marginLeft: 170 }}>
          <Btn onClick={onAdjust} title={`Pull lines from a ${adjust}`}>
            ADJUST&nbsp; {adjust}
          </Btn>
        </span>
      )}
    </div>
  )
}

/** F2 save, F3 back, F7 new row. */
function useEntryKeys(keys: { save: () => void; back: () => void; newRow?: () => void }) {
  const ref = useRef(keys)
  ref.current = keys
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (document.querySelector('.ma-modal')) return
      if (e.key === 'F2') {
        e.preventDefault()
        ref.current.save()
      } else if (e.key === 'F3') {
        e.preventDefault()
        ref.current.back()
      } else if (e.key === 'F7' && ref.current.newRow) {
        e.preventDefault()
        ref.current.newRow()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
}

const panel: CSSProperties = { border: '1px solid #c8c8c8', borderTop: 0, background: '#f6f5ef', minHeight: 360, padding: '10px 6px', overflowX: 'auto' }
const head: CSSProperties = { fontSize: 11, color: '#333', paddingBottom: 6, whiteSpace: 'nowrap', textAlign: 'left' }

/** Open a small print window with a formatted document. */
function printSheet(title: string, rows: [string, string][], cols: string[], lines: string[][], foot: [string, string][]) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>body{font:12px Arial;margin:24px}table{border-collapse:collapse;width:100%;margin-top:10px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}h1{font-size:16px}.kv td{border:0;padding:2px 8px 2px 0}</style>
<h1>${esc(title)}</h1><table class="kv">${rows.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>
${cols.length ? `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${lines.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''}
<table class="kv">${foot.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}

function openSms(phone: string | undefined, text: string) {
  window.open(`sms:${encodeURIComponent((phone ?? '').replace(/\s/g, ''))}?body=${encodeURIComponent(text)}`, '_blank')
}

/* ══════════════════════ ADJUSTMENT PICKER ═════════════════════════════════ */
export type AdjRow = { key: string; docDate: string; docNo: string; party: string; product: string; org: number; avail: number; pend: number; batch?: string; expiry?: string }
export type AdjPick = { row: AdjRow; qty: number }

export function AdjustmentDialog({
  sources,
  load,
  onApply,
  onClose,
}: {
  sources: { value: string; label: string }[]
  load: (source: string) => Promise<AdjRow[]>
  /** setBase: copy the source's customer / details into the form. */
  onApply: (picks: AdjPick[], setBase: boolean) => void
  onClose: () => void
}) {
  const toast = useToast()
  const [source, setSource] = useState(sources[0]?.value ?? '')
  const [field, setField] = useState('SELECT')
  const [fieldVal, setFieldVal] = useState('')
  const [docNo, setDocNo] = useState('')
  const [rows, setRows] = useState<AdjRow[]>([])
  const [q, setQ] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Set<string | number>>(new Set())
  const [allowZero, setAllowZero] = useState(true)
  const [setBase, setSetBase] = useState(true)
  const [selectAll, setSelectAll] = useState(true)
  const [batch, setBatch] = useState(false)

  const show = async () => {
    const all = await load(source)
    const v = fieldVal.trim().toLowerCase()
    const list = all
      .filter((r) => allowZero || r.pend > 0)
      .filter((r) => !docNo.trim() || r.docNo.toLowerCase().includes(docNo.trim().toLowerCase()))
      .filter((r) => {
        if (field === 'SELECT' || !v) return true
        const cell = field === 'Product' ? r.product : field === 'Party' ? r.party : r.docDate
        return cell.toLowerCase().includes(v)
      })
    setRows(list)
    setQty(Object.fromEntries(list.map((r) => [r.key, String(Math.max(0, r.pend))])))
    setChecked(selectAll ? new Set(list.filter((r) => r.pend > 0).map((r) => r.key)) : new Set())
    if (!list.length) toast('Nothing pending for that filter', 'error')
  }
  useEffect(() => {
    void show()
  }, [source]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = rows.filter((r) => !q.trim() || [r.docNo, r.product, r.party, r.docDate].some((x) => x.toLowerCase().includes(q.trim().toLowerCase())))
  const apply = (keepOpen: boolean) => {
    const picks: AdjPick[] = []
    for (const r of rows) {
      if (!checked.has(r.key)) continue
      const v = n(qty[r.key] ?? '')
      if (v <= 0) continue
      if (v > r.pend) return toast(`${r.product}: only ${r.pend} pending on ${r.docNo}`, 'error')
      picks.push({ row: r, qty: v })
    }
    if (!picks.length) return toast('Tick the line(s) and enter the Adj Qty', 'error')
    onApply(picks, setBase)
    toast(`${picks.length} line(s) added`)
    if (keepOpen) void show()
    else onClose()
  }
  const cols: Col[] = [
    { key: 'docDate', label: 'Doc Date', width: 80 },
    { key: 'docNo', label: 'Doc No', width: 100 },
    { key: 'product', label: 'Product', width: 170 },
    { key: 'org', label: 'Org Qty', width: 70, align: 'right' },
    { key: 'avail', label: 'Avail Qty', width: 70, align: 'right' },
    { key: 'pend', label: 'Pend Qty', width: 80, align: 'right' },
    ...(batch ? [{ key: 'batch', label: 'Batch', width: 80 }, { key: 'expiry', label: 'Expiry', width: 80 }] : []),
    { key: 'adj', label: 'Adj Qty', width: 120, align: 'right' as const },
  ]
  return (
    <Dialog title="Adjustment" onClose={onClose} width={860}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Select value={source} onChange={setSource} options={sources} width={150} round />
        <Select value={field} onChange={setField} options={['SELECT', 'Party', 'Product', 'Doc Date']} width={135} round />
        <span>=</span>
        <Input value={fieldVal} onChange={setFieldVal} width={150} placeholder={field === 'SELECT' ? 'pick a field first' : `${field} contains…`} onEnter={() => void show()} />
        <span className="ma-label" style={{ marginLeft: 4 }}>
          Doc No
        </span>
        <Input value={docNo} onChange={setDocNo} width={100} placeholder="e.g. SQ-3-26" onEnter={() => void show()} />
        <Btn onClick={() => void show()}>Show</Btn>
        <Btn onClick={() => setBatch(!batch)} title="Show / hide batch and expiry">
          Batch Details
        </Btn>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0 2px' }}>
        <SearchBar value={q} onChange={setQ} width={375} />
        <span style={{ marginLeft: 'auto', marginRight: 28 }}>
          <Rows n={shown.length} />
        </span>
      </div>
      <Grid
        cols={cols}
        checkbox
        checked={checked}
        onCheck={(id) => {
          const s = new Set(checked)
          if (s.has(id)) s.delete(id)
          else s.add(id)
          setChecked(s)
        }}
        rows={shown.map((r) => ({
          id: r.key,
          cells: {
            docDate: r.docDate,
            docNo: r.docNo,
            product: r.product,
            org: String(r.org),
            avail: String(r.avail),
            pend: String(r.pend),
            batch: r.batch ?? '',
            expiry: r.expiry ?? '',
            adj: (
              <input
                className="ma-input is-plain"
                style={{ width: 70, height: 19, textAlign: 'right', fontSize: 11 }}
                value={qty[r.key] ?? ''}
                inputMode="decimal"
                aria-label={`Adj Qty ${r.product}`}
                onChange={(e) => {
                  setQty({ ...qty, [r.key]: e.target.value })
                  if (!checked.has(r.key)) setChecked(new Set([...checked, r.key]))
                }}
              />
            ),
          },
        }))}
        height={300}
        fillWidth
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 12 }}>
        <Check checked={allowZero} onChange={setAllowZero} dark>
          ? Allow Zero Also
        </Check>
        <Check checked={setBase} onChange={setSetBase} dark title="Copy the customer / patient and numbers of the picked document into the form">
          ? Is Set Base Form Data
        </Check>
        <Check
          checked={selectAll}
          onChange={(v) => {
            setSelectAll(v)
            setChecked(v ? new Set(shown.filter((r) => r.pend > 0).map((r) => r.key)) : new Set())
          }}
          dark
        >
          ? SelectAll
        </Check>
        <IBtn title="Close" onClick={onClose}>
          <RoundGlyph kind="x" />
        </IBtn>
        <IBtn title="Add the ticked lines and close" onClick={() => apply(false)}>
          <RoundGlyph kind="ok" />
        </IBtn>
        <IBtn title="Add the ticked lines and pick more" onClick={() => apply(true)}>
          <RoundGlyph kind="plus" />
        </IBtn>
      </div>
    </Dialog>
  )
}

/* ══════════════════════ WHOLE-SALE DOCUMENTS ══════════════════════════════ */
type WholesaleRule = {
  /** Screens whose lines "ADJUST" can pull in. */
  adjustFrom: string[]
  /** Account posting shown next to "Accounts?". */
  account: string
  /** Stock: -1 goes out, +1 comes back, 0 none. */
  stock: -1 | 0 | 1
  /** Customer balance: +1 charged, -1 credited, 0 none (only when "Accounts?" is ticked). */
  post: -1 | 0 | 1
}
export const WHOLESALE_RULES: Record<string, WholesaleRule> = {
  'sales-quotation': { adjustFrom: [], account: 'SALES QUOTATION', stock: 0, post: 0 },
  'delivery-note': { adjustFrom: ['sales-quotation'], account: 'CUSTOMER INVOICE', stock: -1, post: 0 },
  'whole-sale-invoice': { adjustFrom: ['delivery-note', 'sales-quotation'], account: 'CUSTOMER INVOICE', stock: -1, post: 1 },
  'credit-note': { adjustFrom: ['whole-sale-invoice'], account: 'CUSTOMER CREDIT NOTE', stock: 1, post: -1 },
  'credit-note-direct': { adjustFrom: [], account: 'CUSTOMER CREDIT NOTE', stock: 1, post: -1 },
}
const SCREEN_LABEL: Record<string, string> = {
  'sales-quotation': 'Sales Quotation',
  'delivery-note': 'Delivery Note',
  'whole-sale-invoice': 'Whole Sale Invoice',
  'credit-note': 'Credit Note',
  'credit-note-direct': 'Credit Note - Direct Invoice',
}
const FIELD_LABEL: Record<string, string> = { total: 'Total Invoice', customer: 'Customer Name', user: 'User', date: 'Date', location: 'Location' }

type WLine = {
  key: string
  productId?: number
  name: string
  sku?: string
  qty: string
  cost: string
  rate: string
  vat: string
  disc: string
  batch: string
  expiry: string
  srcSlug?: string
  srcDocNo?: string
  srcLine?: number
}

export interface WholesaleDef {
  title: string
  prefix?: string
  cols: Col[]
  fields?: { key: string; kind: string }[]
}

function wCalc(l: WLine, inclVat: boolean) {
  const qty = n(l.qty)
  const cost = toCents(l.cost || '0')
  const rate = toCents(l.rate || '0')
  const vatPct = n(l.vat)
  const discount = toCents(l.disc || '0')
  const gross = Math.max(0, Math.round(qty * rate) - discount)
  const vat = inclVat ? Math.round((gross * vatPct) / (100 + vatPct)) : Math.round((gross * vatPct) / 100)
  const total = inclVat ? gross : gross + vat
  return { qty, cost, rate, vatPct, discount, vat, total, totalCost: Math.round(qty * cost) }
}

/** Stock out/in and customer posting of a saved document (sign 1 = apply, -1 = undo). */
export async function applyDocEffects(slug: string, doc: Pick<DocRecord, 'lines' | 'values'>, sign: 1 | -1, userId?: number) {
  const rule = WHOLESALE_RULES[slug]
  if (!rule) return
  const ref = doc.values.docNo ?? ''
  if (rule.stock !== 0) {
    for (const l of doc.lines ?? []) {
      // Lines delivered on a delivery note already left the shelf.
      if (!l.productId || (slug === 'whole-sale-invoice' && l.srcSlug === 'delivery-note')) continue
      const p = await db.products.get(l.productId)
      if (!p || !p.trackStock) continue
      const change = rule.stock * sign * l.qty
      await db.products.update(p.id!, { stock: p.stock + change, updatedAt: Date.now() })
      await db.movements.add({ productId: p.id!, change, reason: change < 0 ? 'sale' : 'refund', reference: ref, note: `${SCREEN_LABEL[slug] ?? slug}${sign < 0 ? ' (changed)' : ''}`, userId, at: Date.now() })
    }
  }
  if (rule.post !== 0 && doc.values.posted === '1' && doc.values.customerId) {
    const c = await db.customers.get(Number(doc.values.customerId))
    if (c) await db.customers.update(c.id!, { balance: c.balance + rule.post * sign * toCents(doc.values.total || '0') })
  }
}

export function WholesaleEntry({ slug, def, editId, onClose }: { slug: string; def: WholesaleDef; editId?: number; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const settings = useSettings()
  const rule = WHOLESALE_RULES[slug]
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const fields = def.fields ?? []
  const [tab, setTab] = useState<'product' | 'customer'>('product')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [lines, setLines] = useState<WLine[]>([])
  const [orig, setOrig] = useState<DocRecord>()
  const [accounts, setAccounts] = useState(rule.post !== 0)
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [all, setAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ kind: 'product'; key: string } | { kind: 'customer' } | { kind: 'location' } | null>(null)
  const [adjust, setAdjust] = useState(false)
  const [receivable, setReceivable] = useState(false)
  const firstName = useRef<HTMLInputElement>(null)

  const blankLine = (): WLine => ({ key: `${Date.now()}-${Math.random()}`, name: '', qty: '0.0', cost: '', rate: '0.0', vat: '0.0', disc: '0.0', batch: '', expiry: '' })
  const reset = async () => {
    const v: Record<string, string> = {}
    for (const f of fields) {
      if (f.kind === 'date') v[f.key] = dmy(Date.now(), '/')
      else if (f.kind === 'location') v[f.key] = d.location
      else if (f.kind === 'user') v[f.key] = user?.name.toUpperCase() ?? ''
      else v[f.key] = ''
    }
    if (def.prefix) v.docNo = await peekDocNo(def.prefix)
    setVals(v)
    setLines([blankLine()])
    setOrig(undefined)
    setAccounts(rule.post !== 0)
  }
  useEffect(() => {
    if (editId === undefined) {
      void reset()
      return
    }
    void db.docs.get(editId).then((doc) => {
      if (!doc) return toast('That record no longer exists', 'error')
      setOrig(doc)
      setVals({ ...doc.values, date: (doc.values.date ?? '').replace(/-/g, '/') })
      setAccounts(doc.values.posted === '1' || (rule.post !== 0 && doc.values.posted === undefined))
      setLines(
        (doc.lines ?? []).map((l, i): WLine => ({
          key: `e${i}`,
          productId: l.productId,
          name: l.name,
          sku: l.sku,
          qty: String(l.qty),
          cost: c2(l.cost),
          rate: c2(l.rate),
          vat: String(l.vatPct),
          disc: c2(l.discount),
          batch: l.batch ?? '',
          expiry: l.expiry ?? '',
          srcSlug: l.srcSlug,
          srcDocNo: l.srcDocNo,
          srcLine: l.srcLine,
        })).concat(doc.lines?.length ? [] : [blankLine()]),
      )
    })
  }, [editId, d.location]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Phone of a customer by name (contact person's first). */
  const contactFor = (name?: string) => {
    const c = customers.find((x) => x.name.toUpperCase() === (name ?? '').trim().toUpperCase())
    return c?.contactPhone || c?.phone || ''
  }
  const calc = lines.map((l) => wCalc(l, settings.pricesIncludeVat))
  const sum = calc.reduce((s, c) => s + c.total, 0)
  const setLine = (key: string, patch: Partial<WLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addRow = () => {
    setLines((ls) => [...ls, blankLine()])
    setTab('product')
  }
  const labelOf = (p: Product) => `${p.name}${p.sku ? ` [${p.sku}]` : ''}`
  const takeProduct = (key: string, p: Product) =>
    setLine(key, {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      cost: c2(p.cost),
      rate: c2(p.price),
      vat: String(p.taxable ? settings.vatRate : 0),
      qty: lines.find((l) => l.key === key)?.qty && n(lines.find((l) => l.key === key)!.qty) > 0 ? lines.find((l) => l.key === key)!.qty : '1',
      batch: p.location ?? '',
    })
  const typedName = (key: string, name: string) => {
    const p = products.find((x) => labelOf(x).toUpperCase() === name.trim().toUpperCase() || x.name.toUpperCase() === name.trim().toUpperCase())
    if (p) takeProduct(key, p)
    else setLine(key, { name, productId: undefined, sku: undefined })
  }

  /* ADJUST <source> */
  const loadSource = async (src: string): Promise<AdjRow[]> => {
    const docs = await db.docs.where('slug').equals(src).toArray()
    const targets = (await db.docs.where('slug').equals(slug).toArray()).filter((t) => t.id !== editId)
    const used = new Map<string, number>()
    for (const t of targets) for (const l of t.lines ?? []) if (l.srcSlug === src && l.srcDocNo) used.set(`${l.srcDocNo}#${l.srcLine}`, (used.get(`${l.srcDocNo}#${l.srcLine}`) ?? 0) + l.qty)
    // Lines already on this form count too.
    for (const l of lines) if (l.srcSlug === src && l.srcDocNo) used.set(`${l.srcDocNo}#${l.srcLine}`, (used.get(`${l.srcDocNo}#${l.srcLine}`) ?? 0) + n(l.qty))
    const out: AdjRow[] = []
    for (const doc of docs.sort((a, b) => b.createdAt - a.createdAt)) {
      for (const [i, l] of (doc.lines ?? []).entries()) {
        const no = doc.values.docNo ?? ''
        const stock = l.productId ? (await db.products.get(l.productId))?.stock ?? 0 : 0
        out.push({ key: `${doc.id}#${i}`, docDate: doc.values.date ?? dmy(doc.createdAt), docNo: no, party: doc.values.customer ?? '', product: l.name, org: l.qty, avail: stock, pend: Math.max(0, l.qty - (used.get(`${no}#${i}`) ?? 0)), batch: l.batch, expiry: l.expiry })
      }
    }
    return out
  }
  const applyAdjust = async (src: string, picks: AdjPick[], setBase: boolean) => {
    const add: WLine[] = []
    let base: DocRecord | undefined
    for (const { row, qty } of picks) {
      const [docId, idx] = row.key.split('#').map(Number)
      const doc = await db.docs.get(docId)
      const l = doc?.lines?.[idx]
      if (!doc || !l) continue
      base ??= doc
      add.push({ key: `a${row.key}-${Date.now()}`, productId: l.productId, name: l.name, sku: l.sku, qty: String(qty), cost: c2(l.cost), rate: c2(l.rate), vat: String(l.vatPct), disc: c2(Math.round((l.discount * qty) / Math.max(1, l.qty))), batch: l.batch ?? '', expiry: l.expiry ?? '', srcSlug: src, srcDocNo: doc.values.docNo, srcLine: idx })
    }
    setLines((ls) => [...ls.filter((l) => l.name.trim()), ...add])
    if (setBase && base) {
      const b = base.values
      setVals((v) => ({
        ...v,
        customer: v.customer || b.customer || '',
        location: v.location || b.location || '',
        quoteNo: src === 'sales-quotation' ? b.docNo ?? '' : v.quoteNo || b.quoteNo || '',
        invoiceNo: v.invoiceNo || b.invoiceNo || '',
      }))
    }
  }
  const [adjustSrc, setAdjustSrc] = useState(rule.adjustFrom[0])

  const save = async () => {
    if (saving || !user) return
    const filled = lines.map((l, i) => ({ l, c: calc[i] })).filter(({ l }) => l.name.trim())
    if (!filled.length) return toast('ADD PRODUCT: type or look up at least one product', 'error')
    const bad = filled.find(({ c }) => c.qty <= 0)
    if (bad) return toast(`${bad.l.name}: enter the TOTAL QTY`, 'error')
    const customer = (vals.customer ?? '').trim().toUpperCase()
    if (fields.some((f) => f.kind === 'party') && !customer) {
      setTab('customer')
      return toast('CUSTOMER DETAILS: type or look up the Customer Name', 'error')
    }
    const dateMs = vals.date ? parseDmy(vals.date) : Date.now()
    if (fields.some((f) => f.key === 'date') && dateMs === undefined) {
      setTab('customer')
      return toast('Date must be dd/mm/yyyy', 'error')
    }
    setSaving(true)
    try {
      const docLines: DocLine[] = filled.map(({ l, c }) => ({
        productId: l.productId,
        name: l.name.trim().toUpperCase(),
        sku: l.sku,
        qty: c.qty,
        cost: c.cost,
        rate: c.rate,
        vatPct: c.vatPct,
        vat: c.vat,
        discount: c.discount,
        total: c.total,
        batch: l.batch.trim() || undefined,
        expiry: l.expiry.trim() || undefined,
        srcSlug: l.srcSlug,
        srcDocNo: l.srcDocNo,
        srcLine: l.srcLine,
      }))
      const total = docLines.reduce((s, l) => s + l.total, 0)
      // Enough stock for what leaves the shelf (net of this document's earlier version).
      if (rule.stock < 0) {
        const need = new Map<number, number>()
        for (const l of docLines) if (l.productId && !(slug === 'whole-sale-invoice' && l.srcSlug === 'delivery-note')) need.set(l.productId, (need.get(l.productId) ?? 0) + l.qty)
        for (const l of orig?.lines ?? []) if (l.productId && need.has(l.productId) && !(slug === 'whole-sale-invoice' && l.srcSlug === 'delivery-note')) need.set(l.productId, need.get(l.productId)! - l.qty)
        for (const [pid, q] of need) {
          const p = await db.products.get(pid)
          if (p?.trackStock && q > p.stock) throw new Error(`Only ${p.stock} of ${p.name} in stock`)
        }
      }
      let customerId: number | undefined
      if (customer) {
        customerId = customers.find((c) => c.name.toUpperCase() === customer)?.id
        if (customerId === undefined && accounts && rule.post !== 0) customerId = (await db.customers.add({ name: customer, balance: 0, creditLimit: 0, createdAt: Date.now() } as Customer)) as number
      }
      const values: Record<string, string> = {
        ...vals,
        contact: (vals.contact ?? '').trim() || contactFor(customer),
        customer,
        date: dmy(dateMs ?? Date.now()),
        total: c2(total),
        user: vals.user || user.name.toUpperCase(),
        posted: accounts && rule.post !== 0 && customerId !== undefined ? '1' : '0',
        ...(customerId !== undefined ? { customerId: String(customerId) } : {}),
      }
      let id = editId
      await db.transaction('rw', [db.docs, db.products, db.movements, db.customers, db.kv], async () => {
        if (orig) await applyDocEffects(slug, orig, -1, user.id)
        if (!orig && def.prefix) values.docNo = await nextDocNo(def.prefix)
        if (id === undefined) id = (await db.docs.add({ slug, values, docNo: values.docNo, lines: docLines, createdAt: Date.now(), updatedAt: Date.now(), createdBy: user.id } as DocRecord)) as number
        else await db.docs.update(id, { values, docNo: values.docNo, lines: docLines, updatedAt: Date.now() })
        await applyDocEffects(slug, { values, lines: docLines }, 1, user.id)
      })
      toast(`${def.title} ${values.docNo ?? ''} saved`)
      if (jasper)
        printSheet(
          `${d.companyName} — ${def.title} ${values.docNo ?? ''}`,
          fields.filter((f) => values[f.key]).map((f) => [FIELD_LABEL[f.key] ?? def.cols.find((c) => c.key === f.key)?.label ?? f.key, values[f.key]]),
          ['#', 'Product', 'Qty', 'Rate', 'VAT', 'Discount', 'Total', 'Batch', 'Expiry'],
          docLines.map((l, i) => [String(i + 1), l.name, String(l.qty), c2(l.rate), c2(l.vat), c2(l.discount), c2(l.total), l.batch ?? '', l.expiry ?? '']),
          [['TOTAL', amt(total)]],
        )
      if (sms) openSms(values.contact || customers.find((c) => c.id === customerId)?.phone, `${d.companyName}: ${def.title} ${values.docNo ?? ''} for ${customer}, total KES ${c2(total)}.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!orig || !user || !confirm(`Delete ${def.title} ${orig.values.docNo ?? ''}? Its stock and account postings are reversed.`)) return
    await db.transaction('rw', [db.docs, db.products, db.movements, db.customers], async () => {
      await applyDocEffects(slug, orig, -1, user.id)
      await db.docs.delete(orig.id)
    })
    toast('Record deleted')
    onClose()
  }
  useEntryKeys({ save: () => void save(), back: onClose, newRow: addRow })

  const docLabel = def.cols.find((c) => c.key === 'docNo')?.label ?? 'Doc No'
  const W = { sno: 40, name: 140, qty: 75, cost: 75, rate: 75, vat: 75, vatT: 75, disc: 75, total: 75, batch: 100, exp: 100, id: 100, tcost: 75 }
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <EntryHeader
        title={`${def.title}${orig ? ` — ${orig.values.docNo ?? ''}` : ''}`}
        adjust={rule.adjustFrom.length ? SCREEN_LABEL[rule.adjustFrom[0]] : undefined}
        onAdjust={() => {
          setAdjustSrc(rule.adjustFrom[0])
          setAdjust(true)
        }}
        onView={onClose}
        onRefresh={() => (orig ? undefined : void reset())}
      />
      <SubTabs
        tabs={[
          { id: 'product', label: 'ADD PRODUCT' },
          { id: 'customer', label: 'CUSTOMER DETAILS' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'product' ? (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="ma-label" style={{ fontSize: 11 }}>
              ADD PRODUCT FORM
            </span>
            <Btn onClick={addRow}>NEW ROW(F7)</Btn>
          </div>
          <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px' }}>
            <thead>
              <tr>
                {[['S NO', W.sno], ['Product Name', W.name + 26], ['TOTAL QTY', W.qty], ['Cost Rate', W.cost], ['Sales Rate', W.rate], ['V.A.%', W.vat], ['V.A.T Total', W.vatT], ['Discount', W.disc], ['Total', W.total], ['BATCH', W.batch], ['Expiary Date', W.exp], ['ID', W.id], ['Total Cost', W.tcost], ['', 20]].map(([h, w]) => (
                  <th key={String(h) || 'x'} style={{ ...head, width: w as number }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = calc[i]
                return (
                  <tr key={l.key}>
                    <td style={{ fontSize: 11 }}>{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input
                        ref={i === 0 ? firstName : undefined}
                        className="ma-input"
                        style={{ width: W.name }}
                        value={l.name}
                        list="ma-entry-products"
                        placeholder="Type or look up"
                        aria-label="Product Name"
                        onChange={(e) => typedName(l.key, e.target.value)}
                      />
                      <LookupBtn title="Look up a product" onClick={() => setPick({ kind: 'product', key: l.key })} />
                    </td>
                    <td><Cell value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} width={W.qty} right label="TOTAL QTY" /></td>
                    <td><Cell value={l.cost} onChange={(v) => setLine(l.key, { cost: v })} width={W.cost} right label="Cost Rate" /></td>
                    <td><Cell value={l.rate} onChange={(v) => setLine(l.key, { rate: v })} width={W.rate} right label="Sales Rate" /></td>
                    <td><Cell value={l.vat} onChange={(v) => setLine(l.key, { vat: v })} width={W.vat} right label="V.A.%" /></td>
                    <td><Cell value={c2(c.vat)} width={W.vatT} right readOnly label="V.A.T Total" /></td>
                    <td><Cell value={l.disc} onChange={(v) => setLine(l.key, { disc: v })} width={W.disc} right label="Discount" /></td>
                    <td><Cell value={c2(c.total)} width={W.total} right readOnly label="Total" /></td>
                    <td><Cell value={l.batch} onChange={(v) => setLine(l.key, { batch: v.toUpperCase() })} width={W.batch} placeholder="Batch no." label="BATCH" /></td>
                    <td><Cell value={l.expiry} onChange={(v) => setLine(l.key, { expiry: v })} width={W.exp} placeholder="dd-mm-yyyy" label="Expiary Date" /></td>
                    <td><Cell value={l.sku ?? ''} width={W.id} readOnly label="ID" placeholder={l.srcDocNo ? `from ${l.srcDocNo}` : ''} /></td>
                    <td><Cell value={c2(c.totalCost)} width={W.tcost} right readOnly label="Total Cost" /></td>
                    <td>{lines.length > 1 && <DeleteX title="Remove this row" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}</td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ fontSize: 11 }}>SUM</td>
                <td colSpan={7} />
                <td>
                  <Cell value={c2(sum)} width={W.total} right readOnly label="SUM" />
                </td>
              </tr>
            </tbody>
          </table>
          <datalist id="ma-entry-products">
            {products.map((p) => (
              <option key={p.id} value={labelOf(p)} />
            ))}
          </datalist>
        </div>
      ) : (
        <div style={{ ...panel, paddingTop: 30 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 260px', rowGap: 8 }}>
            {fields.map((f) => {
              const label = FIELD_LABEL[f.key] ?? def.cols.find((c) => c.key === f.key)?.label ?? f.key
              const v = vals[f.key] ?? ''
              const set = (x: string) => setVals({ ...vals, [f.key]: x })
              return (
                <Field key={f.key} label={f.key === 'docNo' ? docLabel : label}>
                  {f.kind === 'location' ? (
                    <span style={{ display: 'inline-flex' }}>
                      <Input value={v} onChange={(x) => set(x.toUpperCase())} width={140} placeholder="Stock location" />
                      <LookupBtn title="Pick a location" onClick={() => setPick({ kind: 'location' })} />
                    </span>
                  ) : f.kind === 'date' ? (
                    <DateField value={v} onChange={set} />
                  ) : f.kind === 'party' ? (
                    <span style={{ display: 'inline-flex' }}>
                      <input className="ma-input" style={{ width: 140 }} value={v} list="ma-entry-customers" placeholder="Type or look up the customer" onChange={(e) => set(e.target.value.toUpperCase())} aria-label="Customer Name" />
                      <LookupBtn title="Look up a customer" onClick={() => setPick({ kind: 'customer' })} />
                    </span>
                  ) : f.kind === 'docno' ? (
                    <Input value={v || '(auto)'} readOnly width={100} />
                  ) : f.key === 'total' ? (
                    <Input value={c2(sum)} readOnly width={75} style={{ textAlign: 'right' }} />
                  ) : f.kind === 'user' ? (
                    <Input value={v} readOnly width={100} />
                  ) : (
                    <Input value={v} onChange={set} width={100} placeholder={f.key === 'invoiceNo' ? 'e.g. INV-1-26' : f.key === 'quoteNo' ? 'e.g. SQ-1-26' : f.key === 'partyId' ? 'Party code' : ''} />
                  )}
                </Field>
              )
            })}
            <Field label="Contact No">
              <Input value={vals.contact ?? ''} onChange={(x) => setVals({ ...vals, contact: x })} width={140} placeholder={contactFor(vals.customer) || 'e.g. 0712 345 678'} />
            </Field>
          </div>
          <datalist id="ma-entry-customers">
            {customers.map((c) => (
              <option key={c.id} value={c.name.toUpperCase()} />
            ))}
          </datalist>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 190 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save (F2)
        </Btn>
        {orig && <Btn onClick={() => void remove()}>Delete</Btn>}
        <span style={{ width: 80 }} />
        <Btn onClick={() => nav('/modules/final-bill-receipt')} title="Advance received from the customer (Final Bill Receipt)">
          Adv Rec
        </Btn>
        <span style={{ width: 80 }} />
        <Check checked={rule.post !== 0 && accounts} onChange={setAccounts} disabled={rule.post === 0} dark title={rule.post === 0 ? 'This document does not post to the customer account' : 'Post the total to the customer account'}>
          Accounts?
        </Check>
        <Select value={rule.account} options={[rule.account]} width={140} disabled />
        <Check checked={jasper} onChange={setJasper} dark title="Print the document after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS to the customer after saving">
          Send Sms
        </Check>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 90, marginTop: 10, paddingLeft: 118 }}>
        <Btn onClick={() => setReceivable(true)} title="What the customer owes">
          Receivable
        </Btn>
        {tab === 'product' && (
          <Check checked={all} onChange={setAll} dark title="Receivable: every customer, not just this one">
            ALL
          </Check>
        )}
      </div>

      {pick?.kind === 'product' && (
        <PickList
          title="Product"
          options={[...products].sort((a, b) => a.name.localeCompare(b.name)).map(labelOf)}
          onClose={() => setPick(null)}
          onPick={(v) => {
            const p = products.find((x) => labelOf(x) === v)
            if (p) takeProduct(pick.key, p)
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'customer' && (
        <PickList title="Customer" options={customers.map((c) => c.name.toUpperCase())} onClose={() => setPick(null)} onPick={(v) => { setVals({ ...vals, customer: v }); setPick(null) }} />
      )}
      {pick?.kind === 'location' && (
        <PickList title="Location" options={d.locations} onClose={() => setPick(null)} onPick={(v) => { setVals({ ...vals, location: v }); setPick(null) }} />
      )}
      {adjust && adjustSrc && (
        <AdjustmentDialog
          sources={rule.adjustFrom.map((s) => ({ value: s, label: SCREEN_LABEL[s] }))}
          load={(src) => {
            setAdjustSrc(src)
            return loadSource(src)
          }}
          onApply={(picks, setBase) => void applyAdjust(adjustSrc, picks, setBase)}
          onClose={() => setAdjust(false)}
        />
      )}
      {receivable && <ReceivableDialog customer={all ? undefined : (vals.customer ?? '').trim().toUpperCase() || undefined} onClose={() => setReceivable(false)} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <label className="ma-label" style={{ textAlign: 'right', paddingRight: 14 }}>
        {label}
      </label>
      <span>{children}</span>
    </>
  )
}

/** Outstanding balances: one customer, or everyone who owes. */
function ReceivableDialog({ customer, onClose }: { customer?: string; onClose: () => void }) {
  const list = useLiveQuery(async () => (await db.customers.toArray()).filter((c) => (customer ? c.name.toUpperCase() === customer : c.balance > 0)).sort((a, b) => b.balance - a.balance), [customer], [] as Customer[])
  return (
    <Dialog title={customer ? `Receivable — ${customer}` : 'Receivable — all customers'} onClose={onClose} width={560}>
      <Grid
        cols={[
          { key: 'name', label: 'Customer', width: 220 },
          { key: 'phone', label: 'Phone', width: 110 },
          { key: 'limit', label: 'Credit Limit', width: 90, align: 'right' },
          { key: 'bal', label: 'Owes', width: 90, align: 'right' },
        ]}
        rows={list.map((c) => ({ id: c.id!, cells: { name: c.name.toUpperCase(), phone: c.phone ?? '', limit: amt(c.creditLimit), bal: amt(c.balance) } }))}
        height={260}
      />
      <div className="ma-label" style={{ marginTop: 6 }}>
        {list.length ? `Total owed: ${amt(list.reduce((s, c) => s + Math.max(0, c.balance), 0))}` : customer ? 'This customer owes nothing (or is not in the Party Master yet).' : 'No customer owes anything.'}
      </div>
    </Dialog>
  )
}

/* ══════════════════════ OTC BILL / RETURN / SERVICE BILL ══════════════════ */
type OLine = {
  key: string
  productId?: number
  name: string
  sku?: string
  form: string
  instruction: string
  qty: string
  cost: string
  price: string
  disc: string
  batch: string
  expiry: string
  taxable: boolean
  /** Return lines: the bill and line they come from, and how many can still go back. */
  saleId?: number
  saleLine?: number
  max?: number
}

const PAY_FIELDS = [
  ['cash', 'CASH'],
  ['mpesa', 'MPESA'],
  ['card', 'CREDIT CARD'],
  ['cheque', 'CHEQUE'],
] as const
type PayKey = (typeof PAY_FIELDS)[number][0]

/** "Payable By" accounts of the legacy bill and the payment method each one means. */
export const PAYABLE_BY: { label: string; method: Payment['method'] }[] = [
  { label: 'CASH COLLECTION ACCOUNT', method: 'cash' },
  { label: 'MPESA COLLECTION ACCOUNT', method: 'mpesa' },
  { label: 'CREDIT CARD COLLECTION ACCOUNT', method: 'card' },
  { label: 'CHEQUE COLLECTION ACCOUNT', method: 'cheque' },
  { label: 'CREDIT ACCOUNT', method: 'account' },
]

type OtcMode = 'bill' | 'return' | 'service'

/** Next number a bill / return / service bill will get (shown, not used up). */
async function peekNumber(mode: OtcMode, d: { billPrefix: string; servicePrefix: string }): Promise<string> {
  const key = mode === 'bill' ? 'seq:R' : mode === 'return' ? 'seq:RF' : 'seq:JOB'
  const next = Number((await db.kv.get(key))?.value ?? 0) + 1
  const yy = String(new Date().getFullYear()).slice(-2)
  return mode === 'bill' ? `${d.billPrefix}-${next}-${yy}` : mode === 'return' ? `RTN-${next}-${yy}` : `${d.servicePrefix}-${next}-${yy}`
}

export function OtcEntry({ mode, fromSale, onClose }: { mode: OtcMode; fromSale?: Sale; onClose: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const isReturn = mode === 'return'
  const isService = mode === 'service'
  const products = useLiveQuery(() => db.products.filter((p) => p.active && (isService ? !p.trackStock : true)).toArray(), [isService], [] as Product[])
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const [tab, setTab] = useState<'pay' | 'detail' | 'patient'>(isReturn ? 'pay' : 'detail')
  const blank = (): OLine => ({ key: `${Date.now()}-${Math.random()}`, name: '', form: '', instruction: '', qty: isService ? '1' : '0.0', cost: '', price: '', disc: '0.0', batch: '', expiry: '', taxable: !isService })
  const [lines, setLines] = useState<OLine[]>([blank()])
  const [pay, setPay] = useState<Record<PayKey, string>>({ cash: '0.0', mpesa: '0.0', card: '0.0', cheque: '0.0' })
  const [refs, setRefs] = useState({ status: '', mpesa: '', card: '', cheque: '' })
  const emptyPatient = () => ({ location: d.location, category: d.patientCategory.toUpperCase(), payable: PAYABLE_BY[0].label, pharma: '0.00', narration: '', name: '', age: '', phone: '' })
  const [patient, setPatient] = useState(emptyPatient)
  const [number, setNumber] = useState('')
  const [now, setNow] = useState(Date.now())
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [all, setAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ kind: 'product'; key: string } | { kind: 'category' } | { kind: 'payable' } | { kind: 'location' } | null>(null)
  const [adjust, setAdjust] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    void peekNumber(mode, d).then(setNumber)
  }, [mode, d.billPrefix, d.servicePrefix])
  useEffect(() => {
    // The chemist's location arrives a moment after the screen opens.
    setPatient((p) => ({ ...p, location: p.location || d.location, category: p.category || d.patientCategory.toUpperCase() }))
  }, [d.location, d.patientCategory])

  const reset = () => {
    setLines([blank()])
    setPay({ cash: '0.0', mpesa: '0.0', card: '0.0', cheque: '0.0' })
    setRefs({ status: '', mpesa: '', card: '', cheque: '' })
    setPatient(emptyPatient())
    setAll(false)
  }

  const linesFromSale = (s: Sale, idx: number[], qtyOf: (i: number) => number): OLine[] =>
    idx.map((i) => {
      const l = s.lines[i]
      const max = l.qty - (l.refundedQty ?? 0)
      const q = Math.min(max, qtyOf(i))
      return {
        key: `r${s.id}-${i}-${Date.now()}`,
        productId: l.productId,
        name: l.name,
        sku: l.sku,
        form: l.form ?? '',
        instruction: l.instruction ?? '',
        qty: String(q),
        cost: c2(l.unitCost),
        price: c2(l.unitPrice),
        disc: c2(Math.round((l.discount * q) / Math.max(1, l.qty))),
        batch: l.batch ?? '',
        expiry: l.expiry ?? '',
        taxable: l.taxable,
        saleId: s.id,
        saleLine: i,
        max,
      }
    })
  const patientFromSale = async (s: Sale) => {
    const c = s.customerId !== undefined ? await db.customers.get(s.customerId) : undefined
    setPatient((p) => ({
      ...p,
      category: p.category && p.category !== d.patientCategory.toUpperCase() ? p.category : c?.name.toUpperCase() ?? p.category,
      name: p.name || s.patientName || '',
      age: p.age || s.patientAge || '',
      phone: p.phone || s.patientPhone || c?.phone || '',
      location: s.location || p.location,
      payable: PAYABLE_BY.find((x) => x.method === s.payments[0]?.method)?.label ?? p.payable,
    }))
  }
  useEffect(() => {
    if (!fromSale || !isReturn) return
    const idx = fromSale.lines.map((_, i) => i).filter((i) => fromSale.lines[i].qty - (fromSale.lines[i].refundedQty ?? 0) > 0)
    setLines(linesFromSale(fromSale, idx, () => 0))
    void patientFromSale(fromSale)
    setTab('detail')
  }, [fromSale?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = lines.map((l) => {
    const qty = n(l.qty)
    const price = toCents(l.price || '0')
    const discount = toCents(l.disc || '0')
    return { qty, price, discount, cost: toCents(l.cost || '0'), amount: Math.max(0, Math.round(qty * price) - discount), totalCost: Math.round(qty * toCents(l.cost || '0')) }
  })
  const gross = calc.reduce((s, c) => s + c.amount, 0)
  const pharmaPct = isReturn ? 0 : Math.min(100, Math.max(0, n(patient.pharma)))
  const pharmaDisc = Math.round((gross * pharmaPct) / 100)
  const bill = gross - pharmaDisc
  const paid = Object.fromEntries(PAY_FIELDS.map(([k]) => [k, toCents(pay[k] || '0')])) as Record<PayKey, number>
  const received = paid.cash + paid.mpesa + paid.card + paid.cheque
  const change = Math.max(0, received - bill)
  const setLine = (key: string, patch: Partial<OLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addRow = () => {
    if (isReturn) return toast('Use ADJUST OTC Medicine Issue/Bill to pick what is being returned', 'error')
    setLines((ls) => [...ls, blank()])
    setTab('detail')
  }
  const labelOf = (p: Product) => `${p.name}${p.sku ? ` [${p.sku}]` : ''}`
  const takeProduct = (key: string, p: Product) => {
    if (lines.some((l) => l.key !== key && l.productId === p.id)) return toast(`${p.name} is already on the bill — change its Qty`, 'error')
    const cur = lines.find((l) => l.key === key)
    setLine(key, { productId: p.id, name: p.name, sku: p.sku, cost: c2(p.cost), price: c2(p.price), qty: cur && n(cur.qty) > 0 ? cur.qty : '1', taxable: p.taxable, batch: cur?.batch || (isService ? '' : p.location || '') })
  }
  const typedName = (key: string, name: string) => {
    const p = products.find((x) => labelOf(x).toUpperCase() === name.trim().toUpperCase() || x.name.toUpperCase() === name.trim().toUpperCase())
    if (p) takeProduct(key, p)
    else setLine(key, { name, productId: undefined, sku: undefined })
  }

  /* ADJUST OTC Medicine Issue/Bill (returns) */
  const loadBills = async (): Promise<AdjRow[]> => {
    const service = new Set((await db.jobs.toArray()).map((j) => j.saleId))
    const sales = (await db.sales.filter((s) => !s.refundOf && s.status !== 'voided' && s.status !== 'refunded' && !service.has(s.id)).toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
    const names = new Map(customers.map((c) => [c.id!, c.name.toUpperCase()]))
    const out: AdjRow[] = []
    for (const s of sales) {
      for (const [i, l] of s.lines.entries()) {
        const onForm = lines.filter((x) => x.saleId === s.id && x.saleLine === i).reduce((t, x) => t + n(x.qty), 0)
        const stock = l.productId ? (await db.products.get(l.productId))?.stock ?? 0 : 0
        out.push({ key: `${s.id}#${i}`, docDate: dmy(s.createdAt), docNo: billNo(s, d.billPrefix), party: s.patientName || names.get(s.customerId ?? -1) || d.patientCategory, product: l.name, org: l.qty, avail: stock, pend: Math.max(0, l.qty - (l.refundedQty ?? 0) - onForm), batch: l.batch, expiry: l.expiry })
      }
    }
    return out
  }
  const applyBills = async (picks: AdjPick[], setBase: boolean) => {
    const add: OLine[] = []
    let first: Sale | undefined
    for (const { row, qty } of picks) {
      const [sid, i] = row.key.split('#').map(Number)
      const s = await db.sales.get(sid)
      if (!s) continue
      first ??= s
      add.push(...linesFromSale(s, [i], () => qty))
    }
    setLines((ls) => [...ls.filter((l) => l.name.trim()), ...add])
    if (setBase && first) await patientFromSale(first)
    setTab('detail')
  }

  const notes = () => [patient.narration.trim(), refs.status.trim() && `STATUS ${refs.status.trim().toUpperCase()}`].filter(Boolean).join(' · ') || undefined
  const patientInfo = () => ({
    location: patient.location.trim().toUpperCase() || undefined,
    patientName: patient.name.trim().toUpperCase() || undefined,
    patientAge: patient.age.trim() || undefined,
    patientPhone: patient.phone.trim() || undefined,
  })
  const payableMethod = PAYABLE_BY.find((x) => x.label === patient.payable.trim().toUpperCase())?.method

  /** The patient's account (Patient Category other than the walk-in category). */
  const accountFor = async (): Promise<Customer | undefined> => {
    const cat = patient.category.trim().toUpperCase()
    if (!cat || cat === d.patientCategory.toUpperCase()) return undefined
    const found = customers.find((c) => c.name.toUpperCase() === cat)
    if (found) {
      if (patient.phone.trim() && !found.phone) await db.customers.update(found.id!, { phone: patient.phone.trim() })
      return found
    }
    const id = (await db.customers.add({ name: cat, phone: patient.phone.trim() || undefined, balance: 0, creditLimit: 0, createdAt: Date.now() } as Customer)) as number
    return db.customers.get(id)
  }

  const saveBill = async () => {
    const filled = lines.map((l, i) => ({ l, c: calc[i] })).filter(({ l }) => l.name.trim())
    if (!filled.length) {
      setTab('detail')
      throw new Error(`DETAIL: type or look up at least one ${isService ? 'service' : 'medicine'}`)
    }
    const noQty = filled.find(({ c }) => c.qty <= 0)
    if (noQty) throw new Error(`${noQty.l.name}: enter the Qty`)
    const noPrice = filled.find(({ c }) => c.price <= 0)
    if (noPrice) throw new Error(`${noPrice.l.name}: enter the ${isService ? 'Rate' : 'Selling Price'}`)
    if (!payableMethod) {
      setTab('patient')
      throw new Error('PATIENT INFORMATION: pick Payable By from the list')
    }
    const customer = await accountFor()
    // Nothing typed under PAYMENT: the whole bill goes to the Payable By account.
    const entered = { ...paid }
    const mpesaRef = refs.mpesa.trim().toUpperCase()
    if (received === 0 && payableMethod !== 'account') entered[payableMethod as PayKey] = bill
    const got = entered.cash + entered.mpesa + entered.card + entered.cheque
    if (entered.mpesa > 0 && !mpesaRef) {
      setTab('pay')
      throw new Error(`${isService ? 'PAYMENT' : 'PAYMENT DETAILS'}: type the MPESA Number (confirmation code from the SMS)`)
    }
    if (entered.cheque > 0 && !refs.cheque.trim()) {
      setTab('pay')
      throw new Error('Type the CHEQUE NO')
    }
    if (entered.mpesa + entered.card + entered.cheque > bill) throw new Error('Only cash can be more than the Bill Amount (the change is given in cash)')
    const owing = Math.max(0, bill - got)
    if (owing > 0) {
      if (!customer) {
        setTab(received ? 'pay' : 'patient')
        throw new Error(`${amt(owing)} is not paid. Enter the payment, or set Patient Category to the customer whose account it goes on.`)
      }
      if (customer.blacklisted) throw new Error(`${customer.name} is blacklisted in the Party Master — take the full payment`)
      if (customer.billType === 'PAY NOW') throw new Error(`${customer.name} is PAY NOW in the Party Master — take the full payment`)
    }
    const payments: Payment[] = []
    if (entered.cash > 0) payments.push({ method: 'cash', amount: entered.cash })
    if (entered.mpesa > 0) payments.push({ method: 'mpesa', amount: entered.mpesa, reference: mpesaRef })
    if (entered.card > 0) payments.push({ method: 'card', amount: entered.card, reference: refs.card.trim() || undefined })
    if (entered.cheque > 0) payments.push({ method: 'cheque', amount: entered.cheque, reference: refs.cheque.trim() })
    if (owing > 0) payments.push({ method: 'account', amount: owing })
    const saleLines: SaleLine[] = filled.map(({ l, c }) => ({
      productId: l.productId,
      name: l.name.trim().toUpperCase(),
      sku: l.sku,
      qty: c.qty,
      unitPrice: c.price,
      unitCost: c.cost,
      discount: c.discount,
      taxable: l.taxable,
      form: l.form.trim().toUpperCase() || undefined,
      instruction: l.instruction.trim() || undefined,
      batch: l.batch.trim() || undefined,
      expiry: l.expiry.trim() || undefined,
    }))
    const sale = await completeSale({ lines: saleLines, discount: pharmaDisc, payments, customerId: customer?.id, userId: user!.id ?? 0, note: notes(), patient: patientInfo() })
    if (isService) {
      // The Service Request/Bill register lists service jobs; this one is billed and done.
      const jobNo = await nextNumber('JOB')
      await db.jobs.add({
        jobNo,
        customerId: customer?.id,
        customerName: (patient.name.trim() || customer?.name || d.patientCategory).toUpperCase(),
        phone: patient.phone.trim() || customer?.phone,
        complaint: patient.narration.trim() || saleLines.map((l) => l.name).join(', '),
        lines: saleLines,
        labour: 0,
        status: 'collected',
        mechanic: user!.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        saleId: sale.id,
      })
      toast(`Service bill ${d.servicePrefix}-${Number(jobNo.split('-').pop())}-${String(new Date().getFullYear()).slice(-2)} saved${sale.change ? ` — change ${amt(sale.change)}` : ''}`)
    } else toast(`Bill ${billNo(sale, d.billPrefix)} issued${sale.change ? ` — change ${amt(sale.change)}` : ''}`)
    return sale
  }

  const saveReturn = async () => {
    const filled = lines.map((l, i) => ({ l, c: calc[i] })).filter(({ l, c }) => l.name.trim() && c.qty > 0)
    if (!filled.length) {
      setTab('detail')
      throw new Error('Use ADJUST OTC Medicine Issue/Bill and enter the Qty being returned')
    }
    const loose = filled.find(({ l }) => l.saleId === undefined)
    if (loose) throw new Error(`${loose.l.name} is not from a bill — use ADJUST OTC Medicine Issue/Bill`)
    const over = filled.find(({ l, c }) => c.qty > (l.max ?? 0))
    if (over) throw new Error(`${over.l.name}: only ${over.l.max} can still be returned`)
    // Money goes back the way typed under PAYMENT DETAILS, else by Payable By.
    const method = (PAY_FIELDS.find(([k]) => paid[k] > 0)?.[0] ?? payableMethod ?? 'cash') as Payment['method']
    const bySale = new Map<number, Record<number, number>>()
    for (const { l, c } of filled) {
      const m = bySale.get(l.saleId!) ?? {}
      m[l.saleLine!] = (m[l.saleLine!] ?? 0) + c.qty
      bySale.set(l.saleId!, m)
    }
    let last: Sale | undefined
    let back = 0
    for (const [saleId, qtyByLine] of bySale) {
      last = await refundSale(saleId, { qtyByLine, restock: true, method, userId: user!.id ?? 0, reason: notes(), patient: patientInfo() })
      back += -last.total
    }
    toast(`Return recorded — ${amt(back)} back to the patient (${method === 'account' ? 'credited to the account' : method.toUpperCase()})`)
    return last
  }

  const save = async () => {
    if (saving || !user) return
    setSaving(true)
    try {
      const sale = isReturn ? await saveReturn() : await saveBill()
      if (sale && jasper) await printReceipt(sale, await getSettings()).catch(() => false)
      if (sale && sms) openSms(patient.phone, `${d.companyName}: ${isReturn ? 'return' : 'bill'} ${billNo(sale, d.billPrefix)} KES ${c2(Math.abs(sale.total))}. Thank you.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  useEntryKeys({ save: () => void save(), back: onClose, newRow: addRow })

  const account = isReturn ? 'OTC MEDICINE RETURN' : isService ? 'OP service Bill' : 'OTC MEDICINE ISSUE'
  const W = { name: 140, form: 55, instr: 145, qty: 50, cost: 55, tcost: 70, price: 70, disc: 70, amt: 70, batch: 95, exp: 95 }
  const payLabelStyle: CSSProperties = { textAlign: 'right', paddingRight: 14 }
  const readOnlyPrice = isReturn
  const title = isReturn ? 'OTC Medicine Isse Return' : isService ? 'Service Request/Bill' : 'OTC Medicine Issue/Bill'
  const summary = useMemo(() => ({ bill, received, change }), [bill, received, change])
  const tabs = isService
    ? [
        { id: 'detail' as const, label: 'DETAIL' },
        { id: 'pay' as const, label: 'PAYMENT' },
        { id: 'patient' as const, label: 'PATIENT INFORMATION' },
      ]
    : [
        { id: 'pay' as const, label: 'PAYMENT DETAILS' },
        { id: 'detail' as const, label: 'DETAIL' },
        { id: 'patient' as const, label: 'PATIENT INFORMATION' },
      ]
  const time = new Date(now)
  const pad2 = (x: number) => String(x).padStart(2, '0')

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <EntryHeader title={title} adjust={isReturn ? 'OTC Medicine Issue/Bill' : undefined} onAdjust={() => setAdjust(true)} onView={onClose} onRefresh={reset} />
      <SubTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pay' && (
        <div style={{ ...panel, paddingTop: 40, display: 'flex', gap: 60 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '110px 80px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            {PAY_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <Cell value={pay[k]} onChange={(v) => setPay({ ...pay, [k]: v })} width={75} right label={label} />
              </Field>
            ))}
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '120px 200px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <span style={payLabelStyle} className="ma-label">Status</span>
            <Cell value={refs.status} onChange={(v) => setRefs({ ...refs, status: v })} width={190} placeholder={isReturn ? 'e.g. EXPIRED, WRONG ITEM' : 'e.g. PAID, COLLECTED'} label="Status" />
            <span style={payLabelStyle} className="ma-label">MPESA Number</span>
            <Cell value={refs.mpesa} onChange={(v) => setRefs({ ...refs, mpesa: v.toUpperCase() })} width={100} placeholder="e.g. SJK7AB12CD" label="MPESA Number" />
            <span style={payLabelStyle} className="ma-label">CREDIT NO</span>
            <Cell value={refs.card} onChange={(v) => setRefs({ ...refs, card: v })} width={100} placeholder="Card approval no." label="CREDIT NO" />
            <span style={payLabelStyle} className="ma-label">CHEQUE NO</span>
            <Cell value={refs.cheque} onChange={(v) => setRefs({ ...refs, cheque: v })} width={100} placeholder="Cheque number" label="CHEQUE NO" />
            <span style={payLabelStyle} className="ma-label">TOTAL RECEIVED</span>
            <Cell value={c2(summary.received)} width={75} right readOnly label="TOTAL RECEIVED" />
            <span style={payLabelStyle} className="ma-label">Bill Amount</span>
            <Cell value={c2(summary.bill)} width={75} right readOnly label="Bill Amount" />
            <span style={payLabelStyle} className="ma-label">Change To Be Return</span>
            <Cell value={c2(isReturn ? 0 : summary.change)} width={75} right readOnly label="Change To Be Return" />
          </div>
          <div className="ma-label" style={{ alignSelf: 'flex-end', maxWidth: 260, whiteSpace: 'normal' }}>
            {isReturn ? 'Type the amount under the way the money goes back, or leave it all 0.0 to use Payable By.' : 'Leave everything at 0.0 to put the whole bill on the Payable By account (PATIENT INFORMATION).'}
          </div>
        </div>
      )}
      {tab === 'detail' && (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="ma-label" style={{ fontSize: 11 }}>
              DETAIL FORM
            </span>
            <Btn onClick={addRow}>NEW ROW(F7)</Btn>
          </div>
          {isService ? (
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px' }}>
              <thead>
                <tr>
                  {[['S NO', 30], ['Service', 166], ['Qty', 50], ['Rate', 100], ['Amount', 75], ['', 20]].map(([h, w]) => (
                    <th key={String(h) || 'x'} style={{ ...head, width: w as number }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td style={{ fontSize: 11 }}>{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input className="ma-input" style={{ width: 140 }} value={l.name} list="ma-otc-products" placeholder="Type or look up" aria-label="Service" onChange={(e) => typedName(l.key, e.target.value)} />
                      <LookupBtn title="Look up a service (Services Master)" onClick={() => setPick({ kind: 'product', key: l.key })} />
                    </td>
                    <td><Cell value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} width={50} right label="Qty" /></td>
                    <td><Cell value={l.price} onChange={(v) => setLine(l.key, { price: v })} width={100} right label="Rate" placeholder="Charge per service" /></td>
                    <td><Cell value={c2(calc[i].amount)} width={75} right readOnly label="Amount" /></td>
                    <td>{lines.length > 1 && <DeleteX title="Remove this row" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontSize: 11 }}>SUM</td>
                  <td colSpan={3} />
                  <td>
                    <Cell value={c2(gross)} width={75} right readOnly label="SUM" />
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px' }}>
              <thead>
                <tr>
                  {[['S NO', 30], ['Medicine Name', W.name + 26], ['Type', W.form], ['Instruction', W.instr], ['Qty', W.qty], ['Cost Rate', W.cost], ['Total Cost', W.tcost], ['Selling Price', W.price], ['Disc', W.disc], ['Amount', W.amt], ['Batch No', W.batch], ['Exp Dt', W.exp], ['', 20]].map(([h, w]) => (
                    <th key={String(h) || 'x'} style={{ ...head, width: w as number }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const c = calc[i]
                  return (
                    <tr key={l.key} style={{ verticalAlign: 'top' }}>
                      <td style={{ fontSize: 11, paddingTop: 4 }}>{i + 1}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input
                          className="ma-input"
                          style={{ width: W.name, borderColor: !l.name && i === 0 ? '#e57373' : undefined }}
                          value={l.name}
                          list="ma-otc-products"
                          placeholder={isReturn ? 'Use ADJUST to pick' : 'Type or look up'}
                          aria-label="Medicine Name"
                          readOnly={isReturn}
                          onChange={(e) => typedName(l.key, e.target.value)}
                        />
                        {!isReturn && <LookupBtn title="Look up a medicine" onClick={() => setPick({ kind: 'product', key: l.key })} />}
                      </td>
                      <td><Cell value={l.form} onChange={(v) => setLine(l.key, { form: v.toUpperCase() })} width={W.form} placeholder="TAB" label="Type" /></td>
                      <td>
                        <textarea className="ma-input" style={{ width: W.instr, height: 42, resize: 'vertical', fontSize: 11 }} value={l.instruction} placeholder="e.g. 1 x 3 for 5 days" aria-label="Instruction" onChange={(e) => setLine(l.key, { instruction: e.target.value })} />
                      </td>
                      <td><Cell value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} width={W.qty} right label="Qty" placeholder={l.max !== undefined ? `max ${l.max}` : undefined} /></td>
                      <td><Cell value={l.cost} onChange={(v) => setLine(l.key, { cost: v })} width={W.cost} right readOnly={readOnlyPrice} label="Cost Rate" /></td>
                      <td><Cell value={c2(c.totalCost)} width={W.tcost} right readOnly label="Total Cost" /></td>
                      <td><Cell value={l.price} onChange={(v) => setLine(l.key, { price: v })} width={W.price} right readOnly={readOnlyPrice} label="Selling Price" /></td>
                      <td><Cell value={l.disc} onChange={(v) => setLine(l.key, { disc: v })} width={W.disc} right readOnly={readOnlyPrice} label="Disc" /></td>
                      <td><Cell value={c2(c.amount)} width={W.amt} right readOnly label="Amount" /></td>
                      <td><Cell value={l.batch} onChange={(v) => setLine(l.key, { batch: v.toUpperCase() })} width={W.batch} placeholder="Batch no." label="Batch No" /></td>
                      <td><Cell value={l.expiry} onChange={(v) => setLine(l.key, { expiry: v })} width={W.exp} placeholder="dd-mm-yyyy" label="Exp Dt" /></td>
                      <td>
                        <DeleteX title="Remove this row" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))} />
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td style={{ fontSize: 11 }}>SUM</td>
                  <td colSpan={8} />
                  <td>
                    <Cell value={c2(gross)} width={W.amt} right readOnly label="SUM" />
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <datalist id="ma-otc-products">
            {products.map((p) => (
              <option key={p.id} value={labelOf(p)} />
            ))}
          </datalist>
        </div>
      )}
      {tab === 'patient' && (
        <div style={{ ...panel, paddingTop: 34, display: 'flex', gap: 40 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 220px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Location">
              <span style={{ display: 'inline-flex' }}>
                <Input value={patient.location} onChange={(v) => setPatient({ ...patient, location: v.toUpperCase() })} width={140} placeholder="Stock location" />
                <LookupBtn title="Pick a location" onClick={() => setPick({ kind: 'location' })} />
              </span>
            </Field>
            <Field label={isReturn ? 'Return No.' : 'Bill No.'}>
              <Input value={number || '(auto)'} readOnly width={100} />
            </Field>
            <Field label="Date">
              <Input value={dmy(now, '/')} readOnly width={84} />
            </Field>
            <Field label="Patient Category">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={patient.category} list="ma-otc-patients" placeholder={`${d.patientCategory}, or the account holder`} aria-label="Patient Category" onChange={(e) => setPatient({ ...patient, category: e.target.value.toUpperCase() })} />
                <LookupBtn title="Look up a customer account" onClick={() => setPick({ kind: 'category' })} />
              </span>
            </Field>
            <Field label="Payable By">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={patient.payable} list="ma-otc-payable" placeholder="Account the bill goes to" aria-label="Payable By" onChange={(e) => setPatient({ ...patient, payable: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick how it is paid" onClick={() => setPick({ kind: 'payable' })} />
              </span>
            </Field>
            <Field label="Pharma %">
              <Input value={isReturn ? '0.00' : patient.pharma} onChange={(v) => setPatient({ ...patient, pharma: v })} width={75} readOnly={isReturn} style={{ textAlign: 'right' }} placeholder="Discount %" />
            </Field>
            <span />
            <span className="ma-label" style={{ fontSize: 10 }}>
              {isReturn ? 'Any bill discount is shared out on the return automatically.' : pharmaDisc ? `Discount ${amt(pharmaDisc)} off ${amt(gross)}` : 'Discount on the whole bill, e.g. 5'}
            </span>
            <Field label="Narration">
              <textarea className="ma-input" style={{ width: 200, height: 44, resize: 'vertical' }} value={patient.narration} placeholder={isReturn ? 'Why it is returned' : isService ? 'What was done (optional)' : 'Note on the bill (optional)'} aria-label="Narration" onChange={(e) => setPatient({ ...patient, narration: e.target.value })} />
            </Field>
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '110px 160px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Patient Name">
              <Input value={patient.name} onChange={(v) => setPatient({ ...patient, name: v })} width={150} placeholder="Who the medicine is for" />
            </Field>
            <Field label="Age">
              <Input value={patient.age} onChange={(v) => setPatient({ ...patient, age: v })} width={100} placeholder="e.g. 34 or 6 MONTHS" />
            </Field>
            <Field label="Contact No">
              <Input value={patient.phone} onChange={(v) => setPatient({ ...patient, phone: v })} width={100} placeholder="e.g. 0712 345 678" />
            </Field>
            <Field label="User Name">
              <Input value={user?.name.toUpperCase() ?? ''} readOnly width={100} />
            </Field>
            <Field label="Time">
              <Input value={`${pad2(time.getHours())} : ${pad2(time.getMinutes())} : ${pad2(time.getSeconds())}`} readOnly width={100} />
            </Field>
          </div>
          <datalist id="ma-otc-patients">
            {customers.map((c) => (
              <option key={c.id} value={c.name.toUpperCase()} />
            ))}
          </datalist>
          <datalist id="ma-otc-payable">
            {PAYABLE_BY.map((p) => (
              <option key={p.label} value={p.label} />
            ))}
          </datalist>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 190 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save (F2)
        </Btn>
        <span style={{ width: 240 }} />
        <Check checked onChange={() => {}} disabled dark title="Bills and returns always post to the accounts">
          Accounts?
        </Check>
        <Select value={account} options={[account]} width={150} disabled />
        <Check checked={jasper} onChange={setJasper} dark title="Print the receipt after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS to the patient after saving">
          Send Sms
        </Check>
      </div>
      {isReturn && tab === 'detail' && (
        <div style={{ marginTop: 12, paddingLeft: 210 }}>
          <Check
            checked={all}
            onChange={(v) => {
              setAll(v)
              setLines((ls) => ls.map((l) => (l.max !== undefined ? { ...l, qty: v ? String(l.max) : '0' } : l)))
            }}
            dark
            title="Return everything still returnable on the picked bill(s)"
          >
            ALL
          </Check>
        </div>
      )}

      {pick?.kind === 'product' && (
        <PickList
          title={isService ? 'Service' : 'Medicine'}
          options={[...products].sort((a, b) => a.name.localeCompare(b.name)).map(labelOf)}
          onClose={() => setPick(null)}
          onPick={(v) => {
            const p = products.find((x) => labelOf(x) === v)
            if (p) takeProduct(pick.key, p)
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'category' && (
        <PickList
          title="Patient Category"
          options={[d.patientCategory.toUpperCase(), ...customers.map((c) => c.name.toUpperCase())]}
          onClose={() => setPick(null)}
          onPick={(v) => {
            const c = customers.find((x) => x.name.toUpperCase() === v)
            setPatient({ ...patient, category: v, phone: patient.phone || c?.phone || '', payable: c && c.billType !== 'PAY NOW' && !c.blacklisted ? 'CREDIT ACCOUNT' : patient.payable })
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'payable' && (
        <PickList title="Payable By" options={PAYABLE_BY.map((p) => p.label)} onClose={() => setPick(null)} onPick={(v) => { setPatient({ ...patient, payable: v }); setPick(null) }} />
      )}
      {pick?.kind === 'location' && (
        <PickList title="Location" options={d.locations} onClose={() => setPick(null)} onPick={(v) => { setPatient({ ...patient, location: v }); setPick(null) }} />
      )}
      {adjust && <AdjustmentDialog sources={[{ value: 'otc-bill', label: 'OTC Bill' }]} load={() => loadBills()} onApply={(p, b) => void applyBills(p, b)} onClose={() => setAdjust(false)} />}
    </div>
  )
}

/* ══════════════════════ PARTY MASTER ══════════════════════════════════════ */
const PARTY_TYPES = ['CUSTOMER', 'SUPPLIERS'] as const
const BILL_TYPES = ['PAY LATER', 'PAY NOW'] as const

/** Customer or supplier card (Party Master → +). Writes the real customers / suppliers tables. */
export function PartyEntry({ party, onClose }: { party?: { kind: 'customer' | 'supplier'; id: number }; onClose: () => void }) {
  const toast = useToast()
  const d = useMedDefaults()
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [])
  const empty = { name: '', type: 'CUSTOMER', blacklisted: 'NO', address: '', poBox: '', phone: '', kraPin: '', email: '', contactPerson: '', contactPhone: '', groupAccount: '', billType: 'PAY LATER', creditLimit: '0.00' }
  const [f, setF] = useState(empty)
  const [loaded, setLoaded] = useState(!party)
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<'type' | 'group' | 'bill' | null>(null)
  const set = (k: keyof typeof empty) => (v: string) => setF((x) => ({ ...x, [k]: v }))

  useEffect(() => {
    if (!party) return
    void (party.kind === 'supplier' ? db.suppliers.get(party.id) : db.customers.get(party.id)).then((r) => {
      if (!r) return toast('That party no longer exists', 'error')
      const c = r as Customer
      setF({
        name: r.name,
        type: party.kind === 'supplier' ? 'SUPPLIERS' : 'CUSTOMER',
        blacklisted: r.blacklisted || /blacklist/i.test(r.notes ?? '') ? 'YES' : 'NO',
        address: r.address ?? r.notes ?? '',
        poBox: r.poBox ?? '',
        phone: r.phone ?? '',
        kraPin: r.kraPin ?? '',
        email: r.email ?? '',
        contactPerson: r.contactPerson ?? '',
        contactPhone: r.contactPhone ?? '',
        groupAccount: r.groupAccount ?? '',
        billType: r.billType ?? 'PAY LATER',
        creditLimit: party.kind === 'customer' ? c2(c.creditLimit ?? 0) : '0.00',
      })
      setLoaded(true)
    })
  }, [party?.id, party?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const isSupplier = f.type === 'SUPPLIERS'
  const groups = [...new Set(['SUNDRY DEBTORS', 'SUNDRY CREDITORS', ...[...customers, ...suppliers].map((p) => (p.groupAccount ?? '').toUpperCase()).filter(Boolean)])]

  const save = async () => {
    if (saving || !loaded) return
    const name = f.name.trim().toUpperCase()
    if (!name) return toast('Facilty Name is required', 'error')
    if (!PARTY_TYPES.includes(f.type as (typeof PARTY_TYPES)[number])) return toast('Type must be CUSTOMER or SUPPLIERS (use the lookup)', 'error')
    if (!BILL_TYPES.includes(f.billType as (typeof BILL_TYPES)[number])) return toast('Bill Type must be PAY LATER or PAY NOW (use the lookup)', 'error')
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast('Email Address does not look right, e.g. orders@clinic.co.ke', 'error')
    const clash = (isSupplier ? suppliers : customers).find((p) => p.name.toUpperCase() === name && !(party && p.id === party.id && (party.kind === 'supplier') === isSupplier))
    if (clash) return toast(`${name} is already in the Party Master`, 'error')
    const rec = {
      name,
      phone: f.phone.trim() || undefined,
      email: f.email.trim() || undefined,
      address: f.address.trim() || undefined,
      poBox: f.poBox.trim() || undefined,
      kraPin: f.kraPin.trim().toUpperCase() || undefined,
      contactPerson: f.contactPerson.trim().toUpperCase() || undefined,
      contactPhone: f.contactPhone.trim() || undefined,
      groupAccount: f.groupAccount.trim().toUpperCase() || (isSupplier ? 'SUNDRY CREDITORS' : 'SUNDRY DEBTORS'),
      billType: f.billType as 'PAY LATER' | 'PAY NOW',
      blacklisted: f.blacklisted === 'YES',
    }
    setSaving(true)
    try {
      if (isSupplier) {
        if (party?.kind === 'supplier') await db.suppliers.update(party.id, rec)
        else await db.suppliers.add(rec)
      } else {
        const creditLimit = toCents(f.creditLimit || '0')
        if (party?.kind === 'customer') await db.customers.update(party.id, { ...rec, creditLimit })
        else await db.customers.add({ ...rec, balance: 0, creditLimit, createdAt: Date.now() } as Customer)
      }
      toast(`${name} saved`)
      if (jasper)
        printSheet(
          `${d.companyName} — Party Master`,
          [
            ['Facilty Name', name],
            ['Type', f.type],
            ['Group Account', rec.groupAccount],
            ['Bill Type', rec.billType],
            ['Blacklisted', f.blacklisted],
            ['Address', rec.address ?? ''],
            ['P.O Box No', rec.poBox ?? ''],
            ['Tel No', rec.phone ?? ''],
            ['KRA PIN', rec.kraPin ?? ''],
            ['Email Address', rec.email ?? ''],
            ['Contact Person', rec.contactPerson ?? ''],
            ['Contacts No', rec.contactPhone ?? ''],
          ],
          [],
          [],
          [],
        )
      if (sms) openSms(rec.contactPhone ?? rec.phone, `${d.companyName}: your details are saved with us. Thank you.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  useEntryKeys({ save: () => void save(), back: onClose })

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <EntryHeader title={`Party Master${party ? ` — ${f.name}` : ''}`} onView={onClose} onRefresh={() => !party && setF(empty)} />
      <SubTabs tabs={[{ id: 'header', label: 'HEADER' }]} value="header" onChange={() => {}} />
      <div style={{ ...panel, paddingTop: 34, display: 'flex', gap: 40 }}>
        <div className="ma-form" style={{ gridTemplateColumns: '140px 220px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
          <Field label="Facilty Name">
            <input className="ma-input" style={{ width: 200, borderColor: f.name.trim() ? undefined : '#e57373' }} value={f.name} autoFocus placeholder="Name as it should print" aria-label="Facilty Name" onChange={(e) => set('name')(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Type">
            <span style={{ display: 'inline-flex' }}>
              <input className="ma-input" style={{ width: 140 }} value={f.type} list="ma-party-types" readOnly={!!party} placeholder="CUSTOMER or SUPPLIERS" aria-label="Type" onChange={(e) => set('type')(e.target.value.toUpperCase())} />
              {!party && <LookupBtn title="Pick the type" onClick={() => setPick('type')} />}
            </span>
          </Field>
          <Field label="Blacklisted (Yes/No)">
            <Select value={f.blacklisted} onChange={set('blacklisted')} options={['NO', 'YES']} width={75} />
          </Field>
          <Field label="Address">
            <textarea className="ma-input" style={{ width: 190, height: 44, resize: 'vertical' }} value={f.address} placeholder="Street / building, town" aria-label="Address" onChange={(e) => set('address')(e.target.value)} />
          </Field>
          <Field label="P.O Box No">
            <Input value={f.poBox} onChange={set('poBox')} width={100} placeholder="e.g. 1234-00100" />
          </Field>
          <Field label="Tel No">
            <Input value={f.phone} onChange={set('phone')} width={200} placeholder="e.g. 0712 345 678" />
          </Field>
          <Field label="KRA PIN">
            <Input value={f.kraPin} onChange={(v) => set('kraPin')(v.toUpperCase())} width={100} placeholder="e.g. P051234567X" />
          </Field>
          {!isSupplier && (
            <Field label="Credit Limit">
              <Input value={f.creditLimit} onChange={set('creditLimit')} width={100} style={{ textAlign: 'right' }} placeholder="0.00 = no limit" />
            </Field>
          )}
        </div>
        <div className="ma-form" style={{ gridTemplateColumns: '110px 220px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
          <Field label="Email Address">
            <Input value={f.email} onChange={set('email')} width={200} placeholder="e.g. orders@clinic.co.ke" />
          </Field>
          <Field label="Contact Person">
            <Input value={f.contactPerson} onChange={set('contactPerson')} width={200} placeholder="Who to talk to" />
          </Field>
          <Field label="Contacts No">
            <Input value={f.contactPhone} onChange={set('contactPhone')} width={200} placeholder="Contact person's phone" />
          </Field>
          <Field label="Group Account">
            <span style={{ display: 'inline-flex' }}>
              <input className="ma-input" style={{ width: 140 }} value={f.groupAccount} list="ma-party-groups" placeholder={isSupplier ? 'SUNDRY CREDITORS' : 'SUNDRY DEBTORS'} aria-label="Group Account" onChange={(e) => set('groupAccount')(e.target.value.toUpperCase())} />
              <LookupBtn title="Pick a group account" onClick={() => setPick('group')} />
            </span>
          </Field>
          <Field label="Bill Type">
            <span style={{ display: 'inline-flex' }}>
              <input className="ma-input" style={{ width: 140 }} value={f.billType} list="ma-party-bill" placeholder="PAY LATER or PAY NOW" aria-label="Bill Type" onChange={(e) => set('billType')(e.target.value.toUpperCase())} />
              <LookupBtn title="Pick the bill type" onClick={() => setPick('bill')} />
            </span>
          </Field>
          <span />
          <span className="ma-label" style={{ fontSize: 10, whiteSpace: 'normal' }}>
            PAY LATER may take goods on account; PAY NOW and blacklisted parties must pay in full.
          </span>
        </div>
        <datalist id="ma-party-types">{PARTY_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        <datalist id="ma-party-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <datalist id="ma-party-bill">{BILL_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 190 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving || !loaded}>
          Save (F2)
        </Btn>
        <span style={{ width: 380 }} />
        <Check checked={jasper} onChange={setJasper} dark title="Print the party card after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS to the party after saving">
          Send Sms
        </Check>
      </div>
      {pick === 'type' && <PickList title="Type" options={[...PARTY_TYPES]} onClose={() => setPick(null)} onPick={(v) => { set('type')(v); setPick(null) }} />}
      {pick === 'group' && <PickList title="Group Account" options={groups} onClose={() => setPick(null)} onPick={(v) => { set('groupAccount')(v); setPick(null) }} />}
      {pick === 'bill' && <PickList title="Bill Type" options={[...BILL_TYPES]} onClose={() => setPick(null)} onPick={(v) => { set('billType')(v); setPick(null) }} />}
    </div>
  )
}
