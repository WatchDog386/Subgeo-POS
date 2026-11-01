// Medicine Prices (Best Price) — admin / purchase only.
// One table of the open chemist's medicines where the Selling Price, the Best
// Price (the lowest it may be sold for) and the Whole Sale Price are typed in
// place. The seller offers the Selling Price first; if the customer complains
// they may come down to the Best Price, never below (enforced on every sale).
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { DocRecord, Product } from '../../db/types'
import { toCents } from '../../lib/money'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { chemCode } from '../../db/seedData'
import { saveDoc } from '../data'
import { Btn, Check, SearchBar } from '../ui'
import { c2, head, useEntryKeys } from './EntryScreens'
import { medicineDocFor } from './MedicineScreen'

type Edit = { price?: string; best?: string; whole?: string }
type Row = { p: Product; doc?: DocRecord; price: string; best: string; whole: string; dirty: boolean; error?: string; warn?: string }

const AMOUNT = /^\d+(\.\d{0,2})?$/

/** Check one row; returns cents, or the reason it can't be saved. */
export function checkPrices(price: string, best: string, whole: string, cost: number): { error?: string; warn?: string; cents?: { price: number; best?: number; whole: number } } {
  const t = { price: price.trim(), best: best.trim(), whole: whole.trim() }
  if (!t.price || !AMOUNT.test(t.price) || toCents(t.price) <= 0) return { error: 'Selling Price must be an amount above 0' }
  if (t.best && !AMOUNT.test(t.best)) return { error: 'Best Price must be an amount in KES (not %)' }
  if (t.whole && !AMOUNT.test(t.whole)) return { error: 'Whole Sale Price must be an amount' }
  const cents = { price: toCents(t.price), best: t.best ? toCents(t.best) : undefined, whole: t.whole ? toCents(t.whole) : toCents(t.price) }
  if (cents.best !== undefined && cents.best <= 0) return { error: 'Best Price must be above 0 (leave it blank for none)' }
  if (cents.best !== undefined && cents.best > cents.price) return { error: `Best Price is above the Selling Price ${c2(cents.price)}` }
  if (cents.best !== undefined && cents.whole < cents.best) return { error: `Whole Sale Price is below the Best Price ${c2(cents.best)}` }
  const low = cents.best ?? cents.price
  return { cents, warn: cost > 0 && low < cost ? `${cents.best !== undefined ? 'Best' : 'Selling'} Price is below the cost ${c2(cost)}` : undefined }
}

export default function PriceTable() {
  const toast = useToast()
  const { user, branch } = useSession()
  const products = useLiveQuery(async () => (await db.products.filter((p) => !/^SRV-/i.test(p.sku)).toArray()).sort((a, b) => a.name.localeCompare(b.name)), [], undefined)
  const docs = useLiveQuery(() => db.docs.where('slug').equals('medicine').toArray(), [], [] as DocRecord[])
  const [edits, setEdits] = useState<Map<number, Edit>>(new Map())
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [saving, setSaving] = useState(false)

  const rows: Row[] = useMemo(() => {
    return (products ?? []).map((p) => {
      const doc = medicineDocFor(p, docs)
      const base = { price: c2(p.price), best: p.minPrice ? c2(p.minPrice) : '', whole: doc?.values.whole || c2(p.price) }
      const e = edits.get(p.id!) ?? {}
      const cur = { price: e.price ?? base.price, best: e.best ?? base.best, whole: e.whole ?? base.whole }
      const dirty = cur.price !== base.price || cur.best !== base.best || cur.whole !== base.whole
      const chk = checkPrices(cur.price, cur.best, cur.whole, p.cost)
      return { p, doc, ...cur, dirty, error: chk.error, warn: chk.warn }
    })
  }, [products, docs, edits])

  const shown = rows.filter((r) => {
    const t = q.trim().toUpperCase()
    if (t && !`${r.p.name} ${r.p.sku}`.toUpperCase().includes(t)) return false
    if (onlyMissing && r.best.trim()) return false
    if (onlyChanged && !r.dirty) return false
    return true
  })
  const changed = rows.filter((r) => r.dirty)
  const invalid = changed.filter((r) => r.error)
  const missing = rows.filter((r) => !r.best.trim()).length

  const edit = (id: number, patch: Edit) =>
    setEdits((m) => {
      const n = new Map(m)
      n.set(id, { ...(n.get(id) ?? {}), ...patch })
      return n
    })

  const save = async () => {
    if (saving || !user) return
    if (!changed.length) return toast('Nothing changed')
    if (invalid.length) {
      setOnlyChanged(true)
      return toast(`${invalid[0].p.name}: ${invalid[0].error}${invalid.length > 1 ? ` (and ${invalid.length - 1} more)` : ''}`, 'error')
    }
    setSaving(true)
    try {
      await db.transaction('rw', [db.products, db.docs], async () => {
        const now = Date.now()
        for (const r of changed) {
          const c = checkPrices(r.price, r.best, r.whole, r.p.cost).cents!
          await db.products.update(r.p.id!, { price: c.price, minPrice: c.best, updatedAt: now })
          // Keep the Medicine-form record (UOM, whole sale…) in step.
          const values: Record<string, string> = r.doc
            ? { ...r.doc.values, retail: c2(c.price), whole: c2(c.whole), minPrice: c.best !== undefined ? c2(c.best) : '' }
            : { docNo: r.p.sku, name: r.p.name.toUpperCase(), retail: c2(c.price), whole: c2(c.whole), cost: c2(r.p.cost), minPrice: c.best !== undefined ? c2(c.best) : '', type: r.p.trackStock ? 'S' : 'N' }
          await saveDoc('medicine', values, r.doc?.id, user.id)
        }
      })
      toast(`${changed.length} medicine price(s) saved — every till of this chemist uses them after its next sync`)
      setEdits(new Map())
      setOnlyChanged(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const discard = () => {
    if (changed.length && !confirm(`Discard ${changed.length} unsaved change(s)?`)) return
    setEdits(new Map())
    setOnlyChanged(false)
  }
  useEntryKeys({ save: () => void save(), back: discard })

  const W = { sno: 34, code: 110, name: 270, cost: 75, stock: 60, price: 90 }
  const cell = (r: Row, k: 'price' | 'best' | 'whole', label: string) => (
    <input
      className="ma-input"
      style={{ width: W.price, textAlign: 'right', background: k === 'best' ? '#fff8d6' : undefined, borderColor: r.error && r.dirty ? '#e57373' : undefined }}
      value={r[k]}
      placeholder={k === 'best' ? 'lowest' : ''}
      aria-label={`${label} ${r.p.name}`}
      onChange={(e) => edit(r.p.id!, { [k]: e.target.value })}
    />
  )
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px 10px', minHeight: 32 }}>
        <span className="ma-title">Medicine Prices (Best Price){branch ? ` — ${chemCode(branch.number)}` : ''}</span>
        <span style={{ marginLeft: 'auto' }} />
        <Btn onClick={discard} disabled={!changed.length}>
          Discard
        </Btn>
        <Btn onClick={() => void save()} disabled={saving || !changed.length}>
          {saving ? 'Saving…' : `Save Changes (F2)${changed.length ? ` · ${changed.length}` : ''}`}
        </Btn>
      </div>
      <div className="ma-label ma-note" style={{ margin: '0 0 10px 10px', fontSize: 11, maxWidth: 900 }}>
        <b>Selling Price</b> is offered first. <b>Best Price</b> is the lowest a medicine may be sold for (an amount in KES, not %): if the customer complains, the seller may come down to it, never below — the tills refuse any bill, discount or
        wholesale invoice below it. Blank = no best price. Pick the chemist in the header to edit another chemist&apos;s prices.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '0 0 6px 10px' }}>
        <SearchBar value={q} onChange={setQ} width={260} />
        <Check checked={onlyMissing} onChange={setOnlyMissing} dark>
          Only without Best Price ({missing})
        </Check>
        <Check checked={onlyChanged} onChange={setOnlyChanged} dark>
          Only changed ({changed.length})
        </Check>
        <span className="ma-rows" style={{ marginLeft: 'auto' }}>
          | {shown.length} of {rows.length} medicines |
        </span>
      </div>
      <div className="ma-grid" style={{ maxHeight: 'calc(100vh - 290px)', minHeight: 240, overflow: 'auto', padding: '0 4px' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '6px 3px' }}>
          <thead>
            <tr>
              {[['S NO', W.sno], ['Product Code', W.code], ['Medicine Name', W.name], ['Cost Rate', W.cost], ['In Stock', W.stock], ['Selling Price', W.price], ['Best Price', W.price], ['Whole Sale Price', W.price], ['', 260]].map(([h, w]) => (
                <th key={String(h) || 'x'} style={{ ...head, width: w as number, position: 'sticky', top: 0, background: '#f0f0f0', zIndex: 1, textAlign: typeof w === 'number' && ['Cost Rate', 'In Stock', 'Selling Price', 'Best Price', 'Whole Sale Price'].includes(String(h)) ? 'right' : 'left' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products === undefined && (
              <tr>
                <td colSpan={9} className="ma-label">
                  Loading…
                </td>
              </tr>
            )}
            {products !== undefined && !shown.length && (
              <tr>
                <td colSpan={9} className="ma-label" style={{ padding: 10 }}>
                  {rows.length ? 'No medicine matches.' : 'This chemist has no medicines yet — receive stock first (Pur/GRN or Medicine +).'}
                </td>
              </tr>
            )}
            {shown.map((r, i) => (
              <tr key={r.p.id} style={{ background: r.dirty ? '#fffbe6' : undefined }}>
                <td style={{ fontSize: 11 }}>{i + 1}</td>
                <td style={{ fontSize: 11 }}>{r.p.sku}</td>
                <td style={{ fontSize: 11, maxWidth: W.name, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.p.name}>
                  {r.p.name.toUpperCase()}
                </td>
                <td style={{ fontSize: 11, textAlign: 'right' }}>{c2(r.p.cost)}</td>
                <td style={{ fontSize: 11, textAlign: 'right' }}>{r.p.trackStock ? r.p.stock : '-'}</td>
                <td>{cell(r, 'price', 'Selling Price')}</td>
                <td>{cell(r, 'best', 'Best Price')}</td>
                <td>{cell(r, 'whole', 'Whole Sale Price')}</td>
                <td style={{ fontSize: 10, color: r.error ? '#c62828' : '#b26a00', whiteSpace: 'nowrap' }}>{r.error ? `✖ ${r.error}` : r.warn ? `⚠ ${r.warn}` : r.dirty ? 'changed — press Save' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
