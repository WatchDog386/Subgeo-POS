import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../db/db'
import { logActivity } from '../../db/logs'
import { chemCode } from '../../db/seedData'
import { api, syncNow, useSyncState } from '../../db/sync'
import type { Branch, Product } from '../../db/types'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { amt, dmy } from '../data'
import { Btn, Check, Grid, Input, Rows, SearchBar, Select, matches, type Col } from '../ui'
import { ColumnChart } from './reportKit'

interface BranchStats extends Branch {
  id: number
  code: string
  todaySales: number
  todayCount: number
  monthSales: number
  lastSale: number | null
  products: number
  stockValue: number
  lowStock: number
  outOfStock: number
  owing: number
  openShift: { by: string; at: number } | null
  staff: { id: number; name: string; username: string; role: string }[]
  lastActivity: number | null
  trend: number[]
}

const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })
const pad = (n: number) => String(n).padStart(2, '0')
const when = (ts: number | null) => (ts ? `${dmy(ts)} ${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}` : '-')

function Box({ title, children, width }: { title: string; children: React.ReactNode; width?: number | string }) {
  return (
    <div className="ma-group" style={{ position: 'relative', width, marginBottom: 12 }}>
      <div className="ma-group-head">{title}</div>
      <div style={{ padding: '10px 12px' }}>{children}</div>
    </div>
  )
}

/**
 * Admin: every chemist in one place — live sales and stock of each chemist,
 * create/close chemists, open a chemist to key in its stock, copy a medicine
 * list to a new chemist, and transfer stock between chemists.
 */
export default function ChemistsPage() {
  const { branches, branchId, switchBranch, user } = useSession()
  const toast = useToast()
  const nav = useNavigate()
  const sync = useSyncState()
  const [stats, setStats] = useState<BranchStats[] | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<number | undefined>(branchId)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date()
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const r = await api<{ branches: BranchStats[] }>(`/admin/overview?dayStart=${dayStart}&monthStart=${monthStart}`)
      setStats(r.branches)
      setStatsError(null)
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  // Figures for chemists the server hasn't reported yet (e.g. just created here).
  const rows: BranchStats[] = useMemo(
    () =>
      branches.map(
        (b) =>
          stats?.find((s) => s.id === b.id) ?? {
            ...(b as Branch & { id: number }),
            code: chemCode(b.number),
            todaySales: 0,
            todayCount: 0,
            monthSales: 0,
            lastSale: null,
            products: 0,
            stockValue: 0,
            lowStock: 0,
            outOfStock: 0,
            owing: 0,
            openShift: null,
            staff: [],
            lastActivity: null,
            trend: [0, 0, 0, 0, 0, 0, 0],
          },
      ),
    [branches, stats],
  )
  const total = (k: 'todaySales' | 'todayCount' | 'monthSales' | 'stockValue' | 'lowStock' | 'outOfStock' | 'owing' | 'products') =>
    rows.filter((r) => r.active).reduce((s, r) => s + (r[k] ?? 0), 0)
  const selected = rows.find((r) => r.id === sel)

  const open = async (id: number, to?: string) => {
    const r = await switchBranch(id)
    if (r.warning) toast(r.warning, 'error')
    else toast(`Now working in ${chemCode(branches.find((b) => b.id === id)?.number)}`)
    if (to) nav(to)
  }

  return (
    <div style={{ padding: '10px 14px', minWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="ma-title" style={{ position: 'static' }}>
          Chemists (Branches)
        </span>
        <Btn onClick={() => void syncNow().then(load)}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
        <span className="ma-label">
          {statsError
            ? `Live figures unavailable: ${statsError}. Showing chemists on this till.`
            : `Live from the company database · today ${dmy(Date.now())} · refreshes every 30 s`}
        </span>
        <span style={{ marginLeft: 'auto' }} className="ma-label">
          You are working in <b style={{ color: '#c00' }}>{chemCode(branches.find((b) => b.id === branchId)?.number)}</b>
        </span>
      </div>

      <Box title="All chemists — today, this month and stock">
        <Grid
          cols={[
            C('code', 'Chemist', 70),
            C('name', 'Name', 150),
            C('status', 'Status', 60),
            C('today', 'Today Sales', 95, 'right'),
            C('bills', 'Bills', 45, 'right'),
            C('month', 'Month Sales', 100, 'right'),
            C('stock', 'Stock Value', 100, 'right'),
            C('meds', 'Medicines', 70, 'right'),
            C('low', 'Low', 45, 'right'),
            C('out', 'Out', 45, 'right'),
            C('owing', 'Owing', 85, 'right'),
            C('shift', 'Shift', 120),
            C('staff', 'Cashiers', 130),
            C('last', 'Last Activity', 120),
          ]}
          rows={[
            ...rows.map((r) => ({
              id: r.id,
              cells: {
                code: <b style={{ color: r.id === branchId ? '#c00' : undefined }}>{r.code}</b>,
                name: r.name,
                status: r.active ? 'OPEN' : 'CLOSED',
                today: amt(r.todaySales),
                bills: r.todayCount,
                month: amt(r.monthSales),
                stock: amt(r.stockValue),
                meds: r.products,
                low: r.lowStock ? <b style={{ color: '#b45309' }}>{r.lowStock}</b> : 0,
                out: r.outOfStock ? <b style={{ color: '#c00' }}>{r.outOfStock}</b> : 0,
                owing: amt(r.owing),
                shift: r.openShift ? `Open · ${r.openShift.by}` : 'Closed',
                staff: r.staff.map((s) => s.username).join(', ') || '-',
                last: when(r.lastActivity),
              },
            })),
            {
              id: 'total',
              cells: {
                code: <b>TOTAL</b>,
                name: `${rows.filter((r) => r.active).length} open chemist(s)`,
                today: <b>{amt(total('todaySales'))}</b>,
                bills: <b>{total('todayCount')}</b>,
                month: <b>{amt(total('monthSales'))}</b>,
                stock: <b>{amt(total('stockValue'))}</b>,
                meds: <b>{total('products')}</b>,
                low: <b>{total('lowStock')}</b>,
                out: <b>{total('outOfStock')}</b>,
                owing: <b>{amt(total('owing'))}</b>,
              },
            },
          ]}
          height={Math.min(360, 60 + rows.length * 28)}
          selected={sel}
          onSelect={(id) => typeof id === 'number' && setSel(id)}
          onOpen={(id) => typeof id === 'number' && void open(id, '/home')}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="ma-label">Selected: {selected ? `${selected.code} - ${selected.name}` : 'click a chemist'}</span>
          <Btn disabled={!selected} onClick={() => selected && void open(selected.id, '/home')}>
            Open (work in this chemist)
          </Btn>
          <Btn disabled={!selected} onClick={() => selected && void open(selected.id, '/products')}>
            Key in Medicines / Stock
          </Btn>
          <Btn disabled={!selected} onClick={() => selected && void open(selected.id, '/purchasing')}>
            Receive Purchases
          </Btn>
          <Btn disabled={!selected} onClick={() => selected && void open(selected.id, '/reports/list/daily-sales')}>
            Daily Sales Report
          </Btn>
          <Btn disabled={!selected} onClick={() => selected && void open(selected.id, '/sales')}>
            Bills / Sales History
          </Btn>
          <Btn onClick={() => nav('/utilities/user-management')}>Cashiers (User Management)</Btn>
        </div>
      </Box>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ChemistForm branches={branches} selected={branches.find((b) => b.id === sel)} userName={user?.name} userId={user?.id} />
        <Box title="Sales — last 7 days (KES)" width={520}>
          {rows.length > 0 && rows.some((r) => r.trend.some((v) => v)) ? (
            <>
              <ColumnChart
                width={490}
                height={220}
                data={Array.from({ length: 7 }, (_, i) => ({
                  label: dmy(Date.now() - (6 - i) * 86_400_000).slice(0, 5),
                  values: rows.filter((r) => r.active).map((r) => r.trend[i] / 100),
                }))}
                colors={['#e07a12', '#9fbe4a', '#1a9be6', '#c9c39a', '#8e44ad', '#16a085', '#c0392b', '#2c3e50']}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11 }}>
                {rows
                  .filter((r) => r.active)
                  .map((r, i) => (
                    <span key={r.id}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, marginRight: 4, background: ['#e07a12', '#9fbe4a', '#1a9be6', '#c9c39a', '#8e44ad', '#16a085', '#c0392b', '#2c3e50'][i % 8] }} />
                      {r.code}
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <div className="ma-label">{sync.status === 'off' ? 'Connect to the server to see live sales.' : 'No sales in the last 7 days yet.'}</div>
          )}
        </Box>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <CopyCatalogue branches={branches} onDone={load} />
        <TransferStock branches={branches} onDone={load} />
      </div>
    </div>
  )
}

/* ── Create / edit a chemist ─────────────────────────────────────────────── */
function ChemistForm({ branches, selected, userName, userId }: { branches: Branch[]; selected?: Branch; userName?: string; userId?: number }) {
  const toast = useToast()
  const nextNo = Math.max(0, ...branches.map((b) => b.number)) + 1
  const [editId, setEditId] = useState<number>()
  const [no, setNo] = useState(String(nextNo))
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [phone, setPhone] = useState('')
  const [active, setActive] = useState(true)

  const reset = () => {
    setEditId(undefined)
    setNo(String(Math.max(0, ...branches.map((b) => b.number)) + 1))
    setName('')
    setLocation('')
    setPhone('')
    setActive(true)
  }
  useEffect(() => {
    if (editId === undefined) setNo(String(nextNo))
  }, [nextNo, editId])

  const edit = () => {
    if (!selected) return toast('Click a chemist in the list first', 'error')
    setEditId(selected.id)
    setNo(String(selected.number))
    setName(selected.name)
    setLocation(selected.location ?? '')
    setPhone(selected.phone ?? '')
    setActive(selected.active)
  }

  const save = async () => {
    try {
      const n = Number(no)
      if (!Number.isInteger(n) || n < 1) throw new Error('Chemist No. must be a whole number from 1')
      if (!name.trim()) throw new Error('Enter the chemist name')
      if (branches.some((b) => b.number === n && b.id !== editId)) throw new Error(`${chemCode(n)} already exists`)
      if (editId !== undefined) {
        const cur = branches.find((b) => b.id === editId)!
        if (cur.active && !active) {
          const staff = await db.users.where('branchId').equals(editId).filter((u) => u.active).count()
          if (staff && !confirm(`Close ${chemCode(cur.number)}? Its ${staff} active cashier(s) will not be able to sign in.`)) return
        }
        await db.branches.update(editId, { number: n, name: name.trim().toUpperCase(), location: location.trim(), phone: phone.trim(), active })
        await logActivity('settings', `Chemist ${chemCode(n)} updated`, { detail: `${name.trim().toUpperCase()}${active ? '' : ' · closed'}`, userId, userName })
        toast(`${chemCode(n)} saved`)
      } else {
        await db.branches.add({ number: n, name: name.trim().toUpperCase(), location: location.trim(), phone: phone.trim(), active, createdAt: Date.now() })
        await logActivity('settings', `Chemist ${chemCode(n)} created`, { detail: name.trim().toUpperCase(), userId, userName })
        toast(`${chemCode(n)} created. Next: add its cashier in User Management, then key in its medicines.`)
      }
      reset()
      void syncNow()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Box title={editId !== undefined ? `Edit ${chemCode(Number(no))}` : 'Create a new chemist'} width={470}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Btn onClick={reset}>New Chemist</Btn>
        <Btn onClick={edit}>Edit Selected</Btn>
      </div>
      <div className="ma-form" style={{ gridTemplateColumns: '120px 230px' }}>
        <span className="ma-label ma-bold-label">Chemist No.</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input value={no} onChange={(v) => setNo(v.replace(/\D/g, ''))} width={60} />
          <b style={{ color: '#c00' }}>{chemCode(Number(no) || undefined)}</b>
        </span>
        <span className="ma-label ma-bold-label">Name</span>
        <Input value={name} onChange={setName} width={228} placeholder="e.g. SCL KAYOLE" />
        <span className="ma-label ma-bold-label">Location</span>
        <Input value={location} onChange={setLocation} width={228} />
        <span className="ma-label ma-bold-label">Phone</span>
        <Input value={phone} onChange={setPhone} width={228} />
        <span className="ma-label ma-bold-label">Status</span>
        <Check checked={active} onChange={setActive}>
          Open (cashiers can sign in)
        </Check>
        <span />
        <div style={{ marginTop: 6 }}>
          <Btn onClick={save}>{editId !== undefined ? 'Save Changes' : 'Create Chemist'}</Btn>
        </div>
      </div>
      <div className="ma-label" style={{ marginTop: 8 }}>
        Each chemist keeps its own medicines, stock, sales, customers and shifts. Cashiers are tied to one chemist and see only its stock.
      </div>
    </Box>
  )
}

/* ── Copy a medicine list ────────────────────────────────────────────────── */
function CopyCatalogue({ branches, onDone }: { branches: Branch[]; onDone: () => void }) {
  const toast = useToast()
  const opts = branches.map((b) => ({ value: String(b.id), label: `${chemCode(b.number)} - ${b.name}` }))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!from || !to || from === to) return toast('Pick two different chemists', 'error')
    const a = branches.find((b) => String(b.id) === from)
    const z = branches.find((b) => String(b.id) === to)
    if (!confirm(`Copy every medicine of ${chemCode(a?.number)} into ${chemCode(z?.number)}? Prices are copied, stock starts at 0, medicines it already has (same code) are skipped.`)) return
    setBusy(true)
    try {
      const r = await api<{ added: number }>('/admin/copy-catalogue', { method: 'POST', body: JSON.stringify({ from: Number(from), to: Number(to) }) })
      toast(`${r.added} medicine(s) copied to ${chemCode(z?.number)}`)
      await syncNow()
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box title="Copy medicine list to a chemist" width={470}>
      <div className="ma-form" style={{ gridTemplateColumns: '120px 230px' }}>
        <span className="ma-label ma-bold-label">From</span>
        <Select value={from} onChange={setFrom} options={[{ value: '', label: 'SELECT' }, ...opts]} width={228} />
        <span className="ma-label ma-bold-label">To</span>
        <Select value={to} onChange={setTo} options={[{ value: '', label: 'SELECT' }, ...opts]} width={228} />
        <span />
        <Btn onClick={run} disabled={busy}>
          {busy ? 'Copying…' : 'Copy Medicine List'}
        </Btn>
      </div>
      <div className="ma-label" style={{ marginTop: 8 }}>
        Quickest way to set up a new chemist: copy the list, then receive its opening stock (Medicines → Adjust stock, or Purchases).
      </div>
    </Box>
  )
}

/* ── Transfer stock between chemists ─────────────────────────────────────── */
function TransferStock({ branches, onDone }: { branches: Branch[]; onDone: () => void }) {
  const toast = useToast()
  const opts = branches.map((b) => ({ value: String(b.id), label: `${chemCode(b.number)} - ${b.name}` }))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [products, setProducts] = useState<(Product & { id: number })[]>([])
  const [q, setQ] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setQty({})
    setProducts([])
    if (!from) return
    let cancelled = false
    api<(Product & { id: number })[]>(`/admin/products?branch=${from}`)
      .then((list) => !cancelled && setProducts(list.filter((p) => p.active && p.trackStock)))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
    return () => {
      cancelled = true
    }
  }, [from, toast])

  const items = Object.entries(qty)
    .map(([id, v]) => ({ productId: Number(id), qty: parseInt(v, 10) || 0 }))
    .filter((i) => i.qty > 0)
  const shown = products.filter((p) => matches(q, p.name, p.sku, p.barcode))

  const run = async () => {
    if (!from || !to || from === to) return toast('Pick two different chemists', 'error')
    if (items.length === 0) return toast('Enter a quantity for at least one medicine', 'error')
    for (const i of items) {
      const p = products.find((x) => x.id === i.productId)
      if (p && i.qty > p.stock) return toast(`${p.name}: only ${p.stock} in stock`, 'error')
    }
    setBusy(true)
    try {
      const r = await api<{ reference: string }>('/admin/transfer', { method: 'POST', body: JSON.stringify({ from: Number(from), to: Number(to), items }) })
      toast(`Transferred ${items.length} medicine(s) · ${r.reference}`)
      setQty({})
      const list = await api<(Product & { id: number })[]>(`/admin/products?branch=${from}`)
      setProducts(list.filter((p) => p.active && p.trackStock))
      await syncNow()
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box title="Transfer stock between chemists" width={520}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="ma-label ma-bold-label">From</span>
        <Select value={from} onChange={setFrom} options={[{ value: '', label: 'SELECT' }, ...opts]} width={170} />
        <span className="ma-label ma-bold-label">To</span>
        <Select value={to} onChange={setTo} options={[{ value: '', label: 'SELECT' }, ...opts]} width={170} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0 3px' }}>
        <SearchBar value={q} onChange={setQ} width={260} />
        <span style={{ marginLeft: 'auto' }}>
          <Rows n={shown.length} />
        </span>
      </div>
      <Grid
        cols={[C('name', 'Medicine', 220), C('code', 'Code', 90), C('stock', 'In Stock', 60, 'right'), C('qty', 'Transfer Qty', 80)]}
        rows={shown.slice(0, 300).map((p) => ({
          id: p.id,
          cells: {
            name: p.name,
            code: p.sku,
            stock: p.stock,
            qty: (
              <input
                className="ma-input"
                style={{ width: 70, height: 20 }}
                inputMode="numeric"
                value={qty[p.id] ?? ''}
                onChange={(e) => setQty({ ...qty, [p.id]: e.target.value.replace(/\D/g, '') })}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          },
        }))}
        height={220}
        compact
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <span className="ma-label">{items.length} medicine(s) selected</span>
        <Btn onClick={run} disabled={busy || items.length === 0}>
          {busy ? 'Transferring…' : 'Transfer Stock'}
        </Btn>
      </div>
      <div className="ma-label" style={{ marginTop: 6 }}>
        Stock leaves the first chemist and arrives at the second at once; both stock ledgers show the transfer. A medicine the receiving chemist lacks is created there.
      </div>
    </Box>
  )
}
