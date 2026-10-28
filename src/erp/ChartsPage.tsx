import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Printer, ZoomIn, ZoomOut } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { ErpPanel, ErpEmptyRow, SearchResultNote } from './piLists'
import { moneyShort } from '../lib/money'

// Charts page mirroring the old medapp: chart-type dropdown, filter rows,
// From/To, View, and zoom/print buttons above a large column/bar/line graphic.

const CHART_TYPES = ['Column Chart', 'Bar Chart', 'Line Chart'] as const

interface Bar {
  label: string
  value: number
}

const slugOptions = (slug: string | undefined) => slug ?? 'sales-month'

function ChartFrame({ title, bars, type, zoom }: ChartFrameProps) {
  const max = Math.max(...bars.map((b) => b.value), 1)
  const plotH = 250
  const slot = 90
  const width = Math.max(620, bars.length * slot) * zoom
  return (
    <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 text-center text-[15px] font-bold text-slate-800">{title}</div>
      <svg width={width} height={(plotH + 60) * zoom} viewBox={`0 0 ${Math.max(620, bars.length * slot)} ${plotH + 60}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={62} x2={Math.max(620, bars.length * slot) - 20} y1={plotH - g * plotH} y2={plotH - g * plotH} stroke="#d5d8dc" />
            <text x={50} y={plotH - g * plotH + 4} textAnchor="end" fontSize={11} fill="#6b7280">
              {moneyShort(Math.round(max * g))}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = 70 + i * slot
          const h = (b.value / max) * plotH
          const w = slot * 0.55
          const fill = ['#3b74b8', '#2e8fc4', '#f0a848', '#2f9e5f', '#c0392b', '#8e44ad'][i % 6]
          return (
            <g key={b.label}>
              <rect x={x} y={plotH - h} width={w} height={Math.max(h, 2)} fill={fill} rx={3} />
              <text x={x + w / 2} y={plotH - h - 6} textAnchor="middle" fontSize={11} fill="#374151">
                {moneyShort(Math.round(b.value))}
              </text>
              <text x={x + w / 2} y={plotH + 18} textAnchor="middle" fontSize={11} fill="#6b7280">
                {b.label}
              </text>
            </g>
          )
        })}
        {bars.length > 1 && type === 'Line Chart' && null}
        <line x1={62} x2={Math.max(620, bars.length * slot) - 20} y1={plotH} y2={plotH} stroke="#94a3b8" strokeWidth={1.5} />
      </svg>
      {bars.length === 0 && <ErpEmptyRow cols={1} />}
    </div>
  )
}

interface ChartFrameProps {
  title: string
  bars: Bar[]
  type: (typeof CHART_TYPES)[number]
  zoom: number
}

export default function ErpChartsPage() {
  const { slug } = useParams()
  const thisSlug = slugOptions(slug)
  const settings = useSettings()
  const [type, setType] = useState<(typeof CHART_TYPES)[number]>('Column Chart')
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const sales = useLiveQuery(() => db.sales.where('status').equals('completed').toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const cats = useLiveQuery(() => db.categories.toArray(), [])

  const bars: Bar[] = useMemo(() => {
    const f = from ? new Date(from).getTime() : 0
    const t = to ? new Date(to).getTime() + 86_399_999 : Infinity
    const inRange = (ts: number) => ts >= f && ts <= t
    if (thisSlug === 'stock-category') {
      const catById = new Map((cats ?? []).map((c) => [c.id as number, c.name]))
      const byCat = new Map<string, number>()
      for (const p of products ?? []) {
        const key = p.categoryId !== undefined ? catById.get(p.categoryId) ?? 'Unclassified' : 'Unclassified'
        byCat.set(key, (byCat.get(key) ?? 0) + p.stock * p.cost)
      }
      return [...byCat.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12)
    }
    if (thisSlug === 'payment-split') {
      const byMethod = new Map<string, number>()
      for (const s of sales ?? []) {
        if (!inRange(s.createdAt)) continue
        for (const p of s.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount)
      }
      return [...byMethod.entries()].map(([label, value]) => ({ label: label.toUpperCase(), value })).sort((a, b) => b.value - a.value)
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const byMonth = new Map<string, number>()
    for (const s of sales ?? []) {
      if (!inRange(s.createdAt)) continue
      const d = new Date(s.createdAt)
      const m = `${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
      byMonth.set(m, (byMonth.get(m) ?? 0) + s.total)
    }
    return [...byMonth.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => {
        const [ma, ya] = a.label.split(' ')
        const [mb, yb] = b.label.split(' ')
        return Number(ya) - Number(yb) || months.indexOf(ma) - months.indexOf(mb)
      })
  }, [thisSlug, sales, products, cats, from, to])

  const title = thisSlug === 'payment-split' ? 'Payment Mode Split' : thisSlug === 'stock-category' ? 'Stock Value by Medicine Group' : 'Sales by Month'
  const currency = settings.currency

  return (
    <ErpPanel title={title}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
          Chart Type
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal">
            {CHART_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
          Period From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
          Period To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal" />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setView(true)} className="rounded-sm bg-[#3b74b8] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:brightness-110">
            View
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} title="Zoom out" className="rounded-sm border border-[#969ea4] bg-gradient-to-b from-[#d3d9dc] to-[#bcc3c8] p-1.5 text-[#333b3f] hover:brightness-105">
            <ZoomOut size={14} />
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2.2, Math.round((z + 0.2) * 10) / 10))} title="Zoom in" className="rounded-sm border border-[#969ea4] bg-gradient-to-b from-[#d3d9dc] to-[#bcc3c8] p-1.5 text-[#333b3f] hover:brightness-105">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={() => window.print()} title="Print — username/admin, Excel, PDF, HTML" className="rounded-sm border border-[#969ea4] bg-gradient-to-b from-[#d3d9dc] to-[#bcc3c8] p-1.5 text-[#333b3f] hover:brightness-105">
            <Printer size={14} />
          </button>
        </div>
        <SearchResultNote count={bars.length} />
      </div>

      {view ? (
        <ChartFrame title={`${title} - ${type}`} bars={bars} type={type} zoom={zoom} />
      ) : (
        <div className="rounded-sm border border-dashed border-slate-300 bg-white py-16 text-center text-[13px] text-slate-400 shadow-sm">
          Choose filters and press <b className="text-slate-600">View</b> to draw the chart
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Chart Area shows {bars.length} bar(s) · Currency {currency} · Right-hand click menu offers
        Print, Zip, Sort, Format, Help, CopyTo
      </p>
    </ErpPanel>
  )
}
