import { useState, type CSSProperties, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Product } from '../../db/types'
import { downloadCsv } from '../../lib/csv'
import { AddCircleIcon, SearchLens } from '../icons'
import { Btn, Dialog, Grid, IBtn, Input, Rows, matches, type Col } from '../ui'

export const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })

/** Small search tile + "| n rows retrieved |" + grid, as used in every picker. */
export function PickGrid({
  cols,
  items,
  width,
  height,
  selected,
  onSelect,
  onOpen,
  searchWidth = 70,
  countGap,
  style,
}: {
  cols: Col[]
  items: { id: string | number; cells: Record<string, string> }[]
  width: number
  height: number
  selected?: string | number
  onSelect?: (id: string | number) => void
  onOpen?: (id: string | number) => void
  searchWidth?: number
  countGap?: number
  style?: CSSProperties
}) {
  const [q, setQ] = useState('')
  const rows = items.filter((r) => matches(q, ...Object.values(r.cells)))
  return (
    <div style={{ width, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 27, marginBottom: 3 }}>
        <span className="ma-search" style={{ width: searchWidth }}>
          <span className="ma-search-ico">
            <SearchLens />
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </span>
        <span style={{ marginLeft: countGap ?? 'auto', marginRight: countGap === undefined ? 30 : 0 }}>
          <Rows n={rows.length} />
        </span>
      </div>
      <Grid
        cols={cols}
        rows={rows}
        height={height}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    </div>
  )
}

/** Hook: active products as picker rows (Product Name / Product Code). */
export function useProductRows() {
  const products = useLiveQuery(() => db.products.filter((p) => p.active && p.trackStock).sortBy('name'), [], [] as Product[])
  return {
    products,
    rows: products.map((p) => ({ id: p.id!, cells: { name: p.name, code: p.sku } })),
  }
}

export const PRODUCT_COLS = (w1: number, w2: number) => [C('name', 'Product Name', w1), C('code', 'Product Code', w2)]

/** Generic results window opened by the View buttons. */
export function ResultDialog({
  title,
  cols,
  rows,
  onClose,
  extra,
}: {
  title: string
  cols: Col[]
  rows: Record<string, string>[]
  onClose: () => void
  extra?: ReactNode
}) {
  const [q, setQ] = useState('')
  const shown = rows.filter((r) => matches(q, ...Object.values(r)))
  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={Math.min(1100, cols.reduce((s, c) => s + c.width, 0) + 60)}
      footer={
        <>
          <Btn onClick={() => window.print()}>Print</Btn>
          <Btn onClick={() => downloadCsv(title.replace(/[^a-z0-9]+/gi, '-'), cols.map((c) => c.label), shown.map((r) => cols.map((c) => r[c.key] ?? '')))}>Export</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span className="ma-search" style={{ width: 300 }}>
          <span className="ma-search-ico">
            <SearchLens />
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Rows n={shown.length} />
        </span>
      </div>
      {extra}
      <Grid cols={cols} rows={shown.map((r, i) => ({ id: i, cells: r }))} height={420} />
    </Dialog>
  )
}

export const DEFAULT_PERIODS = ['0-30', '31-60', '61-90', '91-120', '121-150', '151-180', '181-210', '211-240']

/** "[ ] - [ ] (+)" period editor + Ageing Periods list. */
export function PeriodsEditor({
  periods,
  setPeriods,
  width = 190,
  height = 250,
}: {
  periods: string[]
  setPeriods: (p: string[]) => void
  width?: number
  height?: number
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [sel, setSel] = useState<string | number | undefined>()
  return (
    <div style={{ width }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 27, marginBottom: 3 }}>
        <Input value={a} onChange={setA} width={60} />
        <span style={{ margin: '0 8px' }}>-</span>
        <Input value={b} onChange={setB} width={60} />
        <IBtn
          title="Add Period"
          style={{ width: 24, height: 22, marginLeft: 8 }}
          onClick={() => {
            const x = parseInt(a, 10)
            const y = parseInt(b, 10)
            if (Number.isFinite(x) && Number.isFinite(y) && y >= x) {
              setPeriods([...periods, `${x}-${y}`])
              setA('')
              setB('')
            }
          }}
        >
          <AddCircleIcon />
        </IBtn>
      </div>
      <Grid
        compact
        cols={[C('p', 'Ageing Periods', width)]}
        rows={periods.map((p, i) => ({ id: i, cells: { p } }))}
        height={height}
        selected={sel}
        onSelect={setSel}
        onOpen={(id) => setPeriods(periods.filter((_, i) => i !== id))}
      />
    </div>
  )
}

export function parsePeriods(periods: string[]): { label: string; lo: number; hi: number }[] {
  return periods
    .map((p) => {
      const [lo, hi] = p.split('-').map((x) => parseInt(x, 10))
      return { label: p, lo, hi }
    })
    .filter((p) => Number.isFinite(p.lo) && Number.isFinite(p.hi))
}

/** Simple SVG column chart in the old style (grey axis, 0-100 scale). */
export function ColumnChart({
  data,
  width = 400,
  height = 360,
  zoom = 1,
  colors = ['#e07a12', '#9fbe4a', '#1a9be6', '#c9c39a'],
  type = 'Column Chart',
}: {
  data: { label: string; values: number[] }[]
  width?: number
  height?: number
  zoom?: number
  colors?: string[]
  type?: string
}) {
  const W = width * zoom
  const H = height
  const left = 40
  const bottom = 26
  const plotH = H - bottom - 10
  const max = Math.max(100, ...data.flatMap((d) => d.values))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const series = Math.max(1, ...data.map((d) => d.values.length))
  const slot = data.length ? (W - left - 10) / data.length : 0
  const bw = Math.max(4, Math.min(40, (slot * 0.7) / series))
  const y = (v: number) => 10 + plotH - (v / top) * plotH
  return (
    <svg className="ma-chart" width={W} height={H}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#e6e6e6" />
          <line x1={left - 5} x2={left} y1={y(t)} y2={y(t)} stroke="#999" />
          <text x={left - 8} y={y(t) + 4} textAnchor="end">
            {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
          </text>
        </g>
      ))}
      <rect x={left} y={10} width={7} height={plotH} fill="#bdcde0" />
      <rect x={left} y={10 + plotH} width={W - left - 10} height={7} fill="#bdcde0" />
      {type === 'Line Chart'
        ? Array.from({ length: series }, (_, s) => (
            <polyline
              key={s}
              fill="none"
              stroke={colors[s % colors.length]}
              strokeWidth={2}
              points={data.map((d, i) => `${left + 10 + slot * i + slot / 2},${y(d.values[s] ?? 0)}`).join(' ')}
            />
          ))
        : data.map((d, i) =>
            d.values.map((v, s) => (
              <rect
                key={`${i}-${s}`}
                x={left + 10 + slot * i + (slot - bw * series) / 2 + s * bw}
                y={y(v)}
                width={bw - 1}
                height={10 + plotH - y(v)}
                fill={colors[s % colors.length]}
              >
                <title>{`${d.label}: ${v.toFixed(2)}`}</title>
              </rect>
            )),
          )}
      {data.map((d, i) => (
        <text key={d.label} x={left + 10 + slot * i + slot / 2} y={H - 6} textAnchor="middle" style={{ fontSize: 9 }}>
          {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
        </text>
      ))}
    </svg>
  )
}

function niceStep(max: number): number {
  const raw = max / 5
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}
