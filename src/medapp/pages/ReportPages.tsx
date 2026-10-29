import { useState, type JSX } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Category, Customer, Product, Sale, StockMovement } from '../../db/types'
import { useToast } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { amt, dmy, getKv, inRange, parseDmy, setKv, todayDmy, useKv, useMedDefaults, useUserMap } from '../data'
import { MagnifierIcon, SearchLens, ZoomInIcon } from '../icons'
import { Btn, Check, DateField, Grid, IBtn, Input, LookupField, Radio, Select, TransferArrows, useTransfer, type Col } from '../ui'
import { At, Canvas, L, Title } from './layout'
import { C, ColumnChart, DEFAULT_PERIODS, PRODUCT_COLS, PeriodsEditor, PickGrid, ResultDialog, parsePeriods, useProductRows } from './reportKit'
import {
  AncillaryLedger,
  AnnexureReport,
  AuditTrailReport,
  BrsReport,
  BudgetAnalysis,
  ExceptionReport,
  NonComplianceReport,
  PayablesReport,
  PolicyComparison,
} from './ReportPages2'

export default function ReportPage() {
  const { slug = '' } = useParams()
  const pages: Record<string, () => JSX.Element> = {
    'month-wise': MonthWise,
    stock: StockReport,
    reorder: ReorderReport,
    abc: AbcAnalysis,
    ageing: AgeingReport,
    'time-table': TimeTable,
    'mis-location': MisLocation,
    'price-comparison': PriceComparison,
    outstanding: OutstandingReport,
    receivables: ReceivablesReport,
    payables: PayablesReport,
    'non-compliance': NonComplianceReport,
    annexure: AnnexureReport,
    brs: BrsReport,
    'audit-trail': AuditTrailReport,
    exception: ExceptionReport,
    'ancillary-ledger': AncillaryLedger,
    'policy-comparison': PolicyComparison,
    budget: BudgetAnalysis,
  }
  const Page = pages[slug] ?? MonthWise
  return <Page key={slug} />
}

type Result = { title: string; cols: Col[]; rows: Record<string, string>[]; chart?: { label: string; values: number[] }[] }

/* ── Shared data helpers ───────────────────────────────────────────────── */
const monthLabel = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(' ', '-')
const lineTotal = (s: Sale) => s.lines.reduce((t, l) => t + l.qty * l.unitPrice - l.discount, 0)

export async function debtorAgeing(periods: string[], only?: Set<string>): Promise<{ cols: Col[]; rows: Record<string, string>[] }> {
  const ps = parsePeriods(periods)
  const [cs, sales] = await Promise.all([db.customers.toArray(), db.sales.toArray()])
  const rows = cs
    .filter((c: Customer) => c.balance > 0 && (!only || only.size === 0 || only.has(c.name.toUpperCase())))
    .map((c) => {
      const last = sales.filter((s) => s.customerId === c.id && s.payments.some((p) => p.method === 'account')).reduce((m, s) => Math.max(m, s.createdAt), c.createdAt)
      const age = Math.floor((Date.now() - last) / 86_400_000)
      const r: Record<string, string> = { name: c.name.toUpperCase(), total: amt(c.balance) }
      let placed = false
      ps.forEach((p, i) => {
        const hit = age >= p.lo && age <= p.hi
        r[`p${i}`] = hit ? amt(c.balance) : ''
        placed ||= hit
      })
      r.more = placed ? '' : amt(c.balance)
      return r
    })
  return {
    cols: [C('name', 'Customer Name', 240), ...ps.map((p, i) => C(`p${i}`, p.label, 85, 'right')), C('more', 'Above', 85, 'right'), C('total', 'Total', 100, 'right')],
    rows,
  }
}

function useCategories() {
  return useLiveQuery(() => db.categories.toArray(), [], [] as Category[])
}

/* ── Month-Wise Analysis ───────────────────────────────────────────────── */
const GROUPS = ['', 'MONTH', 'PAYMENT MODE', 'USER NAME', 'PATIENT CATEGORY']
const TXNS = ['OTC Medicine Issued/Bill', 'OTC Medicine Isse Return', 'Service Request/Bill']

function MonthWise() {
  const toast = useToast()
  const users = useUserMap()
  const d = useMedDefaults()
  const [txn, setTxn] = useState('')
  const [g1, setG1] = useState('')
  const [g2, setG2] = useState('')
  const [key, setKey] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [chartType, setChartType] = useState('Column Chart')
  const [zoom, setZoom] = useState(1)
  const [res, setRes] = useState<Result | null>(null)

  const view = async () => {
    const t = txn || TXNS[0]
    type Rec = { ts: number; amount: number; mode: string; user: string; category: string }
    let recs: Rec[] = []
    if (t === 'Service Request/Bill') {
      recs = (await db.jobs.toArray()).map((j) => ({
        ts: j.createdAt,
        amount: j.labour + j.lines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0),
        mode: 'SERVICE',
        user: '',
        category: d.patientCategory,
      }))
    } else {
      const ret = t === 'OTC Medicine Isse Return'
      recs = (await db.sales.toArray())
        .filter((s) => (ret ? s.refundOf !== undefined : s.refundOf === undefined))
        .map((s) => ({
          ts: s.createdAt,
          amount: Math.abs(s.total),
          mode: (s.payments[0]?.method ?? 'cash').toUpperCase(),
          user: users.get(s.userId)?.name.toUpperCase() ?? '',
          category: s.customerId !== undefined ? 'CREDIT CLIENTS' : d.patientCategory,
        }))
    }
    recs = recs.filter((r) => inRange(r.ts, from, to)).sort((a, b) => a.ts - b.ts)
    const by = (g: string, r: Rec) => (g === 'PAYMENT MODE' ? r.mode : g === 'USER NAME' ? r.user : g === 'PATIENT CATEGORY' ? r.category : monthLabel(r.ts))
    const level1 = g1 || 'MONTH'
    const count = key === 'NO OF BILLS'
    const map = new Map<string, number>()
    const chart = new Map<string, number>()
    for (const r of recs) {
      const k1 = by(level1, r)
      const k = g2 ? `${k1}\u0000${by(g2, r)}` : k1
      const v = count ? 1 : r.amount
      map.set(k, (map.get(k) ?? 0) + v)
      chart.set(k1, (chart.get(k1) ?? 0) + v)
    }
    const cols = [C('a', level1, 160), ...(g2 ? [C('b', g2, 160)] : []), C('v', count ? 'NO OF BILLS' : 'BILL AMOUNT', 120, 'right')]
    const rows = [...map.entries()].map(([k, v]) => {
      const [a, b] = k.split('\u0000')
      return { a, b: b ?? '', v: count ? String(v) : amt(v) }
    })
    if (!rows.length) toast('No records found for the selection', 'error')
    setRes({ title: 'Month Wise Report', cols, rows, chart: [...chart.entries()].map(([label, v]) => ({ label, values: [count ? v : v / 100] })) })
  }

  return (
    <Canvas height={900}>
      <Title x={504} y={26}>
        Month Wise Report
      </Title>
      <At x={19} y={53}>
        <L>Transaction</L>
      </At>
      <At x={135} y={53}>
        <LookupField value={txn} onChange={setTxn} options={TXNS} title="Transaction" />
      </At>
      <At x={336} y={53}>
        <L>Group By(Level 1)</L>
      </At>
      <At x={453} y={57}>
        <Select value={g1} onChange={setG1} options={GROUPS} width={175} />
      </At>
      <At x={19} y={86}>
        <L>Group By(Level 2)</L>
      </At>
      <At x={135} y={91}>
        <Select value={g2} onChange={setG2} options={GROUPS} width={175} />
      </At>
      <At x={341} y={86}>
        <L>Key Field</L>
      </At>
      <At x={453} y={91}>
        <Select value={key} onChange={setKey} options={['', 'BILL AMOUNT', 'NO OF BILLS']} width={175} />
      </At>
      <At x={146} y={127}>
        <L>From Date</L>
      </At>
      <At x={215} y={129}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={316} y={127}>
        <L>To Date</L>
      </At>
      <At x={371} y={129}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={472} y={129} style={{ gap: 8 }}>
        <Btn onClick={view}>View</Btn>
        <Btn onClick={() => window.print()}>Print</Btn>
        <Btn
          onClick={() =>
            res &&
            downloadCsv('Month-Wise-Report', res.cols.map((c) => c.label), res.rows.map((r) => res.cols.map((c) => r[c.key] ?? '')))
          }
        >
          Export
        </Btn>
      </At>
      <At x={16} y={161} top>
        {res && res.rows.length ? (
          <Grid cols={res.cols} rows={res.rows.map((r, i) => ({ id: i, cells: r }))} width={778} height={222} />
        ) : (
          <div className="ma-grid" style={{ width: 778, height: 222 }}>
            <div style={{ height: 25, background: 'linear-gradient(to bottom,#f6f6f6,#d8d8d8)', borderBottom: '1px solid #c3c3c3' }} />
          </div>
        )}
      </At>
      <At x={18} y={431}>
        <L>Chart :</L>
      </At>
      <At x={73} y={431}>
        <L>MonthWise</L>
      </At>
      <At x={159} y={431}>
        <Select value={chartType} onChange={setChartType} options={['Column Chart', 'Line Chart']} width={103} plain />
      </At>
      <At x={284} y={431} style={{ gap: 8 }}>
        <Btn style={{ width: 97 }} onClick={view}>
          ChartView
        </Btn>
        <Btn onClick={() => window.print()}>Print</Btn>
        <Btn style={{ width: 76 }} onClick={() => setZoom(Math.min(3, zoom + 0.25))}>
          <ZoomInIcon /> Zoomin
        </Btn>
        <Btn style={{ width: 84 }} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          <ZoomInIcon minus /> Zoomout
        </Btn>
      </At>
      <At x={14} y={446} top>
        <ColumnChart data={res?.chart ?? []} width={400} height={420} zoom={zoom} type={chartType} />
      </At>
      <At x={428} y={451} top>
        <span style={{ width: 10, height: 15, background: '#e07a12', display: 'inline-block' }} />
      </At>
    </Canvas>
  )
}

/* ── Stock Report ──────────────────────────────────────────────────────── */
type StockMode = 'group' | 'location' | 'product' | 'bin'

function StockReport() {
  const toast = useToast()
  const d = useMedDefaults()
  const cats = useCategories()
  const { products } = useProductRows()
  const [mode, setMode] = useState<StockMode>('product')
  const [s1, setS1] = useState('Select')
  const [s2, setS2] = useState('Select')
  const [s3, setS3] = useState('Select')
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [type, setType] = useState('WITHOUT VALUES')
  const [fCol, setFCol] = useState('Select')
  const [fOp, setFOp] = useState('WHERE')
  const [fVal, setFVal] = useState('')
  const [applied, setApplied] = useState('')
  const [opts, setOpts] = useState<Record<string, boolean>>({})
  const [batch, setBatch] = useState('Without Batch')
  const [none, setNone] = useState('None')
  const [res, setRes] = useState<Result | null>(null)
  const [lq, setLq] = useState('')
  const opt = (k: string) => !!opts[k]
  const setOpt = (k: string) => (v: boolean) => setOpts({ ...opts, [k]: v })

  const filteredProducts = products
    .filter((p) => s1 === 'Select' || cats.find((c) => c.id === p.categoryId)?.name === s1)
    .filter((p) => s3 === 'Select' || (s3 === 'ZERO STOCK' ? p.stock === 0 : s3 === 'NEGATIVE STOCK' ? p.stock < 0 : p.stock > 0))
  const leftItems: { id: string; cells: Record<string, string> }[] =
    mode === 'group'
      ? cats.map((c) => ({ id: `g${c.id}`, cells: { name: c.name, code: `GRP-${c.id}` } }))
      : mode === 'location'
        ? d.locations.map((l, i) => ({ id: `l${i}`, cells: { name: l, code: `LOC-${i + 1}` } }))
        : mode === 'bin'
          ? [...new Set(products.map((p) => p.location).filter((x): x is string => !!x))].map((b) => ({ id: `b${b}`, cells: { name: b, code: b } }))
          : filteredProducts.map((p) => ({ id: `p${p.id}`, cells: { name: p.name, code: p.sku } }))
  const t = useTransfer(leftItems.map((i) => i.id))
  const shownLeft = leftItems
    .filter((i) => !t.chosen.includes(i.id))
    .filter((i) => !lq.trim() || `${i.cells.name} ${i.cells.code}`.toLowerCase().includes(lq.trim().toLowerCase()))
    .filter((i) => {
      if (!applied) return true
      const v = (fCol === 'Product Code' ? i.cells.code : i.cells.name).toLowerCase()
      const q = applied.toLowerCase()
      return fOp === '=' ? v === q : fOp === 'START WITH' ? v.startsWith(q) : v.includes(q)
    })
  const head = mode === 'group' ? ['Group Name', 'Group Code'] : mode === 'location' ? ['Location', 'Code'] : mode === 'bin' ? ['Bin', 'Code'] : ['Product Name', 'Product Code']

  /** Products the user picked, expanded from groups / bins as needed. */
  const picked = (): Product[] => {
    if (opt('all') || t.chosen.length === 0) return filteredProducts
    if (mode === 'product') return products.filter((p) => t.chosen.includes(`p${p.id}`))
    if (mode === 'group') return products.filter((p) => t.chosen.includes(`g${p.categoryId}`))
    if (mode === 'bin') return products.filter((p) => t.chosen.includes(`b${p.location}`))
    return filteredProducts
  }

  const run = async (kind: 'statement' | 'bincard' | 'issue' | 'ledger') => {
    const list = picked()
    const ids = new Set(list.map((p) => p.id!))
    const fromTs = parseDmy(from) ?? 0
    const toTs = (parseDmy(to) ?? Date.now()) + 86_400_000
    const values = type === 'WITH VALUES' || opt('rate')
    if (kind === 'statement') {
      const moves = (await db.movements.toArray()).filter((m) => ids.has(m.productId))
      const rows = list.map((p) => {
        const mine = moves.filter((m) => m.productId === p.id)
        const after = mine.filter((m) => m.at >= toTs).reduce((s, m) => s + m.change, 0)
        const closing = p.stock - after
        const within = mine.filter((m) => m.at >= fromTs && m.at < toTs)
        const inQ = within.filter((m) => m.change > 0).reduce((s, m) => s + m.change, 0)
        const outQ = -within.filter((m) => m.change < 0).reduce((s, m) => s + m.change, 0)
        return {
          name: p.name,
          code: p.sku,
          loc: d.location,
          open: String(closing - inQ + outQ),
          in: String(inQ),
          out: String(outQ),
          close: String(closing),
          rate: amt(p.cost),
          value: amt(closing * p.cost),
        }
      })
      const cols = [C('name', 'Product Name', 240), C('code', 'Product Code', 100), C('loc', 'Location', 110), C('open', 'Opening', 70, 'right'), C('in', 'Receipts', 70, 'right'), C('out', 'Issues', 70, 'right'), C('close', 'Closing', 70, 'right'), ...(values ? [C('rate', 'Rate', 80, 'right'), C('value', 'Value', 100, 'right')] : [])]
      if (opt('summary') || opt('groupTotal')) {
        const totalClose = rows.reduce((s, r) => s + Number(r.close), 0)
        rows.push({ name: 'TOTAL', code: '', loc: '', open: '', in: '', out: '', close: String(totalClose), rate: '', value: amt(list.reduce((s, p) => s + p.stock * p.cost, 0)) })
      }
      setRes({ title: 'Stock Statement', cols, rows })
    } else if (kind === 'issue') {
      const sales = (await db.sales.where('createdAt').between(fromTs, toTs).toArray()).filter((s) => !s.refundOf)
      const rows = sales.flatMap((s) =>
        s.lines.filter((l) => l.productId !== undefined && ids.has(l.productId)).map((l) => ({ date: dmy(s.createdAt), doc: s.receiptNo, name: l.name, qty: String(l.qty), rate: amt(l.unitPrice), amount: amt(l.qty * l.unitPrice - l.discount) })),
      )
      setRes({ title: 'Issue Register', cols: [C('date', 'Date', 90), C('doc', 'Doc No', 110), C('name', 'Product Name', 260), C('qty', 'Qty', 60, 'right'), C('rate', 'Rate', 80, 'right'), C('amount', 'Amount', 100, 'right')], rows })
    } else {
      const moves = ((await db.movements.where('at').between(fromTs, toTs).toArray()) as StockMovement[]).filter((m) => ids.has(m.productId)).sort((a, b) => a.at - b.at)
      const byId = new Map(list.map((p) => [p.id!, p]))
      const bal = new Map<number, number>()
      const rows = moves.map((m) => {
        const p = byId.get(m.productId)!
        const b = (bal.get(m.productId) ?? 0) + m.change
        bal.set(m.productId, b)
        return {
          date: dmy(m.at),
          name: p.name,
          ref: m.reference ?? '',
          reason: m.reason.toUpperCase(),
          in: m.change > 0 ? String(m.change) : '',
          out: m.change < 0 ? String(-m.change) : '',
          bal: String(b),
          value: amt(Math.abs(m.change) * p.cost),
        }
      })
      const cols = [C('date', 'Date', 90), C('name', 'Product Name', 220), C('ref', 'Reference', 110), C('reason', 'Type', 80), C('in', 'In', 60, 'right'), C('out', 'Out', 60, 'right'), C('bal', 'Net', 60, 'right'), ...(kind === 'ledger' ? [C('value', 'Value', 90, 'right')] : [])]
      setRes({ title: kind === 'ledger' ? 'Stock Ledger' : 'Bin Card', cols, rows })
    }
    if (!list.length) toast('No products selected', 'error')
  }

  return (
    <Canvas height={540}>
      <Title x={512} y={22}>
        Stock Report
      </Title>
      <At x={14} y={46}>
        <Radio checked={mode === 'group'} onChange={() => setMode('group')}>
          Group
        </Radio>
      </At>
      <At x={86} y={46}>
        <Radio checked={mode === 'location'} onChange={() => setMode('location')}>
          Location
        </Radio>
      </At>
      <At x={14} y={65}>
        <Radio checked={mode === 'product'} onChange={() => setMode('product')}>
          Product
        </Radio>
      </At>
      <At x={86} y={65}>
        <Radio checked={mode === 'bin'} onChange={() => setMode('bin')}>
          Bin
        </Radio>
      </At>
      <At x={162} y={56}>
        <Select value={s1} onChange={setS1} options={['Select', ...cats.map((c) => c.name)]} width={143} plain />
      </At>
      <At x={313} y={56}>
        <Select value={s2} onChange={setS2} options={['Select', 'ACTIVE']} width={105} plain />
      </At>
      <At x={427} y={56}>
        <Select value={s3} onChange={setS3} options={['Select', 'STOCK ITEMS', 'ZERO STOCK', 'NEGATIVE STOCK']} width={105} plain />
      </At>
      <At x={545} y={56}>
        <L>From</L>
      </At>
      <At x={589} y={56}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={684} y={56}>
        <L>To</L>
      </At>
      <At x={713} y={56}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={825} y={56}>
        <L>Type</L>
      </At>
      <At x={867} y={56}>
        <Select value={type} onChange={setType} options={['WITHOUT VALUES', 'WITH VALUES']} width={140} />
      </At>

      <At x={16} y={76} top>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 27, marginBottom: 3 }}>
            <span className="ma-search" style={{ width: 74 }}>
              <span className="ma-search-ico">
                <SearchLens />
              </span>
              <input value={lq} onChange={(e) => setLq(e.target.value)} aria-label="Search" />
            </span>
            <Select value={fCol} onChange={setFCol} options={['Select', head[0], head[1]]} width={80} plain />
            <Select value={fOp} onChange={setFOp} options={['WHERE', '=', 'LIKE', 'START WITH']} width={68} />
            <Input value={fVal} onChange={setFVal} width={65} onEnter={() => setApplied(fVal)} />
            <IBtn title="Search" onClick={() => setApplied(fVal)}>
              <MagnifierIcon />
            </IBtn>
            <span style={{ marginLeft: 6 }}>|</span>
          </div>
          <Grid
            cols={[C('name', head[0], 180), C('code', head[1], 200)]}
            rows={shownLeft}
            width={383}
            height={362}
            selected={t.pickLeft}
            onSelect={(id) => t.setPickLeft(id as string)}
            onOpen={(id) => {
              t.setPickLeft(id as string)
              t.setChosen([...t.chosen, id as string])
            }}
          />
        </div>
      </At>
      <At x={434} y={199} center>
        <TransferArrows onRight={t.right} onLeft={t.left} />
      </At>
      <At x={434} y={318} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={16} />
      </At>
      <At x={470} y={76} top>
        <PickGrid
          cols={[C('name', head[0], 180), C('code', head[1], 107)]}
          items={leftItems.filter((i) => t.chosen.includes(i.id))}
          width={287}
          height={362}
          searchWidth={76}
          selected={t.pickRight}
          onSelect={(id) => t.setPickRight(id as string)}
          onOpen={(id) => t.setChosen(t.chosen.filter((c) => c !== id))}
        />
      </At>
      <At x={771} y={76} top>
        <PickGrid cols={[C('loc', 'Location', 218)]} items={d.locations.slice(0, 1).map((l) => ({ id: l, cells: { loc: l } }))} width={218} height={362} searchWidth={70} countGap={10} />
      </At>

      {(
        [
          ['code', 'Product Code', 37],
          ['all', 'All Products', 138],
          ['summary', 'Summary', 232],
          ['groupTotal', 'Group Total', 318],
          ['contra', 'ContraLocation', 409],
          ['rate', 'Rate', 519],
          ['consolidate', 'Consolidate', 575],
          ['gross', 'Gross/Net Weight', 667],
          ['batch', 'Batch', 797],
          ['lpr', 'Last Purchase Rate', 861],
        ] as const
      ).map(([k, label, x]) => (
        <At key={k} x={x} y={481}>
          <Check checked={opt(k)} onChange={setOpt(k)}>
            {label}
          </Check>
        </At>
      ))}
      {(
        [
          ['bin', 'BIN', 57],
          ['shelf', 'Shelf Life', 110],
          ['custom', 'Custom', 192],
          ['patient', 'Patient', 265],
        ] as const
      ).map(([k, label, x]) => (
        <At key={k} x={x} y={502}>
          <Check checked={opt(k)} onChange={setOpt(k)}>
            {label}
          </Check>
        </At>
      ))}
      <At x={333} y={502} style={{ gap: 9 }}>
        <Btn style={{ width: 84 }} onClick={() => run('bincard')}>
          Bin Card
        </Btn>
        <Btn style={{ width: 84 }} onClick={() => run('issue')}>
          Issue Reg
        </Btn>
        <Btn style={{ width: 84 }} onClick={() => run('ledger')}>
          Ledger
        </Btn>
        <Btn style={{ width: 84 }} onClick={() => run('statement')}>
          Statement
        </Btn>
        <Select value={none} onChange={setNone} options={['None', 'Product Wise', 'Group Wise']} width={115} plain />
        <Select value={batch} onChange={setBatch} options={['Without Batch', 'With Batch']} width={117} plain />
      </At>
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── Three-list layout (Reorder, ABC, MIS) ─────────────────────────────── */
type ProductTransfer = ReturnType<typeof useTransfer<number>>

/** Product picker state shared by a page and its ThreeLists. */
function useProductPicker() {
  const { rows } = useProductRows()
  const t = useTransfer(rows.map((r) => r.id))
  return { rows, t }
}

function ThreeLists({
  y,
  left,
  mid,
  right,
  arrowsX,
  arrowsY,
  height,
  widths,
  searchW,
  rightCount,
  rows,
  t,
}: {
  y: number
  left: number
  mid: number
  right: number
  arrowsX: number
  arrowsY: [number, number, number, number]
  height: number
  widths: [number, number, number]
  searchW: number
  rightCount?: boolean
  rows: { id: number; cells: Record<string, string> }[]
  t: ProductTransfer
}) {
  const d = useMedDefaults()
  return (
    <>
      <At x={left} y={y} top>
        <PickGrid
          cols={PRODUCT_COLS(150, widths[0] - 150)}
          items={rows.filter((r) => !t.chosen.includes(r.id))}
          width={widths[0]}
          height={height}
          searchWidth={searchW}
          countGap={searchW === 150 ? 10 : undefined}
          selected={t.pickLeft}
          onSelect={(id) => t.setPickLeft(id as number)}
          onOpen={(id) => t.setChosen([...t.chosen, id as number])}
        />
      </At>
      <At x={arrowsX} y={arrowsY[0]} center>
        <IBtn bare title="Move selected" onClick={t.right}>
          <TransferIcon dir="right" />
        </IBtn>
      </At>
      <At x={arrowsX} y={arrowsY[1]} center>
        <IBtn bare title="Remove selected" onClick={t.left}>
          <TransferIcon dir="left" />
        </IBtn>
      </At>
      <At x={arrowsX} y={(arrowsY[2] + arrowsY[3]) / 2} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={arrowsY[3] - arrowsY[2] - 36} />
      </At>
      <At x={mid} y={y} top>
        <PickGrid
          cols={PRODUCT_COLS(150, widths[1] - 150)}
          items={rows.filter((r) => t.chosen.includes(r.id))}
          width={widths[1]}
          height={height}
          searchWidth={searchW}
          countGap={searchW === 150 ? 10 : undefined}
          selected={t.pickRight}
          onSelect={(id) => t.setPickRight(id as number)}
          onOpen={(id) => t.setChosen(t.chosen.filter((c) => c !== id))}
        />
      </At>
      <At x={right} y={y} top>
        <PickGrid
          cols={[C('loc', 'Location', widths[2])]}
          items={rightCount ? d.locations.slice(0, 1).map((l) => ({ id: l, cells: { loc: l } })) : []}
          width={widths[2]}
          height={height}
          searchWidth={searchW}
          countGap={searchW === 150 ? 10 : undefined}
        />
      </At>
    </>
  )
}

function TransferIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <defs>
        <linearGradient id={`ma-ti-${dir}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc86b" />
          <stop offset=".5" stopColor="#ff9a2a" />
          <stop offset="1" stopColor="#ea7a0c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="20" height="20" rx="4" fill={`url(#ma-ti-${dir})`} stroke="#c56a08" />
      <g transform={dir === 'left' ? 'translate(22 0) scale(-1 1)' : undefined}>
        <path d="M5 9h6V5.5l6 5.5-6 5.5V13H5z" fill="#fff" />
      </g>
    </svg>
  )
}

async function salesByProduct(from: string, to: string): Promise<Map<number, { qty: number; value: number }>> {
  const sales = (await db.sales.toArray()).filter((s) => inRange(s.createdAt, from, to))
  const m = new Map<number, { qty: number; value: number }>()
  for (const s of sales)
    for (const l of s.lines) {
      if (l.productId === undefined) continue
      const cur = m.get(l.productId) ?? { qty: 0, value: 0 }
      cur.qty += l.qty
      cur.value += l.qty * l.unitPrice - l.discount
      m.set(l.productId, cur)
    }
  return m
}
/** Chosen products, or every stocked product when nothing was picked. */
async function pickedProducts(chosen: number[]): Promise<Product[]> {
  const all = await db.products.filter((p) => p.active && p.trackStock).toArray()
  return chosen.length ? all.filter((p) => chosen.includes(p.id!)) : all
}

/* ── Stock Reorder / EOQ ───────────────────────────────────────────────── */
function ReorderReport() {
  const cats = useCategories()
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [mode, setMode] = useState<'group' | 'product'>('group')
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('Select')
  const [res, setRes] = useState<Result | null>(null)
  const picker = useProductPicker()
  const view = async () => {
    const days = Math.max(1, Math.round(((parseDmy(to) ?? Date.now()) - (parseDmy(from) ?? Date.now())) / 86_400_000) + 1)
    const sold = await salesByProduct(from, to)
    const list = (await pickedProducts(picker.t.chosen)).filter((p) => !s1 || cats.find((c) => c.id === p.categoryId)?.name === s1)
    const rows = list
      .map((p) => {
        const q = sold.get(p.id!)?.qty ?? 0
        const avg = q / days
        const suggest = Math.max(0, Math.ceil(avg * 30) + p.reorderLevel - p.stock)
        return { name: p.name, code: p.sku, stock: String(p.stock), level: String(p.reorderLevel), sold: String(q), avg: avg.toFixed(2), eoq: String(suggest), n: suggest }
      })
      .filter((r) => s2 !== 'BELOW RE-ORDER' || Number(r.stock) <= Number(r.level))
      .sort((a, b) => b.n - a.n)
      .map(({ n: _n, ...r }) => r)
    setRes({
      title: 'Stock Reorder/EOQ Analysis',
      cols: [C('name', 'Product Name', 240), C('code', 'Product Code', 100), C('stock', 'Avl Qty', 70, 'right'), C('level', 'Re-Order Level', 100, 'right'), C('sold', 'Sold Qty', 70, 'right'), C('avg', 'Avg/Day', 70, 'right'), C('eoq', 'Order Qty (EOQ)', 110, 'right')],
      rows,
    })
  }
  return (
    <Canvas height={760}>
      <Title x={512} y={21}>
        Stock Reorder/EOQ Analysis
      </Title>
      <At x={16} y={71}>
        <L>From</L>
      </At>
      <At x={60} y={71}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={155} y={71}>
        <L>To</L>
      </At>
      <At x={184} y={71}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={12} y={118}>
        <Radio checked={mode === 'group'} onChange={() => setMode('group')}>
          Group
        </Radio>
      </At>
      <At x={75} y={118}>
        <Radio checked={mode === 'product'} onChange={() => setMode('product')}>
          Product
        </Radio>
      </At>
      <At x={149} y={118}>
        <Select value={s1} onChange={setS1} options={['', ...cats.map((c) => c.name)]} width={105} plain />
      </At>
      <At x={263} y={118}>
        <Select value={s2} onChange={setS2} options={['Select', 'BELOW RE-ORDER']} width={105} plain />
      </At>
      <At x={377} y={118}>
        <Btn onClick={view}>View</Btn>
      </At>
      <ThreeLists {...picker} y={137} left={16} mid={369} right={681} arrowsX={341} arrowsY={[363, 405, 457, 507]} height={562} widths={[297, 297, 297]} searchW={150} />
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── ABC Analysis ──────────────────────────────────────────────────────── */
function AbcAnalysis() {
  const [mode, setMode] = useState<'group' | 'product'>('group')
  const [asOn, setAsOn] = useState('')
  const [type, setType] = useState('LIFO VALUES')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [c, setC] = useState('')
  const [res, setRes] = useState<Result | null>(null)
  const picker = useProductPicker()
  const view = async () => {
    const pa = parseFloat(a) || 70
    const pb = parseFloat(b) || 20
    const sold = await salesByProduct('', asOn)
    const list = await pickedProducts(picker.t.chosen)
    const items = list.map((p) => ({ p, v: (sold.get(p.id!)?.qty ?? 0) * (type === 'AVERAGE VALUES' ? (p.cost + p.price) / 2 : type === 'FIFO VALUES' ? p.price : p.cost) })).sort((x, y) => y.v - x.v)
    const total = items.reduce((s, x) => s + x.v, 0) || 1
    let cum = 0
    const rows = items.map(({ p, v }) => {
      cum += v
      const pct = (cum / total) * 100
      return { name: p.name, code: p.sku, value: amt(v), pct: pct.toFixed(2), cls: pct <= pa ? 'A' : pct <= pa + pb ? 'B' : 'C' }
    })
    setRes({ title: `ABC Analysis (A ${pa}% / B ${pb}% / C ${parseFloat(c) || 100 - pa - pb}%)`, cols: [C('name', 'Product Name', 260), C('code', 'Product Code', 110), C('value', 'Consumption Value', 140, 'right'), C('pct', 'Cumulative %', 100, 'right'), C('cls', 'Class', 60)], rows })
  }
  return (
    <Canvas height={520}>
      <Title x={512} y={22}>
        ABC Analysis
      </Title>
      <At x={98} y={69}>
        <Radio checked={mode === 'group'} onChange={() => setMode('group')}>
          Group
        </Radio>
      </At>
      <At x={161} y={69}>
        <Radio checked={mode === 'product'} onChange={() => setMode('product')}>
          Product
        </Radio>
      </At>
      <At x={239} y={69}>
        <L>As On Date</L>
      </At>
      <At x={317} y={69}>
        <DateField value={asOn} onChange={setAsOn} />
      </At>
      <At x={424} y={69}>
        <L>Type</L>
      </At>
      <At x={466} y={69}>
        <Select value={type} onChange={setType} options={['LIFO VALUES', 'FIFO VALUES', 'AVERAGE VALUES']} width={141} />
      </At>
      <At x={100} y={99}>
        <L>A</L>
      </At>
      <At x={123} y={99}>
        <Input value={a} onChange={setA} width={100} />
      </At>
      <At x={242} y={99}>
        <L>B</L>
      </At>
      <At x={265} y={99}>
        <Input value={b} onChange={setB} width={100} />
      </At>
      <At x={384} y={99}>
        <L>C</L>
      </At>
      <At x={407} y={99}>
        <Input value={c} onChange={setC} width={100} />
      </At>
      <At x={515} y={99}>
        <Btn onClick={view}>View</Btn>
      </At>
      <ThreeLists {...picker} y={133} left={65} mid={397} right={684} arrowsX={361} arrowsY={[240, 282, 334, 384]} height={326} widths={[272, 272, 272]} searchW={70} />
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── Ageing Report ─────────────────────────────────────────────────────── */
function AgeingReport() {
  const d = useMedDefaults()
  const [periods, setPeriods] = useState(DEFAULT_PERIODS)
  const t = useTransfer(d.locations.slice(0, 1))
  const [res, setRes] = useState<Result | null>(null)
  return (
    <Canvas height={420}>
      <Title x={404} y={42}>
        Aging Report
      </Title>
      <At x={60} y={63} top>
        <PickGrid
          cols={[C('loc', 'Location', 225)]}
          items={t.available.map((l) => ({ id: l, cells: { loc: l } }))}
          width={225}
          height={270}
          countGap={18}
          selected={t.pickLeft}
          onSelect={(id) => t.setPickLeft(id as string)}
        />
      </At>
      <At x={312} y={169} center>
        <TransferArrows onRight={t.right} onLeft={t.left} gap={6} />
      </At>
      <At x={312} y={255} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={2} />
      </At>
      <At x={340} y={63} top>
        <PickGrid
          cols={[C('loc', 'Location', 219)]}
          items={t.chosen.map((l) => ({ id: l, cells: { loc: l } }))}
          width={219}
          height={270}
          countGap={14}
          selected={t.pickRight}
          onSelect={(id) => t.setPickRight(id as string)}
        />
      </At>
      <At x={571} y={63} top>
        <PeriodsEditor periods={periods} setPeriods={setPeriods} width={189} height={274} />
      </At>
      <At x={444} y={384} center>
        <Btn
          onClick={async () => {
            const r = await debtorAgeing(periods)
            setRes({ title: 'Aging Report', ...r })
          }}
        >
          View
        </Btn>
      </At>
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── Time Table Allocation ─────────────────────────────────────────────── */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PERIOD_X = [323, 396, 470, 543, 616, 689, 761, 833]
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']
type TT = { course: string; branch: string; year: string; section: string; faculty: string; subject: string; slots: string[] }

function TimeTable() {
  const toast = useToast()
  const saved = useKv<TT[]>('medapp:timetable', [])
  const staff = useLiveQuery(async () => (await db.users.toArray()).map((u) => u.name.toUpperCase()), [], [] as string[])
  const { locations } = useMedDefaults()
  const [tab, setTab] = useState<'assign' | 'view'>('assign')
  const [f, setF] = useState<Omit<TT, 'slots'>>({ course: '', branch: '', year: '', section: '', faculty: '', subject: '' })
  const [slots, setSlots] = useState<Set<string>>(new Set())
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })

  return (
    <Canvas height={540}>
      <At x={12} y={11} top style={{ gap: 4 }}>
        <button type="button" className={`ma-subtab is-white${tab === 'assign' ? ' is-active' : ''}`} onClick={() => setTab('assign')}>
          Assign Time Table
        </button>
        <button type="button" className={`ma-subtab${tab === 'view' ? ' is-active' : ''}`} onClick={() => setTab('view')}>
          View Time Table
        </button>
      </At>
      <div className="ma-box" style={{ position: 'absolute', left: 12, top: 34, width: 998, height: 488 }}>
        {tab === 'view' ? (
          <div style={{ padding: 12 }}>
            <Grid
              cols={[C('faculty', 'Faculty Name', 150), C('subject', 'Subject', 150), C('course', 'Course', 110), C('year', 'Year', 70), C('branch', 'Branch', 110), C('section', 'Section', 80), C('slots', 'Periods', 300)]}
              rows={saved.map((s, i) => ({ id: i, cells: { ...s, slots: s.slots.join(', ') } }))}
              height={440}
            />
          </div>
        ) : null}
      </div>
      {tab === 'assign' && (
        <>
          <Title x={512} y={57}>
            Assign Time Table
          </Title>
          {(
            [
              ['Select Course', 'course', 90],
              ['Select Year', 'year', 119],
              ['Faculty Name', 'faculty', 148],
            ] as const
          ).map(([label, k, y]) => (
            <At key={k} x={264} y={y} right>
              <L>{label}</L>
            </At>
          ))}
          <At x={279} y={90}>
            <LookupField value={f.course} onChange={set('course')} options={['PHARMACY', 'NURSING', 'LABORATORY']} />
          </At>
          <At x={279} y={119}>
            <LookupField value={f.year} onChange={set('year')} options={['YEAR 1', 'YEAR 2', 'YEAR 3']} />
          </At>
          <At x={279} y={148}>
            <LookupField value={f.faculty} onChange={set('faculty')} options={staff} />
          </At>
          {(
            [
              ['Select Branch', 'branch', 90],
              ['Select Section', 'section', 119],
              ['Subject', 'subject', 148],
            ] as const
          ).map(([label, k, y]) => (
            <At key={k} x={548} y={y} right>
              <L>{label}</L>
            </At>
          ))}
          <At x={563} y={90}>
            <LookupField value={f.branch} onChange={set('branch')} options={locations} />
          </At>
          <At x={563} y={119}>
            <LookupField value={f.section} onChange={set('section')} options={['A', 'B', 'C']} />
          </At>
          <At x={563} y={148}>
            <Input value={f.subject} onChange={set('subject')} width={178} />
          </At>
          <At x={749} y={148}>
            <Btn
              style={{ width: 62 }}
              onClick={async () => {
                if (!f.faculty || !f.subject) return toast('Faculty Name and Subject are required', 'error')
                await setKv('medapp:timetable', [...(await getKv<TT[]>('medapp:timetable', [])), { ...f, slots: [...slots] }])
                toast('Time table assigned')
                setSlots(new Set())
              }}
            >
              View
            </Btn>
          </At>
          <At x={158} y={192}>
            <L bold>Week Names/Periods</L>
          </At>
          {PERIOD_X.map((x, i) => (
            <At key={x} x={x} y={192} center>
              <L bold>{ORD[i]} Period</L>
            </At>
          ))}
          {DAYS.map((day, r) => (
            <div key={day}>
              <At x={158} y={217 + r * 25}>
                <L bold>{day}</L>
              </At>
              {PERIOD_X.map((x, i) => {
                const k = `${day} P${i + 1}`
                return (
                  <At key={x} x={x - 7} y={217 + r * 25}>
                    <Check
                      checked={slots.has(k)}
                      onChange={(v) => {
                        const n = new Set(slots)
                        if (v) n.add(k)
                        else n.delete(k)
                        setSlots(n)
                      }}
                    />
                  </At>
                )
              })}
            </div>
          ))}
        </>
      )}
    </Canvas>
  )
}

/* ── MIS Location-wise ─────────────────────────────────────────────────── */
function MisLocation() {
  const cats = useCategories()
  const [mode, setMode] = useState<'group' | 'sub' | 'product'>('sub')
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [compare, setCompare] = useState(false)
  const [cFrom, setCFrom] = useState(todayDmy())
  const [cTo, setCTo] = useState(todayDmy())
  const [chart, setChart] = useState('Column Chart')
  const [txn, setTxn] = useState('')
  const [s, setS] = useState('')
  const [res, setRes] = useState<Result | null>(null)
  const picker = useProductPicker()

  const build = async () => {
    const [a, b] = await Promise.all([salesByProduct(from, to), compare ? salesByProduct(cFrom, cTo) : Promise.resolve(new Map())])
    const list = await pickedProducts(picker.t.chosen)
    const key = (p: Product) => (mode === 'product' ? p.name : cats.find((c) => c.id === p.categoryId)?.name ?? 'UNGROUPED')
    const agg = new Map<string, { q: number; v: number; cq: number; cv: number }>()
    for (const p of list) {
      const k = key(p)
      const cur = agg.get(k) ?? { q: 0, v: 0, cq: 0, cv: 0 }
      cur.q += a.get(p.id!)?.qty ?? 0
      cur.v += a.get(p.id!)?.value ?? 0
      cur.cq += b.get(p.id!)?.qty ?? 0
      cur.cv += b.get(p.id!)?.value ?? 0
      agg.set(k, cur)
    }
    const entries = [...agg.entries()].filter(([, x]) => x.q || x.cq || mode !== 'product')
    const result: Result = {
      title: 'MIS Location-wise',
      cols: [C('k', mode === 'product' ? 'Product Name' : 'Group', 240), C('q', 'Qty', 70, 'right'), C('v', 'Value', 110, 'right'), ...(compare ? [C('cq', 'Compare Qty', 90, 'right'), C('cv', 'Compare Value', 110, 'right')] : [])],
      rows: entries.map(([k, x]) => ({ k, q: String(x.q), v: amt(x.v), cq: String(x.cq), cv: amt(x.cv) })),
      chart: entries.slice(0, 12).map(([k, x]) => ({ label: k, values: compare ? [x.v / 100, x.cv / 100] : [x.v / 100] })),
    }
    return result
  }
  return (
    <Canvas height={540}>
      <Title x={519} y={22}>
        MIS Location-wise
      </Title>
      <At x={178} y={64}>
        <Radio checked={mode === 'group'} onChange={() => setMode('group')}>
          Group
        </Radio>
      </At>
      <At x={243} y={64}>
        <Radio checked={mode === 'sub'} onChange={() => setMode('sub')}>
          Sub Group
        </Radio>
      </At>
      <At x={330} y={64}>
        <Radio checked={mode === 'product'} onChange={() => setMode('product')}>
          Product
        </Radio>
      </At>
      <At x={408} y={64}>
        <L>From</L>
      </At>
      <At x={451} y={64}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={546} y={64}>
        <L>To</L>
      </At>
      <At x={575} y={64}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={666} y={64} style={{ gap: 8 }}>
        <Btn onClick={async () => setRes(await build())}>View</Btn>
        <Btn
          onClick={async () => {
            const r = await build()
            setRes({ ...r, title: 'MIS Location-wise - Chart' })
          }}
        >
          Chart
        </Btn>
        <Select value={chart} onChange={setChart} options={['Column Chart', 'Line Chart']} width={104} plain />
      </At>
      <At x={295} y={102}>
        <Check checked={compare} onChange={setCompare}>
          Compare With
        </Check>
      </At>
      <At x={408} y={102}>
        <L>From</L>
      </At>
      <At x={451} y={102}>
        <DateField value={cFrom} onChange={setCFrom} />
      </At>
      <At x={546} y={102}>
        <L>To</L>
      </At>
      <At x={575} y={102}>
        <DateField value={cTo} onChange={setCTo} />
      </At>
      <At x={290} y={133}>
        <LookupField value={txn} onChange={setTxn} options={TXNS} title="Transaction" />
      </At>
      <At x={530} y={133}>
        <Select value={s} onChange={setS} options={['', 'QTY', 'VALUE']} width={142} />
      </At>
      <ThreeLists {...picker} y={150} left={16} mid={413} right={725} arrowsX={362} arrowsY={[265, 307, 359, 409]} height={344} widths={[297, 297, 285]} searchW={150} />
      {res && (
        <ResultDialog
          title={res.title}
          cols={res.cols}
          rows={res.rows}
          onClose={() => setRes(null)}
          extra={res.title.endsWith('Chart') ? <ColumnChart data={res.chart ?? []} width={700} height={300} type={chart} /> : undefined}
        />
      )}
    </Canvas>
  )
}

/* ── Price Comparison Statement ────────────────────────────────────────── */
function PriceComparison() {
  const [txn, setTxn] = useState('')
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const cols = [C('name', 'Product Name', 260), C('cost', 'Purchase Rate', 110, 'right'), C('price', 'Selling Rate', 110, 'right'), C('margin', 'Margin', 100, 'right'), C('pct', 'Margin %', 100, 'right')]
  const view = async () => {
    const ps = await db.products.filter((p) => p.active && p.trackStock).sortBy('name')
    setRows(ps.map((p) => ({ name: p.name, cost: amt(p.cost), price: amt(p.price), margin: amt(p.price - p.cost), pct: p.price ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : '0.0' })))
  }
  return (
    <Canvas height={520}>
      <Title x={512} y={22}>
        Price Comparison Statement
      </Title>
      <At x={303} y={53}>
        <L>Transaction</L>
      </At>
      <At x={377} y={56}>
        <LookupField value={txn} onChange={setTxn} options={['Local Purchase Order', 'Pur Inv/GRN', 'OTC Medicine Issued/Bill']} title="Transaction" />
      </At>
      <At x={563} y={56} style={{ gap: 8 }}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
        <Btn onClick={() => window.print()}>Print</Btn>
        <Btn
          onClick={() =>
            rows &&
            downloadCsv('Price-Comparison', cols.map((c) => c.label), rows.map((r) => cols.map((c) => r[c.key])))
          }
        >
          Export
        </Btn>
      </At>
      <div style={{ position: 'absolute', left: 130, top: 215, width: 762, height: 276, border: '1px solid #6b7a2a', background: '#fff', overflow: 'auto' }}>
        {rows ? (
          <Grid cols={cols} rows={rows.map((r, i) => ({ id: i, cells: r }))} style={{ border: 0 }} />
        ) : (
          <div style={{ height: 22, borderBottom: '1px solid #6b7a2a' }} />
        )}
      </div>
    </Canvas>
  )
}

/* ── Outstanding Report ────────────────────────────────────────────────── */
function OutstandingReport() {
  const parties = useLiveQuery(async () => (await db.customers.toArray()).map((c) => c.name.toUpperCase()).sort(), [], [] as string[])
  const [txn, setTxn] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayDmy())
  const [wise, setWise] = useState('Department wise')
  const [kind, setKind] = useState('Only Pending')
  const [third, setThird] = useState('')
  const [map, setMap] = useState('')
  const t = useTransfer(parties)
  const [res, setRes] = useState<Result | null>(null)
  const view = async () => {
    const chosen = new Set(t.chosen)
    const [cs, sales] = await Promise.all([db.customers.toArray(), db.sales.toArray()])
    const rows = cs
      .filter((c) => (chosen.size === 0 || chosen.has(c.name.toUpperCase())) && (kind !== 'Only Pending' || c.balance > 0))
      .flatMap((c) => {
        const mine = sales.filter((s) => s.customerId === c.id && s.payments.some((p) => p.method === 'account') && inRange(s.createdAt, from, to))
        if (kind === 'With Details')
          return mine.map((s) => ({ name: c.name.toUpperCase(), doc: s.receiptNo, date: dmy(s.createdAt), amount: amt(s.payments.filter((p) => p.method === 'account').reduce((x, p) => x + p.amount, 0)), os: amt(c.balance) }))
        return [{ name: c.name.toUpperCase(), doc: String(mine.length), date: mine.length ? dmy(Math.max(...mine.map((s) => s.createdAt))) : '', amount: amt(mine.reduce((x, s) => x + lineTotal(s), 0)), os: amt(c.balance) }]
      })
    setRes({
      title: `Outstanding Report - ${wise}`,
      cols: [C('name', 'Party Name', 240), C('doc', kind === 'With Details' ? 'Doc No' : 'No. Of Docs', 110), C('date', kind === 'With Details' ? 'Doc Date' : 'Last Doc Date', 100), C('amount', 'Bill Amount', 110, 'right'), C('os', 'Outstanding', 110, 'right')],
      rows,
    })
  }
  return (
    <Canvas height={560}>
      <Title x={604} y={42}>
        Outstanding Report
      </Title>
      <At x={56} y={72}>
        <L>OutStanding Report</L>
      </At>
      <At x={181} y={74}>
        <LookupField value={txn} onChange={setTxn} options={TXNS} title="Transaction" />
      </At>
      <At x={394} y={74}>
        <L>From Date</L>
      </At>
      <At x={467} y={74}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={562} y={74}>
        <L>To Date</L>
      </At>
      <At x={621} y={74}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={56} y={101}>
        <L>Select</L>
      </At>
      {(
        [
          ['Department wise', 105],
          ['DocNumber wise', 224],
          ['Date Wise', 344],
          ['Product Wise', 429],
          ['Party Wise', 529],
          ['None', 615],
        ] as const
      ).map(([label, x]) => (
        <At key={label} x={x} y={101}>
          <Radio checked={wise === label} onChange={() => setWise(label)}>
            {label}
          </Radio>
        </At>
      ))}
      <At x={56} y={127}>
        <L>Select</L>
      </At>
      {(
        [
          ['Only Pending', 105],
          ['Summary', 207],
          ['With Details', 292],
        ] as const
      ).map(([label, x]) => (
        <At key={label} x={x} y={127}>
          <Radio checked={kind === label} onChange={() => setKind(label)}>
            {label}
          </Radio>
        </At>
      ))}
      <At x={56} y={154}>
        <L>Third Transaction</L>
      </At>
      <At x={167} y={156}>
        <Select value={third} onChange={setThird} options={['', ...TXNS]} width={168} />
      </At>
      <At x={347} y={154}>
        <L>Mapping Field</L>
      </At>
      <At x={438} y={156}>
        <Select value={map} onChange={setMap} options={['', 'BILL NO', 'PARTY NAME']} width={160} />
      </At>
      <At x={626} y={156}>
        <Btn onClick={view}>View</Btn>
      </At>
      <At x={282} y={185} top>
        <PickGrid
          cols={[C('n', 'Party Name', 294)]}
          items={t.available.map((p) => ({ id: p, cells: { n: p } }))}
          width={294}
          height={325}
          searchWidth={80}
          selected={t.pickLeft}
          onSelect={(id) => t.setPickLeft(id as string)}
        />
      </At>
      <At x={599} y={319} center>
        <TransferArrows onRight={t.right} onLeft={t.left} gap={8} />
      </At>
      <At x={599} y={404} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={3} />
      </At>
      <At x={630} y={185} top>
        <PickGrid
          cols={[C('n', 'Selected Party Name', 294)]}
          items={t.chosen.map((p) => ({ id: p, cells: { n: p } }))}
          width={294}
          height={325}
          searchWidth={80}
          selected={t.pickRight}
          onSelect={(id) => t.setPickRight(id as string)}
        />
      </At>
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── Receivables Report ────────────────────────────────────────────────── */
function ReceivablesReport() {
  const d = useMedDefaults()
  const parties = useLiveQuery(async () => (await db.customers.toArray()).map((c) => c.name.toUpperCase()).sort(), [], [] as string[])
  const [txn, setTxn] = useState('')
  const [asOn, setAsOn] = useState(todayDmy())
  const [loc, setLoc] = useState<string | number>(d.locations[0])
  const [mode, setMode] = useState('summary')
  const [status, setStatus] = useState(false)
  const [osKind, setOsKind] = useState('')
  const [periods, setPeriods] = useState(DEFAULT_PERIODS)
  const t = useTransfer(parties)
  const [res, setRes] = useState<Result | null>(null)
  return (
    <Canvas height={740}>
      <Title x={511} y={22}>
        Receivables Report
      </Title>
      <At x={166} y={68} right>
        <L>Select Transaction</L>
      </At>
      <At x={181} y={70}>
        <LookupField value={txn} onChange={setTxn} options={TXNS} title="Transaction" />
      </At>
      <At x={370} y={68}>
        <L>As On</L>
      </At>
      <At x={414} y={70}>
        <DateField value={asOn} onChange={setAsOn} />
      </At>
      <At x={166} y={101} right>
        <L>Select Location</L>
      </At>
      <At x={184} y={90} top>
        <PickGrid cols={[C('l', 'Location', 244)]} items={d.locations.slice(0, 1).map((l) => ({ id: l, cells: { l } }))} width={244} height={166} countGap={36} selected={loc} onSelect={setLoc} />
      </At>
      <At x={439} y={104}>
        <Btn
          onClick={async () => {
            const r = await debtorAgeing(periods, new Set(t.chosen))
            setRes({ title: `Receivables Report - As On ${asOn}${status ? ' (with status)' : ''}`, ...r })
          }}
        >
          View
        </Btn>
      </At>
      <At x={166} y={311} right>
        <L>OutStanding Report</L>
      </At>
      <At x={181} y={311}>
        <Radio checked={mode === 'summary'} onChange={() => setMode('summary')}>
          Show Summary Report
        </Radio>
      </At>
      <At x={337} y={311}>
        <L>(</L>
      </At>
      <At x={363} y={311}>
        <Check checked={status} onChange={setStatus}>
          Status
        </Check>
      </At>
      <At x={432} y={311}>
        <L>)</L>
      </At>
      <At x={181} y={337}>
        <Radio checked={mode === 'installment'} onChange={() => setMode('installment')}>
          Show Installment wise
        </Radio>
      </At>
      <At x={181} y={366}>
        <Radio checked={mode === 'os'} onChange={() => setMode('os')}>
          Show OS Report
        </Radio>
      </At>
      <At x={299} y={366}>
        <L>(</L>
      </At>
      {(
        [
          ['All', 325],
          ['UnAdjusted', 371],
          ['Partially Adjusted', 463],
          ['All With Details', 586],
        ] as const
      ).map(([label, x]) => (
        <At key={label} x={x} y={366}>
          <Radio checked={osKind === label} onChange={() => setOsKind(label)}>
            {label}
          </Radio>
        </At>
      ))}
      <At x={699} y={366}>
        <L>)</L>
      </At>
      <At x={47} y={398} top>
        <PickGrid cols={[C('n', 'Customer Name', 244)]} items={t.available.map((p) => ({ id: p, cells: { n: p } }))} width={244} height={290} countGap={36} selected={t.pickLeft} onSelect={(id) => t.setPickLeft(id as string)} />
      </At>
      <At x={329} y={510} center>
        <TransferArrows onRight={t.right} onLeft={t.left} gap={20} />
      </At>
      <At x={329} y={606} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={11} />
      </At>
      <At x={368} y={398} top>
        <PickGrid cols={[C('n', 'Customer Name', 244)]} items={t.chosen.map((p) => ({ id: p, cells: { n: p } }))} width={244} height={290} countGap={36} selected={t.pickRight} onSelect={(id) => t.setPickRight(id as string)} />
      </At>
      <At x={623} y={398} top>
        <PeriodsEditor periods={periods} setPeriods={setPeriods} width={206} height={292} />
      </At>
      {res && <ResultDialog title={res.title} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

