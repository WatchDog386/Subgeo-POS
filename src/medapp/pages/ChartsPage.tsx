import { useState } from 'react'
import { db } from '../../db/db'
import { useToast } from '../../components/ui'
import { inRange } from '../data'
import { ZoomInIcon } from '../icons'
import { Btn, DateField, Input, Select } from '../ui'
import { At, Canvas, L } from './layout'
import { ColumnChart } from './reportKit'

/** Charts tab (screenshot 11.47.27): chart type, three filter rows, dataset, dates. */
const DATASETS = ['SELECT', 'SALES', 'SERVICES', 'STOCK', 'PURCHASES']
const FIELDS: Record<string, string[]> = {
  SALES: ['', 'PAYMENT MODE', 'USER NAME', 'PRODUCT NAME', 'BILL NO'],
  SERVICES: ['', 'PATIENT NAME', 'STATUS', 'JOB NO'],
  STOCK: ['', 'GROUP', 'PRODUCT NAME', 'PRODUCT CODE'],
  PURCHASES: ['', 'SUPPLIER', 'STATUS', 'LPO NO'],
  SELECT: [''],
}
const OPS = ['START WITH', 'EQUALS', 'CONTAINS', 'NOT EQUAL']
const COLORS = ['#e07a12', '#9fbe4a', '#1a9be6', '#c9c39a']

type Rec = { ts: number; group: string; fields: Record<string, string>; values: number[] }
type Filter = { field: string; op: string; value: string; join: string }

function test(f: Filter, r: Rec): boolean {
  if (!f.field || !f.value.trim()) return true
  const v = (r.fields[f.field] ?? '').toLowerCase()
  const q = f.value.trim().toLowerCase()
  if (f.op === 'EQUALS') return v === q
  if (f.op === 'CONTAINS') return v.includes(q)
  if (f.op === 'NOT EQUAL') return v !== q
  return v.startsWith(q)
}

const month = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })

async function load(dataset: string): Promise<{ recs: Rec[]; series: string[] }> {
  if (dataset === 'SERVICES') {
    const jobs = await db.jobs.toArray()
    return {
      series: ['Labour', 'Parts'],
      recs: jobs.map((j) => ({
        ts: j.createdAt,
        group: month(j.createdAt),
        fields: { 'PATIENT NAME': j.customerName, STATUS: j.status.toUpperCase(), 'JOB NO': j.jobNo },
        values: [j.labour / 100, j.lines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0) / 100],
      })),
    }
  }
  if (dataset === 'STOCK') {
    const [ps, cats] = await Promise.all([db.products.filter((p) => p.active && p.trackStock).toArray(), db.categories.toArray()])
    return {
      series: ['Stock Qty', 'Re-Order Level'],
      recs: ps.map((p) => {
        const g = cats.find((c) => c.id === p.categoryId)?.name ?? 'UNGROUPED'
        return { ts: p.updatedAt, group: g, fields: { GROUP: g, 'PRODUCT NAME': p.name, 'PRODUCT CODE': p.sku }, values: [p.stock, p.reorderLevel] }
      }),
    }
  }
  if (dataset === 'PURCHASES') {
    const [pos, sups] = await Promise.all([db.purchaseOrders.toArray(), db.suppliers.toArray()])
    return {
      series: ['Ordered', 'Received'],
      recs: pos.map((p) => {
        const s = sups.find((x) => x.id === p.supplierId)?.name ?? 'NO SUPPLIER'
        return {
          ts: p.createdAt,
          group: month(p.createdAt),
          fields: { SUPPLIER: s, STATUS: p.status.toUpperCase(), 'LPO NO': p.poNo },
          values: [p.lines.reduce((t, l) => t + l.qty * l.unitCost, 0) / 100, p.lines.reduce((t, l) => t + l.received * l.unitCost, 0) / 100],
        }
      }),
    }
  }
  const [sales, users] = await Promise.all([db.sales.toArray(), db.users.toArray()])
  return {
    series: ['Cash', 'M-Pesa', 'Card', 'Credit'],
    recs: sales.map((s) => {
      const by = (m: string) => s.payments.filter((p) => p.method === m).reduce((t, p) => t + p.amount, 0) / 100
      return {
        ts: s.createdAt,
        group: month(s.createdAt),
        fields: {
          'PAYMENT MODE': (s.payments[0]?.method ?? 'cash').toUpperCase(),
          'USER NAME': users.find((u) => u.id === s.userId)?.name ?? '',
          'PRODUCT NAME': s.lines.map((l) => l.name).join(' | '),
          'BILL NO': s.receiptNo,
        },
        values: [by('cash') - s.change / 100, by('mpesa'), by('card'), by('account')],
      }
    }),
  }
}

export default function ChartsPage() {
  const toast = useToast()
  const [chart, setChart] = useState('Column Chart')
  const [filters, setFilters] = useState<Filter[]>(Array.from({ length: 3 }, () => ({ field: '', op: 'START WITH', value: '', join: 'AND' })))
  const [dataset, setDataset] = useState('SELECT')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [zoom, setZoom] = useState(1)
  const [data, setData] = useState<{ label: string; values: number[] }[]>([])
  const [series, setSeries] = useState<string[]>([])

  const setF = (i: number, patch: Partial<Filter>) => setFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const view = async () => {
    if (dataset === 'SELECT') return toast('Select what to chart', 'error')
    const { recs, series: names } = await load(dataset)
    const kept = recs
      .filter((r) => inRange(r.ts, from, to))
      .filter((r) =>
        filters.reduce<boolean | null>((acc, f, i) => {
          const ok = test(f, r)
          if (i === 0 || acc === null) return ok
          return filters[i - 1].join === 'OR' ? acc || ok : acc && ok
        }, null) ?? true,
      )
    const map = new Map<string, number[]>()
    for (const r of kept.sort((a, b) => a.ts - b.ts)) {
      const cur = map.get(r.group) ?? names.map(() => 0)
      r.values.forEach((v, i) => (cur[i] += v))
      map.set(r.group, cur)
    }
    setSeries(names)
    setData([...map.entries()].map(([label, values]) => ({ label, values })))
    if (!kept.length) toast('No records for the selection', 'error')
  }

  const fields = FIELDS[dataset] ?? ['']
  return (
    <Canvas height={720}>
      <At x={15} y={48}>
        <L>Chart :</L>
      </At>
      <At x={82} y={48}>
        <Select value={chart} onChange={setChart} options={['Column Chart', 'Line Chart']} width={146} plain />
      </At>
      {filters.map((f, i) => (
        <At key={i} x={12} y={103 + i * 29} style={{ gap: 8 }}>
          <Select value={f.field} onChange={(v) => setF(i, { field: v })} options={fields} width={160} />
          <Select value={f.op} onChange={(v) => setF(i, { op: v })} options={OPS} width={102} />
          <Input value={f.value} onChange={(v) => setF(i, { value: v })} width={100} />
          <Select value={f.join} onChange={(v) => setF(i, { join: v })} options={['AND', 'OR']} width={65} />
        </At>
      ))}
      <At x={12} y={191}>
        <Select value={dataset} onChange={setDataset} options={DATASETS} width={78} />
      </At>
      <At x={102} y={191}>
        <L>From</L>
      </At>
      <At x={146} y={191}>
        <DateField value={from} onChange={setFrom} width={68} />
      </At>
      <At x={241} y={191}>
        <L>To</L>
      </At>
      <At x={270} y={191}>
        <DateField value={to} onChange={setTo} width={68} />
      </At>
      <At x={361} y={191} style={{ gap: 8 }}>
        <Btn style={{ width: 63 }} onClick={view}>
          View
        </Btn>
        <Btn style={{ width: 76 }} onClick={() => setZoom(Math.min(3, zoom + 0.25))}>
          <ZoomInIcon /> Zoomin
        </Btn>
        <Btn style={{ width: 84 }} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          <ZoomInIcon minus /> Zoomout
        </Btn>
        <Btn style={{ width: 43 }} onClick={() => window.print()}>
          Print
        </Btn>
      </At>
      {COLORS.map((c, i) => (
        <At key={c} x={17} y={222 + i * 22}>
          <span style={{ width: 10, height: 15, background: c, display: 'inline-block' }} />
          {series[i] && <span className="ma-label">{series[i]}</span>}
        </At>
      ))}
      <At x={14} y={329} top>
        <ColumnChart data={data} width={400} height={330} zoom={zoom} type={chart} />
      </At>
    </Canvas>
  )
}
