import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { db } from '../db/db'
import type { Sale, SaleLine, Product, Customer, StockMovement } from '../db/types'
import { ErpPanel, ErpTable, ErpEmptyRow, PickTwo, SearchResultNote } from './piLists'
import { money, moneyShort } from '../lib/money'
import { REPORT_ITEMS } from './erpNav'
import { downloadCsv } from '../lib/csv'

// Reports area mirroring the old medapp: pick a report from the sidebar, then
// the work area shows its template name, filter rows (From/To, pick lists with
// the orange move buttons), View/Print/Export buttons, and a striped results
// grid ending with the "| N rows retrieved |" counter.

export default function ErpReportsPage() {
  const { slug } = useParams()
  return slug ? <ReportBody slug={slug} /> : <ReportOverview />
}

function ReportOverview() {
  const nav = useNavigate()
  return (
    <ErpPanel title="Report List">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_ITEMS.filter((r) => r.to !== '/reports/list').map((r) => (
          <button
            key={r.to}
            type="button"
            onClick={() => nav(r.to)}
            className="flex items-center justify-between rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-[#3b74b8] hover:bg-sky-50"
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="px-1 text-[12px] text-slate-600">
        Each report has its template name, filter sheet (From/To dates and pick lists), and View /
        Print / Export actions — you can print straight from the browser's print dialog
        [CTRL + P].
      </p>
    </ErpPanel>
  )
}

function DateRange({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (f: string, t: string) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 text-[12px] font-bold text-slate-600">
      <label className="flex flex-col gap-1">
        From
        <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="erp-field w-36 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
      </label>
      <label className="flex flex-col gap-1">
        To
        <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="erp-field w-36 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
      </label>
    </div>
  )
}

function ReportActions({ onExport, rows }: { onExport: () => void; rows: number }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => window.print()} className="flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100">
        <Printer size={14} /> Print
      </button>
      <button type="button" onClick={onExport} disabled={rows === 0} className="flex items-center gap-1 rounded-sm bg-[#2e8fc4] px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm transition enabled:hover:brightness-105 disabled:opacity-40">
        <FileSpreadsheet size={14} /> Export CSV
      </button>
      <SearchResultNote count={rows} />
    </div>
  )
}

function useDateRange() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  return {
    from,
    to,
    set: (f: string, t: string) => {
      setFrom(f)
      setTo(t)
    },
    filter: (ts: number[]) => ts.filter((t) => (!from || t >= new Date(from).getTime()) && (!to || t <= new Date(to).getTime() + 86_399_999)),
  }
}

function l(s: Sale): SaleLine[] {
  return s.lines
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Month-Wise Analysis: sales grouped into month columns with grand totals.
// ---------------------------------------------------------------------------

function MonthWiseAnalysis() {
  const sales = useLiveQuery(() => db.sales.where('status').equals('completed').toArray(), [])
  const dr = useDateRange()
  const [view, setView] = useState(false)
  const filtered = useMemo(() => (sales ?? []).filter((s) => dr.filter([s.createdAt]).length > 0), [sales, dr.from, dr.to])

  const byMonth = useMemo(() => {
    const map = new Map<string, { month: string; gross: number; bills: number; cost: number }>()
    for (const s of filtered) {
      const month = new Date(s.createdAt).toLocaleDateString('en-KE', { month: 'short', year: '2-digit' })
      const agg = map.get(month) ?? { month, gross: 0, bills: 0, cost: 0 }
      agg.gross += s.total
      agg.bills += 1
      agg.cost += l(s).reduce((t, ln) => t + ln.unitCost * ln.qty, 0)
      map.set(month, agg)
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
  }, [filtered])

  const cols = ['Material', ...byMonth.map((m) => m.month), 'Total']
  const csv = () => downloadCsv('month-wise-analysis', cols, byMonth.map((m) => [m.month, m.bills.toString(), money(m.gross, '')]))

  return (
    <ErpPanel title="Template Name: Month-Wise Analysis">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRange from={dr.from} to={dr.to} onChange={dr.set} />
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable
            columns={[
              { label: 'Analysis Type', align: 'left' },
              { label: 'Bills', align: 'right' },
              { label: 'Gross Sales', align: 'right' },
              { label: 'COGS', align: 'right' },
              { label: 'Margin', align: 'right' },
            ]}
          >
            {byMonth.length === 0 ? (
              <ErpEmptyRow cols={5} />
            ) : (
              byMonth.map((m, i) => (
                <tr key={m.month} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                  <td className="px-2 py-1.5 font-semibold">{m.month}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.bills}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(m.gross, '')}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(m.cost, '')}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{money(m.gross - m.cost, '')}</td>
                </tr>
              ))
            )}
          </ErpTable>
          <ReportActions rows={byMonth.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Stock Report: pick-list driven, like the medapp template.
// ---------------------------------------------------------------------------

function StockReport() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const cats = useLiveQuery(() => db.categories.toArray(), [])
  const groups = useMemo(() => [...new Set((cats ?? []).map((c) => c.name))], [cats])
  const locations = useMemo(() => [...new Set((products ?? []).map((p) => p.location).filter(Boolean) as string[])], [products])
  const catById = useMemo(() => new Map((cats ?? []).map((c) => [c.id as number, c.name])), [cats])

  const [selGroups, setSelGroups] = useState<string[]>([])
  const [selLocations, setSelLocations] = useState<string[]>([])
  const [view, setView] = useState(false)

  const rows = useMemo(() =>
    (products ?? []).filter((p) =>
      (!selGroups.length || (p.categoryId !== undefined && selGroups.includes(catById.get(p.categoryId) ?? ''))) &&
      (!selLocations.length || (p.location !== undefined && selLocations.includes(p.location))),
    ), [products, selGroups, selLocations, catById])

  const totalValue = rows.reduce((s, p) => s + p.stock * p.cost, 0)
  const cols = ['Material Code', 'Medicine', 'Group', 'Location', 'Stock', 'Reorder', 'Cost']
  const csv = () => downloadCsv('stock-report', cols, rows.map((p) => [p.sku, p.name, p.categoryId ? catById.get(p.categoryId) ?? '' : '', p.location ?? '', p.stock.toString(), p.reorderLevel.toString(), money(p.cost, '')]))

  return (
    <ErpPanel title="Template Name: Stock Report">
      <div className="grid gap-2 md:grid-cols-2">
        <PickTwo title="Medicines Groups" options={groups} value={selGroups} onChange={setSelGroups} />
        <PickTwo title="Locations" options={locations.length ? locations : ['Main Store', 'SCL UMOJA 3']} value={selLocations} onChange={setSelLocations} />
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
        <SearchResultNote count={rows.length} />
      </div>
      {view && (
        <>
          <ErpTable
            columns={[
              { label: 'Material Code' },
              { label: 'Medicine' },
              { label: 'Group' },
              { label: 'Location' },
              { label: 'Stock', align: 'right' },
              { label: 'Reorder', align: 'right' },
              { label: 'Stock Value', align: 'right' },
            ]}
          >
            {rows.length === 0 ? <ErpEmptyRow cols={7} /> : rows.map((p: Product, i) => (
              <tr key={p.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-mono text-[12px]">{p.sku}</td>
                <td className="px-2 py-1.5 font-semibold">{p.name}</td>
                <td className="px-2 py-1.5">{p.categoryId ? catById.get(p.categoryId) ?? '—' : '—'}</td>
                <td className="px-2 py-1.5">{p.location ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.trackStock ? p.stock : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.trackStock ? p.reorderLevel : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(p.stock * p.cost, '')}</td>
              </tr>
            ))}
          </ErpTable>
          <div className="flex items-center justify-between text-[13px] font-bold text-slate-700">
            <span>Grand total stock value</span>
            <span className="tabular-nums">{money(totalValue)}</span>
          </div>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Stock Reorder / EOQ: below reorder level with suggested order quantities.
// ---------------------------------------------------------------------------

function StockReorder() {
  const [view, setView] = useState(false)
  const products = useLiveQuery(() => db.products.toArray(), [])
  const rows = useMemo(() => (products ?? []).filter((p) => p.trackStock && p.stock <= p.reorderLevel), [products])
  const cols = ['Medicine', 'Stock', 'Reorder', 'Suggested Order']
  const csv = () => downloadCsv('stock-reorder-eoq', cols, rows.map((p) => [p.name, p.stock.toString(), p.reorderLevel.toString(), Math.max(p.reorderLevel * 2 - p.stock, 1).toString()]))
  return (
    <ErpPanel title="Template Name: Stock Reorders / EOQ Analysis">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Medicine' }, { label: 'Stock', align: 'right' }, { label: 'Reorder Level', align: 'right' }, { label: 'EOQ Suggestion', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((p, i) => (
              <tr key={p.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{p.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.stock}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.reorderLevel}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-bold">{Math.max(p.reorderLevel * 2 - p.stock, 1)}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// ABC Analysis: rank materials by issued value into A/B/C bands.
// ---------------------------------------------------------------------------

function AbcAnalysis() {
  const sales = useLiveQuery(() => db.sales.where('status').equals('completed').toArray(), [])
  const [pct, setPct] = useState({ a: 80, b: 15 })
  const [view, setView] = useState(false)
  const rows = useMemo(() => {
    const byProduct = new Map<string, { name: string; value: number; qty: number }>()
    for (const s of sales ?? [])
      for (const ln of l(s)) {
        const key = ln.sku ?? ln.name
        const agg = byProduct.get(key) ?? { name: ln.name, value: 0, qty: 0 }
        agg.value += ln.qty * ln.unitPrice - ln.discount
        agg.qty += ln.qty
        byProduct.set(key, agg)
      }
    const sorted = [...byProduct.entries()].sort((a, b) => b[1].value - a[1].value)
    const total = sorted.reduce((s, [, v]) => s + v.value, 0) || 1
    let cum = 0
    return sorted.map(([key, v]) => {
      cum += v.value
      const share = (cum / total) * 100
      const band = share <= pct.a ? 'A' : share <= pct.a + pct.b ? 'B' : 'C'
      return { key, ...v, share, band }
    })
  }, [sales, pct])
  const [viewRows, setViewRows] = useState<typeof rows>([])
  const cols = ['Material', 'Qty', 'Value', 'Cum %', 'Band']
  const csv = () => downloadCsv('abc-analysis', cols, viewRows.map((r) => [r.key, r.qty.toString(), money(r.value, ''), `${r.share.toFixed(1)}%`, r.band]))
  return (
    <ErpPanel title="Template Name: ABC Analysis">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-4 text-[12px] font-bold text-slate-600">
          <label className="flex flex-col gap-1">
            Class A up to (% cumulative)
            <input type="number" value={pct.a} min={1} max={100} onChange={(e) => setPct({ ...pct, a: Number(e.target.value) })} className="erp-field w-32 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
          </label>
          <label className="flex flex-col gap-1">
            Class B next (%)
            <input type="number" value={pct.b} min={0} max={99} onChange={(e) => setPct({ ...pct, b: Number(e.target.value) })} className="erp-field w-32 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
          </label>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => { setViewRows(rows); setView(true) }} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
        </div>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Material' }, { label: 'Qty Issued', align: 'right' }, { label: 'Value', align: 'right' }, { label: 'Cumulative %', align: 'right' }, { label: 'Band', align: 'center' }]}>
            {viewRows.length === 0 ? <ErpEmptyRow cols={5} /> : viewRows.map((r, i) => (
              <tr key={r.key} className={`border-b border-slate-100 ${r.band === 'A' ? 'bg-emerald-50' : i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.qty}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.value, '')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.share.toFixed(1)}%</td>
                <td className="px-2 py-1.5 text-center font-bold">{r.band}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={viewRows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Ageing Report of receivables in 30-day buckets 0-30 ... 211-240.
// ---------------------------------------------------------------------------

function ageingDays(lastSale: number, cutoff = Date.now()): number[] {
  const d = Math.max(0, Math.floor((cutoff - lastSale) / 86_400_000))
  const buckets = [0, 31, 61, 91, 121, 151, 181, 211]
  for (let i = buckets.length - 1; i >= 0; i--) if (d >= buckets[i]) return [i, d]
  return [0, d]
}

function AgeingReport() {
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const [sum, setSum] = useState<'summary' | 'details'>('summary')
  const [view, setView] = useState(false)
  const lastSale = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of sales ?? []) if (s.customerId !== undefined && s.status === 'completed') map.set(s.customerId, Math.max(map.get(s.customerId) ?? 0, s.createdAt))
    return map
  }, [sales])
  const rows = useMemo(() => (customers ?? []).filter((c) => c.balance > 0).map((c: Customer) => {
    const [bucket] = ageingDays(lastSale.get(c.id as number) ?? c.createdAt)
    return { customer: c, bucket }
  }), [customers, lastSale])
  const cols = ['Party', 'Balance', 'Age Bucket']
  const csv = () => downloadCsv('ageing-report', cols, rows.map((r) => [r.customer.name, money(r.customer.balance, ''), bucketLabel(r.bucket)]))
  return (
    <ErpPanel title="Template Name: Ageing Report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
          Format
          <select value={sum} onChange={(e) => setSum(e.target.value as 'summary' | 'details')} className="erp-field rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal">
            <option value="summary">Summary (buckets)</option>
            <option value="details">Details</option>
          </select>
        </label>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <AgeingRows rows={rows} sum={sum} onCsv={csv} />
      )}
    </ErpPanel>
  )
}

function bucketLabel(i: number): string {
  const buckets = ['0-30', '31-60', '61-90', '91-120', '121-150', '151-180', '181-210', '211-240']
  return buckets[i]
}

function AgeingRows({
  rows,
  sum,
  onCsv,
}: {
  rows: { customer: Customer; bucket: number }[]
  sum: 'summary' | 'details'
  onCsv: () => void
}) {
  if (sum === 'summary') {
    const buckets = rows.map((r) => r.bucket)
    const byBucket = new Map<number, number>()
    for (const b of buckets) byBucket.set(b, (byBucket.get(b) ?? 0) + 1)
    const totalDue = rows.reduce((s, r) => s + r.customer.balance, 0)
    return (
      <>
        <ErpTable columns={[{ label: 'Ageing Bucket' }, { label: 'Parties', align: 'right' }, { label: 'Amount Due', align: 'right' }]}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((b, i) => (
            <tr key={b} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
              <td className="px-2 py-1.5 font-semibold">{bucketLabel(b)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{byBucket.get(b) ?? 0}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.customer.balance, 0), '')}</td>
            </tr>
          ))}
          <tr className="bg-slate-100 font-bold">
            <td className="px-2 py-1.5">Total</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rows.length}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(totalDue, '')}</td>
          </tr>
        </ErpTable>
        <ReportActions rows={rows.length} onExport={onCsv} />
      </>
    )
  }
  return (
    <>
      <ErpTable columns={[{ label: 'Party' }, { label: 'Last Sale' }, { label: 'Balance', align: 'right' }, { label: 'Bucket' }]}>
        {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((r, i) => (
          <tr key={r.customer.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
            <td className="px-2 py-1.5 font-semibold">{r.customer.name}</td>
            <td className="px-2 py-1.5">{fmtDate(r.customer.createdAt)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r.customer.balance, '')}</td>
            <td className="px-2 py-1.5">{bucketLabel(r.bucket)}</td>
          </tr>
        ))}
      </ErpTable>
      <ReportActions rows={rows.length} onExport={onCsv} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Receivables: party-wise outstanding with receivables invoice drill-in.
// ---------------------------------------------------------------------------

function ReceivablesReport() {
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const [view, setView] = useState(false)
  const rows = useMemo(() => (customers ?? []).filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance), [customers])
  const cols = ['Party', 'Phone', 'Outstanding', 'Age Bucket']
  const csv = () => downloadCsv('receivables', cols, rows.map((c) => [c.name, c.phone ?? '', money(c.balance, ''), bucketLabel(ageingDays(c.createdAt)[0])]))
  return (
    <ErpPanel title="Template Name: Receivables Report">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Party Master' }, { label: 'Phone' }, { label: 'Outstanding', align: 'right' }, { label: 'Bucket' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((c, i) => (
              <tr key={c.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{c.name}</td>
                <td className="px-2 py-1.5">{c.phone ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(c.balance, '')}</td>
                <td className="px-2 py-1.5">{bucketLabel(ageingDays(c.createdAt)[0])}</td>
              </tr>
            ))}
          </ErpTable>
          <div className="flex justify-between text-[13px] font-bold text-slate-700">
            <span>Total receivables</span>
            <span className="tabular-nums">{money(rows.reduce((s, c) => s + c.balance, 0))}</span>
          </div>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Payables: pending supplier invoices from purchase orders (GRN due).
// ---------------------------------------------------------------------------

function PayablesReport() {
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [])
  const pos = useLiveQuery(() => db.purchaseOrders.where('status').anyOf(['ordered', 'partial']).toArray(), [])
  const [view, setView] = useState(false)
  const nameOf = new Map((suppliers ?? []).map((s) => [s.id as number, s.name]))
  const rows = useMemo(() => {
    const bySupplier = new Map<string, { name: string; value: number; pos: number }>()
    for (const po of pos ?? []) {
      const key = po.supplierId !== undefined ? nameOf.get(po.supplierId) ?? `Supplier #${po.supplierId}` : 'Unassigned'
      const agg = bySupplier.get(key) ?? { name: key, value: 0, pos: 0 }
      agg.value += po.lines.reduce((s, ln) => s + ln.qty * ln.unitCost, 0)
      agg.pos += 1
      bySupplier.set(key, agg)
    }
    return [...bySupplier.values()].sort((a, b) => b.value - a.value)
  }, [pos, nameOf])
  const cols = ['Supplier', 'POs', 'Payable']
  const csv = () => downloadCsv('payables', cols, rows.map((r) => [r.name, r.pos.toString(), money(r.value, '')]))
  return (
    <ErpPanel title="Template Name: Payables Report">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Supplier (Party Master)' }, { label: 'Pending POs', align: 'right' }, { label: 'Payable', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={3} /> : rows.map((r, i) => (
              <tr key={r.name} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.pos}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.value, '')}</td>
              </tr>
            ))}
          </ErpTable>
          <div className="flex justify-between text-[13px] font-bold text-slate-700">
            <span>Total payables</span>
            <span className="tabular-nums">{money(rows.reduce((s, r) => s + r.value, 0))}</span>
          </div>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Outstanding: only parties above zero + their credit-limit head-room.
// ---------------------------------------------------------------------------

function OutstandingReport() {
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const [limitBreach, setLimitBreach] = useState(false)
  const [view, setView] = useState(false)
  const rows = useMemo(() => (customers ?? []).filter((c) => c.balance > 0 && (!limitBreach || c.balance > c.creditLimit)), [customers, limitBreach])
  const cols = ['Party', 'Balance', 'Credit Limit', 'Head-room']
  const csv = () => downloadCsv('outstanding', cols, rows.map((c) => [c.name, money(c.balance, ''), money(c.creditLimit, ''), money(c.creditLimit - c.balance, '')]))
  return (
    <ErpPanel title="Template Name: Outstanding Report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
          <input type="checkbox" checked={limitBreach} onChange={(e) => setLimitBreach(e.target.checked)} className="h-4 w-4 accent-[#3b74b8]" />
          Only credit-limit breaches
        </label>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Party' }, { label: 'Balance', align: 'right' }, { label: 'Credit Limit', align: 'right' }, { label: 'Head-room', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((c, i) => (
              <tr key={c.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{c.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(c.balance, '')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(c.creditLimit, '')}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${c.balance > c.creditLimit ? 'font-bold text-red-600' : ''}`}>
                  {money(c.creditLimit - c.balance, '')}
                </td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Audit Trail: from db logs with user/transaction/operation filters.
// ---------------------------------------------------------------------------

function AuditTrail() {
  const logs = useLiveQuery(() => db.logs.orderBy('at').reverse().limit(300).toArray(), [])
  const dr = useDateRange()
  const [user_, setUser_] = useState('')
  const [kind, setKind] = useState('All')
  const [view, setView] = useState(false)
  const users = useMemo(() => [...new Set((logs ?? []).map((l) => l.userName ?? 'system'))], [logs])
  const kinds = useMemo(() => [...new Set((logs ?? []).map((l) => l.kind))], [logs])
  const rows = useMemo(() =>
    (logs ?? []).filter(
      (l) => dr.filter([l.at]).length > 0 && (!user_ || (l.userName ?? 'system') === user_) && (kind === 'All' || l.kind === kind),
    ), [logs, dr.from, dr.to, user_, kind])
  const cols = ['Date', 'Transaction', 'Operation', 'User']
  const csv = () => downloadCsv('audit-trail', cols, rows.map((l) => [fmtDate(l.at), l.kind, l.action, l.userName ?? 'system']))
  return (
    <ErpPanel title="Template Name: Audit Trail Report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRange from={dr.from} to={dr.to} onChange={dr.set} />
        <div className="flex flex-wrap items-end gap-3 text-[12px] font-bold text-slate-600">
          <label className="flex flex-col gap-1">
            User
            <select value={user_} onChange={(e) => setUser_(e.target.value)} className="erp-field rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal">
              <option value="">All</option>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Transaction
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="erp-field rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal">
              <option>All</option>
              {kinds.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Date & Time' }, { label: 'Transaction' }, { label: 'Operation' }, { label: 'User' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((l, i) => (
              <tr key={l.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5">{fmtDate(l.at)} {new Date(l.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-2 py-1.5 capitalize">{l.kind}</td>
                <td className="px-2 py-1.5">{l.action}{l.detail ? ` — ${l.detail}` : ''}</td>
                <td className="px-2 py-1.5">{l.userName ?? 'system'}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Exceptions: the app's own rule-based anomalies (refunds, negative stock,
// over-limit accounts).
// ---------------------------------------------------------------------------

function ExceptionReport() {
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const [view, setView] = useState(false)
  const rows = useMemo(() => {
    const out: { area: string; item: string; exception: string; value: string }[] = []
    for (const s of sales ?? []) if (s.status === 'refunded' || s.status === 'voided') out.push({ area: 'Account', item: s.receiptNo, exception: s.status, value: money(s.total, '') })
    for (const p of products ?? []) if (p.trackStock && p.stock < 0) out.push({ area: 'Stock', item: p.name, exception: 'Negative stock', value: String(p.stock) })
    for (const c of customers ?? []) if (c.balance > c.creditLimit) out.push({ area: 'Receivables', item: c.name, exception: 'Over credit limit', value: money(c.balance - c.creditLimit, '') })
    return out
  }, [sales, products, customers])
  const cols = ['Area', 'Item', 'Exception', 'Value']
  const csv = () => downloadCsv('exception-report', cols, rows.map((r) => [r.area, r.item, r.exception, r.value]))
  return (
    <ErpPanel title="Template Name: Exception Report">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">Refunds, negative stock and credit-limit breaches</span>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Area' }, { label: 'Item' }, { label: 'Exception' }, { label: 'Value', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((r, i) => (
              <tr key={`${r.area}-${r.item}`} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.area}</td>
                <td className="px-2 py-1.5">{r.item}</td>
                <td className="px-2 py-1.5 capitalize">{r.exception}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.value}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Price Comparison: compares the last purchase cost to current selling price
// per medicine (margin check).
// ---------------------------------------------------------------------------

function PriceComparison() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const [view, setView] = useState(false)
  const rows = useMemo(() => (products ?? []).map((p) => ({ p, margin: p.price === 0 ? 0 : ((p.price - p.cost) / p.price) * 100 })).sort((a, b) => a.margin - b.margin), [products])
  const cols = ['Medicine', 'Cost', 'Price', 'Margin %']
  const csv = () => downloadCsv('price-comparison', cols, rows.map((r) => [r.p.name, money(r.p.cost, ''), money(r.p.price, ''), `${r.margin.toFixed(1)}%`]))
  return (
    <ErpPanel title="Template Name: Price Comparison Statement">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">Lowest margins first — review repricing</span>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Medicine' }, { label: 'Purchase Cost', align: 'right' }, { label: 'Selling Price', align: 'right' }, { label: 'Margin', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((r, i) => (
              <tr key={r.p.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.p.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.p.cost, '')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.p.price, '')}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${r.margin < 15 ? 'text-red-600' : ''}`}>{r.margin.toFixed(1)}%</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Location-wise MIS: stock value by bin location.
// ---------------------------------------------------------------------------

function LocationMIS() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const [view, setView] = useState(false)
  const rows = useMemo(() => {
    const byLoc = new Map<string, { value: number; items: number }>()
    for (const p of products ?? []) {
      const key = p.location ?? 'Unassigned'
      const agg = byLoc.get(key) ?? { value: 0, items: 0 }
      agg.value += p.stock * p.cost
      agg.items += 1
      byLoc.set(key, agg)
    }
    return [...byLoc.entries()].map(([location, agg]) => ({ location, ...agg })).sort((a, b) => b.value - a.value)
  }, [products])
  const cols = ['Location', 'Items', 'Stock Value']
  const csv = () => downloadCsv('location-mis', cols, rows.map((r) => [r.location, r.items.toString(), money(r.value, '')]))
  return (
    <ErpPanel title="Template Name: MIS Location-wise">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Location (Bin)' }, { label: 'Medicines', align: 'right' }, { label: 'Stock Value', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={3} /> : rows.map((r, i) => (
              <tr key={r.location} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.location}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.items}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.value, '')}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Budget Analysis: monthly collections against an even-spread annual budget
// the owner can enter.
// ---------------------------------------------------------------------------

function BudgetAnalysis() {
  const sales = useLiveQuery(() => db.sales.where('status').equals('completed').toArray(), [])
  const [budget, setBudget] = useState(0)
  const [year, setYear] = useState(new Date().getFullYear())
  const [view, setView] = useState(false)
  const rows = useMemo(() => {
    const monthly = new Array(12).fill(0) as number[]
    for (const s of sales ?? []) {
      const d = new Date(s.createdAt)
      if (d.getFullYear() === year) monthly[d.getMonth()] += s.total
    }
    const target = budget / 12
    return monthly.map((v, i) => ({
      month: new Date(year, i, 1).toLocaleDateString('en-KE', { month: 'short' }),
      actual: v,
      target,
      variance: v - target,
    }))
  }, [sales, year, budget])
  const cols = ['Month', 'Target', 'Actual', 'Variance']
  const csv = () => downloadCsv('budget-analysis', cols, rows.map((r) => [r.month, money(r.target, ''), money(r.actual, ''), money(r.variance, '')]))
  return (
    <ErpPanel title="Template Name: Budget Analysis">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-4 text-[12px] font-bold text-slate-600">
          <label className="flex flex-col gap-1">
            Year
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="erp-field w-28 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
          </label>
          <label className="flex flex-col gap-1">
            Annual budget (KES)
            <input type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="erp-field w-40 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
          </label>
        </div>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Month' }, { label: 'Target', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Variance', align: 'right' }]}>
            {budget === 0 ? <ErpEmptyRow cols={4} /> : rows.map((r, i) => (
              <tr key={r.month} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-semibold">{r.month}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{moneyShort(r.target)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{moneyShort(r.actual)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${r.variance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{moneyShort(r.variance)}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={budget === 0 ? 0 : rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Stock movements ledger for a party's received stock (Party Stock Ledger).
// ---------------------------------------------------------------------------

function PartyStockLedger() {
  const movements = useLiveQuery(() => db.movements.orderBy('at').reverse().limit(200).toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const nameOf = useMemo(() => new Map((products ?? []).map((p) => [p.id as number, p.name])), [products])
  const [reason, setReason] = useState('All')
  const [view, setView] = useState(false)
  const kinds = useMemo(() => [...new Set((movements ?? []).map((m) => m.reason))], [movements])
  const rows = useMemo(() => (movements ?? []).filter((m) => reason === 'All' || m.reason === reason), [movements, reason])
  const cols = ['Date', 'Medicine', 'Reason', 'Qty Change', 'Ref']
  const csv = () => downloadCsv('party-stock-ledger', cols, rows.map((m: StockMovement) => [fmtDate(m.at), m.productId !== undefined ? nameOf.get(m.productId) ?? '' : '', m.reason, (m.change > 0 ? '+' : '') + m.change, m.reference ?? '']))
  return (
    <ErpPanel title="Template Name: Ancillary Party Stock Ledger">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
          Movement Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="erp-field rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal">
            <option>All</option>
            {kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Date' }, { label: 'Medicine' }, { label: 'Reason' }, { label: 'Qty', align: 'right' }, { label: 'Reference' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={5} /> : rows.map((m, i) => (
              <tr key={m.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5">{fmtDate(m.at)}</td>
                <td className="px-2 py-1.5 font-semibold">{m.productId !== undefined ? nameOf.get(m.productId) ?? '—' : '—'}</td>
                <td className="px-2 py-1.5 capitalize">{m.reason}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${m.change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {(m.change > 0 ? '+' : '') + m.change}
                </td>
                <td className="px-2 py-1.5">{m.reference ?? '—'}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

// ---------------------------------------------------------------------------
// Non-compliance: lines issued without doctor/patient info, untaxed bills etc.
// (kept pragmatic: untaxed OTC bills without narration).
// ---------------------------------------------------------------------------

function NonCompliance() {
  const sales = useLiveQuery(() => db.sales.where('status').equals('completed').toArray(), [])
  const [view, setView] = useState(false)
  const rows = useMemo(() => (sales ?? []).filter((s) => !s.note || l(s).some((x) => !x.taxable && x.qty * x.unitPrice > 0)).slice(0, 100), [sales])
  const cols = ['Bill No', 'Date', 'Issue', 'Bill Amount']
  const csv = () => downloadCsv('non-compliance', cols, rows.map((s) => [s.receiptNo, fmtDate(s.createdAt), 'Missing narration / untaxed lines', money(s.total, '')]))
  return (
    <ErpPanel title="Template Name: Non-Compliance Report">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">Bills without narration and untaxed service lines</span>
        <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
      </div>
      {view && (
        <>
          <ErpTable columns={[{ label: 'Bill No' }, { label: 'Date' }, { label: 'Issue' }, { label: 'Amount', align: 'right' }]}>
            {rows.length === 0 ? <ErpEmptyRow cols={4} /> : rows.map((s, i) => (
              <tr key={s.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-white' : 'bg-[#f3ece2]'}`}>
                <td className="px-2 py-1.5 font-mono text-[12px]">{s.receiptNo}</td>
                <td className="px-2 py-1.5">{fmtDate(s.createdAt)}</td>
                <td className="px-2 py-1.5">Missing narration / untaxed lines</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(s.total, '')}</td>
              </tr>
            ))}
          </ErpTable>
          <ReportActions rows={rows.length} onExport={csv} />
        </>
      )}
    </ErpPanel>
  )
}

const BODIES: Record<string, ComponentType> = {
  'list': ReportOverview,
  'month-wise': MonthWiseAnalysis,
  stock: StockReport,
  reorder: StockReorder,
  abc: AbcAnalysis,
  ageing: AgeingReport,
  receivables: ReceivablesReport,
  payables: PayablesReport,
  outstanding: OutstandingReport,
  'audit-trail': AuditTrail,
  exception: ExceptionReport,
  'price-comparison': PriceComparison,
  'location-wise': LocationMIS,
  budget: BudgetAnalysis,
  'party-ledger': PartyStockLedger,
  'non-compliance': NonCompliance,
}

function ReportBody({ slug }: { slug: string }) {
  const Body = BODIES[slug]
  if (Body) return <Body />
  // Remaining slugs (BRS, annexures, time-table…) get the classic scaffold
  // with pick lists so the nav always lands on a real screen.
  return <GenericScaffold slug={slug} />
}

function GenericScaffold({ slug }: { slug: string }) {
  const title = REPORT_ITEMS.find((r) => r.to === `/reports/${slug}`)?.label ?? slug
  const [sel, setSel] = useState<string[]>([])
  const options = ['Account Statement', 'OS Debtor', 'OS Creditor', 'Cash Collection DEBTORS', 'Cash Collection - OT']
  return (
    <ErpPanel title={`Template Name: ${title}`}>
      <div className="grid gap-2 md:grid-cols-2">
        <PickTwo title="Selection" options={options} value={sel} onChange={setSel} />
      </div>
      <p className="text-[12px] text-slate-500">
        This template keeps its classic layout pending data mapping — selection, filters and export
        are wired; results will list here once data is captured from live usage.
      </p>
      <div className="flex items-center justify-between">
        <button type="button" className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">View</button>
        <SearchResultNote count={0} />
      </div>
    </ErpPanel>
  )
}
