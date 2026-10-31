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
import { getSettings, useSettings } from '../../db/settings'
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
<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${lines.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
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
      if (sms) openSms(customers.find((c) => c.id === customerId)?.phone, `${d.companyName}: ${def.title} ${values.docNo ?? ''} for ${customer}, total KES ${c2(total)}.`)
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

/* ══════════════════════ OTC BILL / RETURN ═════════════════════════════════ */
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

export function OtcEntry({ mode, fromSale, onClose }: { mode: 'bill' | 'return'; fromSale?: Sale; onClose: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const isReturn = mode === 'return'
  const [tab, setTab] = useState<'pay' | 'detail' | 'patient'>(isReturn ? 'pay' : 'detail')
  const blank = (): OLine => ({ key: `${Date.now()}-${Math.random()}`, name: '', form: '', instruction: '', qty: '0.0', cost: '', price: '', disc: '0.0', batch: '', expiry: '', taxable: true })
  const [lines, setLines] = useState<OLine[]>([blank()])
  const [pay, setPay] = useState<Record<PayKey, string>>({ cash: '0.0', mpesa: '0.0', card: '0.0', cheque: '0.0' })
  const [refs, setRefs] = useState({ status: '', mpesa: '', card: '', cheque: '' })
  const [patient, setPatient] = useState({ name: '', phone: '', narration: '' })
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const [all, setAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ kind: 'product'; key: string } | { kind: 'patient' } | null>(null)
  const [adjust, setAdjust] = useState(false)

  const reset = () => {
    setLines([blank()])
    setPay({ cash: '0.0', mpesa: '0.0', card: '0.0', cheque: '0.0' })
    setRefs({ status: '', mpesa: '', card: '', cheque: '' })
    setPatient({ name: '', phone: '', narration: '' })
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
  useEffect(() => {
    if (!fromSale || !isReturn) return
    const idx = fromSale.lines.map((_, i) => i).filter((i) => fromSale.lines[i].qty - (fromSale.lines[i].refundedQty ?? 0) > 0)
    setLines(linesFromSale(fromSale, idx, () => 0))
    void db.customers.get(fromSale.customerId ?? -1).then((c) => c && setPatient((p) => ({ ...p, name: c.name.toUpperCase(), phone: c.phone ?? '' })))
    setTab('detail')
  }, [fromSale?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = lines.map((l) => {
    const qty = n(l.qty)
    const price = toCents(l.price || '0')
    const discount = toCents(l.disc || '0')
    return { qty, price, discount, cost: toCents(l.cost || '0'), amount: Math.max(0, Math.round(qty * price) - discount), totalCost: Math.round(qty * toCents(l.cost || '0')) }
  })
  const bill = calc.reduce((s, c) => s + c.amount, 0)
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
    setLine(key, { productId: p.id, name: p.name, sku: p.sku, cost: c2(p.cost), price: c2(p.price), qty: cur && n(cur.qty) > 0 ? cur.qty : '1', taxable: p.taxable, batch: cur?.batch || p.location || '' })
  }
  const typedName = (key: string, name: string) => {
    const p = products.find((x) => labelOf(x).toUpperCase() === name.trim().toUpperCase() || x.name.toUpperCase() === name.trim().toUpperCase())
    if (p) takeProduct(key, p)
    else setLine(key, { name, productId: undefined, sku: undefined })
  }

  /* ADJUST OTC Medicine Issue/Bill (returns) */
  const loadBills = async (): Promise<AdjRow[]> => {
    const sales = (await db.sales.filter((s) => !s.refundOf && s.status !== 'voided' && s.status !== 'refunded').toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
    const names = new Map(customers.map((c) => [c.id!, c.name.toUpperCase()]))
    const out: AdjRow[] = []
    for (const s of sales) {
      for (const [i, l] of s.lines.entries()) {
        const onForm = lines.filter((x) => x.saleId === s.id && x.saleLine === i).reduce((t, x) => t + n(x.qty), 0)
        const stock = l.productId ? (await db.products.get(l.productId))?.stock ?? 0 : 0
        out.push({ key: `${s.id}#${i}`, docDate: dmy(s.createdAt), docNo: billNo(s, d.billPrefix), party: names.get(s.customerId ?? -1) ?? d.patientCategory, product: l.name, org: l.qty, avail: stock, pend: Math.max(0, l.qty - (l.refundedQty ?? 0) - onForm), batch: l.batch, expiry: l.expiry })
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
    if (setBase && first?.customerId !== undefined) {
      const c = await db.customers.get(first.customerId)
      if (c) setPatient((p) => ({ ...p, name: p.name || c.name.toUpperCase(), phone: p.phone || c.phone || '' }))
    }
    setTab('detail')
  }

  const notes = () => [patient.narration.trim(), refs.status.trim() && `STATUS ${refs.status.trim().toUpperCase()}`].filter(Boolean).join(' · ') || undefined

  const saveBill = async () => {
    const filled = lines.map((l, i) => ({ l, c: calc[i] })).filter(({ l }) => l.name.trim())
    if (!filled.length) {
      setTab('detail')
      throw new Error('DETAIL: type or look up at least one medicine')
    }
    const noQty = filled.find(({ c }) => c.qty <= 0)
    if (noQty) throw new Error(`${noQty.l.name}: enter the Qty`)
    const noPrice = filled.find(({ c }) => c.price <= 0)
    if (noPrice) throw new Error(`${noPrice.l.name}: enter the Selling Price`)
    if (paid.mpesa > 0 && !refs.mpesa.trim()) throw new Error('PAYMENT DETAILS: type the MPESA Number (confirmation code) for the M-Pesa amount')
    if (paid.cheque > 0 && !refs.cheque.trim()) throw new Error('PAYMENT DETAILS: type the CHEQUE NO')
    if (paid.mpesa + paid.card + paid.cheque > bill) throw new Error('Only cash can be more than the Bill Amount (the change is given in cash)')
    const name = patient.name.trim().toUpperCase()
    let customerId: number | undefined
    if (name && name !== d.patientCategory.toUpperCase()) {
      customerId = customers.find((c) => c.name.toUpperCase() === name)?.id ?? ((await db.customers.add({ name, phone: patient.phone.trim() || undefined, balance: 0, creditLimit: 0, createdAt: Date.now() } as Customer)) as number)
    }
    if (received === 0 && customerId === undefined) {
      setTab('pay')
      throw new Error('PAYMENT DETAILS: enter what the patient paid (CASH, MPESA, CREDIT CARD or CHEQUE)')
    }
    if (received < bill && customerId === undefined) {
      setTab('pay')
      throw new Error(`Received ${amt(received)} is less than the Bill Amount ${amt(bill)}. Enter the rest, or name the patient (PATIENT INFORMATION) to put it on account.`)
    }
    const payments: Payment[] = []
    if (paid.cash > 0) payments.push({ method: 'cash', amount: paid.cash })
    if (paid.mpesa > 0) payments.push({ method: 'mpesa', amount: paid.mpesa, reference: refs.mpesa.trim().toUpperCase() })
    if (paid.card > 0) payments.push({ method: 'card', amount: paid.card, reference: refs.card.trim() || undefined })
    if (paid.cheque > 0) payments.push({ method: 'cheque', amount: paid.cheque, reference: refs.cheque.trim() })
    if (received < bill) payments.push({ method: 'account', amount: bill - received })
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
    const sale = await completeSale({ lines: saleLines, discount: 0, payments, customerId, userId: user!.id ?? 0, note: notes() })
    toast(`Bill ${billNo(sale, d.billPrefix)} issued${sale.change ? ` — change ${amt(sale.change)}` : ''}`)
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
    const method = (PAY_FIELDS.find(([k]) => paid[k] > 0)?.[0] ?? 'cash') as Payment['method']
    const bySale = new Map<number, Record<number, number>>()
    for (const { l, c } of filled) {
      const m = bySale.get(l.saleId!) ?? {}
      m[l.saleLine!] = (m[l.saleLine!] ?? 0) + c.qty
      bySale.set(l.saleId!, m)
    }
    let last: Sale | undefined
    for (const [saleId, qtyByLine] of bySale) {
      last = await refundSale(saleId, { qtyByLine, restock: true, method, userId: user!.id ?? 0, reason: notes() })
    }
    toast(`Return recorded — ${amt(filled.reduce((s, { c }) => s + c.amount, 0))} back to the patient (${method.toUpperCase()})`)
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

  const account = isReturn ? 'OTC MEDICINE RETURN' : 'OTC MEDICINE ISSUE'
  const W = { name: 140, form: 55, instr: 145, qty: 50, cost: 55, tcost: 70, price: 70, disc: 70, amt: 70, batch: 95, exp: 95 }
  const payLabelStyle: CSSProperties = { textAlign: 'right', paddingRight: 14 }
  const readOnlyPrice = isReturn
  const title = isReturn ? 'OTC Medicine Isse Return' : 'OTC Medicine Issue/Bill'
  const summary = useMemo(() => ({ bill, received, change }), [bill, received, change])

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <EntryHeader title={title} adjust={isReturn ? 'OTC Medicine Issue/Bill' : undefined} onAdjust={() => setAdjust(true)} onView={onClose} onRefresh={reset} />
      <SubTabs
        tabs={[
          { id: 'pay', label: 'PAYMENT DETAILS' },
          { id: 'detail', label: 'DETAIL' },
          { id: 'patient', label: 'PATIENT INFORMATION' },
        ]}
        value={tab}
        onChange={setTab}
      />
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
                  <Cell value={c2(bill)} width={W.amt} right readOnly label="SUM" />
                </td>
              </tr>
            </tbody>
          </table>
          <datalist id="ma-otc-products">
            {products.map((p) => (
              <option key={p.id} value={labelOf(p)} />
            ))}
          </datalist>
        </div>
      )}
      {tab === 'patient' && (
        <div style={{ ...panel, paddingTop: 30 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 300px', rowGap: 8 }}>
            <Field label="Patient Category">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 220 }} value={patient.name} list="ma-otc-patients" placeholder={`Blank = ${d.patientCategory}; or the patient's name`} onChange={(e) => setPatient({ ...patient, name: e.target.value.toUpperCase() })} aria-label="Patient" />
                <LookupBtn title="Look up a patient / customer" onClick={() => setPick({ kind: 'patient' })} />
              </span>
            </Field>
            <Field label="Phone">
              <Input value={patient.phone} onChange={(v) => setPatient({ ...patient, phone: v })} width={140} placeholder="e.g. 0712 345 678" />
            </Field>
            <Field label="Narration">
              <Input value={patient.narration} onChange={(v) => setPatient({ ...patient, narration: v })} width={260} placeholder={isReturn ? 'Why it is returned' : 'Note on the bill (optional)'} />
            </Field>
            <Field label="Location">
              <Input value={d.location} readOnly width={160} />
            </Field>
            <Field label="User Name">
              <Input value={user?.name.toUpperCase() ?? ''} readOnly width={160} />
            </Field>
          </div>
          <datalist id="ma-otc-patients">
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
          title="Medicine"
          options={[...products].sort((a, b) => a.name.localeCompare(b.name)).map(labelOf)}
          onClose={() => setPick(null)}
          onPick={(v) => {
            const p = products.find((x) => labelOf(x) === v)
            if (p) takeProduct(pick.key, p)
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'patient' && (
        <PickList
          title="Patient / Customer"
          options={customers.map((c) => c.name.toUpperCase())}
          onClose={() => setPick(null)}
          onPick={(v) => {
            const c = customers.find((x) => x.name.toUpperCase() === v)
            setPatient({ ...patient, name: v, phone: patient.phone || c?.phone || '' })
            setPick(null)
          }}
        />
      )}
      {adjust && <AdjustmentDialog sources={[{ value: 'otc-bill', label: 'OTC Bill' }]} load={() => loadBills()} onApply={(p, b) => void applyBills(p, b)} onClose={() => setAdjust(false)} />}
    </div>
  )
}
