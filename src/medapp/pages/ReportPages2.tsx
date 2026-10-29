import { useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { LogEntry, Product } from '../../db/types'
import { useToast } from '../../components/ui'
import { downloadCsv, parseCsv } from '../../lib/csv'
import { amt, dmy, getKv, inRange, parseDmy, payableBy, setKv, todayDmy, useCustomerMap, useKv, useMedDefaults } from '../data'
import { ApproveSheetIcon, EditDocIcon, OpenFolderIcon } from '../icons'
import { Btn, Check, DateField, Dialog, Grid, IBtn, Input, LookupField, Radio, Rows, SearchBar, Select, TransferArrows, matches, useTransfer, type Col } from '../ui'
import { At, Canvas, L, Title } from './layout'
import { C, DEFAULT_PERIODS, PeriodsEditor, PickGrid, ResultDialog, useProductRows } from './reportKit'

type Cells = Record<string, ReactNode>
const text = (c: Cells) => Object.values(c).map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))

/** Search bar + rows count + grid spanning the panel width. */
function ResultBlock({
  y,
  x = 16,
  width = 991,
  searchWidth = 450,
  height,
  cols,
  rows,
  onOpen,
}: {
  y: number
  x?: number
  width?: number
  searchWidth?: number
  height: number
  cols: Col[]
  rows: Cells[]
  onOpen?: (i: number) => void
}) {
  const [q, setQ] = useState('')
  const shown = rows.map((r, i) => ({ id: i, cells: r })).filter((r) => matches(q, ...text(r.cells)))
  return (
    <At x={x} y={y} top>
      <div style={{ width }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
          <SearchBar value={q} onChange={setQ} width={searchWidth} />
          <span style={{ marginLeft: 'auto', marginRight: 28 }}>
            <Rows n={shown.length} />
          </span>
        </div>
        <Grid cols={cols} rows={shown} height={height} onOpen={(id) => onOpen?.(id as number)} />
      </div>
    </At>
  )
}

function exportRows(name: string, cols: Col[], rows: Cells[]) {
  downloadCsv(name, cols.map((c) => c.label), rows.map((r) => cols.map((c) => (typeof r[c.key] === 'string' || typeof r[c.key] === 'number' ? String(r[c.key]) : ''))))
}

function Thumb({ src, label }: { src?: string; label: string }) {
  return src ? (
    <img src={src} alt="" style={{ width: 22, height: 22, objectFit: 'cover', verticalAlign: 'middle', border: '1px solid #ccc' }} />
  ) : (
    <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', background: '#e4f1fc', border: '1px solid #9fc3e6', fontSize: 10, fontWeight: 'bold', color: '#1d5ea8' }}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

/* ── Payables Report ───────────────────────────────────────────────────── */
export function PayablesReport() {
  const toast = useToast()
  const d = useMedDefaults()
  const parties = useLiveQuery(async () => (await db.suppliers.toArray()).map((s) => s.name.toUpperCase()).sort(), [], [] as string[])
  const [txn, setTxn] = useState('')
  const [asOn, setAsOn] = useState(todayDmy())
  const [loc, setLoc] = useState('')
  const [inst, setInst] = useState(true)
  const [summary, setSummary] = useState(false)
  const [os, setOs] = useState(false)
  const [osKind, setOsKind] = useState('')
  const [periods, setPeriods] = useState(DEFAULT_PERIODS)
  const t = useTransfer(parties)
  const [res, setRes] = useState<{ cols: Col[]; rows: Record<string, string>[] } | null>(null)

  const view = async () => {
    const [sups, pos] = await Promise.all([db.suppliers.toArray(), db.purchaseOrders.toArray()])
    const asOnTs = (parseDmy(asOn) ?? Date.now()) + 86_400_000
    const ps = periods.map((p) => p.split('-').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
    const chosen = new Set(t.chosen)
    const rows = sups
      .filter((s) => chosen.size === 0 || chosen.has(s.name.toUpperCase()))
      .map((s) => {
        const r: Record<string, string> = { name: s.name.toUpperCase() }
        let total = 0
        const sums = ps.map(() => 0)
        for (const p of pos.filter((x) => x.supplierId === s.id && x.status !== 'cancelled' && x.status !== 'draft' && x.createdAt < asOnTs)) {
          const v = p.lines.reduce((u, l) => u + l.received * l.unitCost, 0)
          const age = Math.floor((asOnTs - p.createdAt) / 86_400_000)
          const i = ps.findIndex(([lo, hi]) => age >= lo && age <= hi)
          if (i >= 0) sums[i] += v
          total += v
        }
        ps.forEach((_, i) => (r[`p${i}`] = sums[i] ? amt(sums[i]) : ''))
        r.total = amt(total)
        return { r, total }
      })
      .filter((x) => x.total > 0 || chosen.size > 0)
      .map((x) => x.r)
    if (!rows.length) toast('No payables found', 'error')
    setRes({ cols: [C('name', 'Supplier Name', 240), ...periods.map((p, i) => C(`p${i}`, p, 85, 'right')), C('total', 'Total', 100, 'right')], rows })
  }

  return (
    <Canvas height={600}>
      <Title x={512} y={21}>
        Payables Report
      </Title>
      <At x={167} y={67} right>
        <L>Select Transaction</L>
      </At>
      <At x={182} y={69}>
        <LookupField value={txn} onChange={setTxn} options={['Local Purchase Order', 'Pur Inv/GRN', 'Payment Voucher']} title="Transaction" />
      </At>
      <At x={371} y={67}>
        <L>As On</L>
      </At>
      <At x={415} y={69}>
        <DateField value={asOn} onChange={setAsOn} />
      </At>
      <At x={506} y={69}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
      </At>
      <At x={167} y={100} right>
        <L>Select Location</L>
      </At>
      <At x={182} y={102}>
        <LookupField value={loc} onChange={setLoc} options={d.locations} title="Location" />
      </At>
      <At x={369} y={100}>
        <Check checked={inst} onChange={setInst}>
          Show Installment wise
        </Check>
      </At>
      <At x={519} y={100}>
        <Check checked={summary} onChange={setSummary}>
          Show Summary Report
        </Check>
      </At>
      <At x={167} y={133} right>
        <L>OutStanding Report</L>
      </At>
      <At x={182} y={133}>
        <Check checked={os} onChange={setOs}>
          Show OS Report
        </Check>
      </At>
      <At x={300} y={133}>
        <L>(</L>
      </At>
      {(
        [
          ['All', 326],
          ['UnAdjusted', 372],
          ['Partially Adjusted', 465],
        ] as const
      ).map(([label, x]) => (
        <At key={label} x={x} y={133}>
          <Radio checked={osKind === label} onChange={() => setOsKind(label)}>
            {label}
          </Radio>
        </At>
      ))}
      <At x={590} y={133}>
        <L>)</L>
      </At>
      <At x={40} y={166} top>
        <PickGrid cols={[C('n', 'Customer Name', 244)]} items={t.available.map((p) => ({ id: p, cells: { n: p } }))} width={244} height={357} countGap={36} selected={t.pickLeft} onSelect={(id) => t.setPickLeft(id as string)} />
      </At>
      <At x={323} y={309} center>
        <TransferArrows onRight={t.right} onLeft={t.left} gap={20} />
      </At>
      <At x={323} y={407} center>
        <TransferArrows onAllRight={t.allRight} onAllLeft={t.allLeft} gap={15} />
      </At>
      <At x={362} y={166} top>
        <PickGrid cols={[C('n', 'Customer Name', 244)]} items={t.chosen.map((p) => ({ id: p, cells: { n: p } }))} width={244} height={357} countGap={36} selected={t.pickRight} onSelect={(id) => t.setPickRight(id as string)} />
      </At>
      <At x={617} y={166} top>
        <PeriodsEditor periods={periods} setPeriods={setPeriods} width={250} height={361} />
      </At>
      {res && <ResultDialog title={`Payables Report - As On ${asOn}`} cols={res.cols} rows={res.rows} onClose={() => setRes(null)} />}
    </Canvas>
  )
}

/* ── Non-Compliance Report ─────────────────────────────────────────────── */
export function NonComplianceReport() {
  const [sel, setSel] = useState('Select')
  const [rows, setRows] = useState<Cells[]>([])
  const cols = [C('name', 'Customer Name', 130), C('seg', 'Segment Type', 100), C('pending', 'Pending Document', 760)]
  const view = async () => {
    const [cs, sales] = await Promise.all([db.customers.toArray(), db.sales.toArray()])
    const out: Cells[] = []
    if (sel !== 'SUPPLIERS')
      for (const c of cs) {
        const over = c.creditLimit > 0 && c.balance > c.creditLimit
        const docs = sales.filter((s) => s.customerId === c.id && s.payments.some((p) => p.method === 'account'))
        if (over || (c.balance > 0 && c.creditLimit === 0))
          out.push({
            name: c.name.toUpperCase(),
            seg: over ? 'CREDIT LIMIT' : 'NO CREDIT LIMIT',
            pending: `${docs.map((s) => s.receiptNo).join(', ') || '-'}  (Outstanding ${amt(c.balance)}${over ? ` / Limit ${amt(c.creditLimit)}` : ''})`,
          })
      }
    if (sel !== 'CUSTOMER') {
      const [pos, sups] = await Promise.all([db.purchaseOrders.toArray(), db.suppliers.toArray()])
      for (const p of pos.filter((x) => (x.status === 'ordered' || x.status === 'partial') && Date.now() - x.createdAt > 14 * 86_400_000)) {
        out.push({ name: (sups.find((s) => s.id === p.supplierId)?.name ?? 'SUPPLIER').toUpperCase(), seg: 'LPO PENDING', pending: `${p.poNo} raised ${dmy(p.createdAt)} not fully received` })
      }
    }
    setRows(out)
  }
  return (
    <Canvas height={640}>
      <Title x={512} y={22}>
        Non-Compliance Report
      </Title>
      <At x={348} y={54} style={{ gap: 8 }}>
        <Select value={sel} onChange={setSel} options={['Select', 'CUSTOMER', 'SUPPLIERS']} width={72} plain />
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
        <Btn style={{ width: 44 }} onClick={() => window.print()}>
          Print
        </Btn>
        <Btn style={{ width: 52 }} onClick={() => exportRows('Non-Compliance', cols, rows)}>
          Export
        </Btn>
        <Btn style={{ width: 81 }} onClick={() => window.print()}>
          Direct Print
        </Btn>
      </At>
      <ResultBlock y={74} height={412} cols={cols} rows={rows} />
    </Canvas>
  )
}

/* ── Annexure Reports ──────────────────────────────────────────────────── */
export function AnnexureReport() {
  const [mode, setMode] = useState<'unit' | 'dept'>('unit')
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [res, setRes] = useState<{ cols: Col[]; rows: Cells[] } | null>(null)
  const view = async () => {
    const [ps, cats] = await Promise.all([db.products.filter((p) => p.active).sortBy('name'), db.categories.toArray()])
    if (mode === 'unit') {
      setRes({
        cols: [C('img', 'Image', 100), C('name', 'Product Name', 300), C('code', 'Product Code', 120), C('rate', 'Unit Rate', 120, 'right'), C('updated', 'Last Updated', 340)],
        rows: (ps as Product[]).filter((p) => inRange(p.updatedAt, '', to)).map((p) => ({ img: <Thumb src={p.image} label={p.name} />, name: p.name, code: p.sku, rate: amt(p.price), updated: dmy(p.updatedAt) })),
      })
    } else {
      const sales = (await db.sales.toArray()).filter((s) => inRange(s.createdAt, from, to))
      const val = new Map<number | undefined, number>()
      const byId = new Map(ps.map((p) => [p.id!, p]))
      for (const s of sales) for (const l of s.lines) if (l.productId !== undefined) val.set(byId.get(l.productId)?.categoryId, (val.get(byId.get(l.productId)?.categoryId) ?? 0) + l.qty * l.unitPrice - l.discount)
      setRes({
        cols: [C('img', 'Image', 100), C('dept', 'Department', 300), C('items', 'Items', 100, 'right'), C('sales', 'Sales Value', 140, 'right'), C('stock', 'Stock Value', 340, 'right')],
        rows: [...cats, { id: undefined, name: 'UNGROUPED', color: '#999' }].map((c) => ({
          img: <span style={{ display: 'inline-block', width: 14, height: 14, background: c.color, border: '1px solid #999' }} />,
          dept: c.name.toUpperCase(),
          items: String(ps.filter((p) => p.categoryId === c.id).length),
          sales: amt(val.get(c.id) ?? 0),
          stock: amt(ps.filter((p) => p.categoryId === c.id && p.trackStock).reduce((s, p) => s + p.stock * p.cost, 0)),
        })),
      })
    }
  }
  const cols = res?.cols ?? [C('img', 'Image', 100), C('_', '', 886)]
  return (
    <Canvas height={900}>
      <Title x={512} y={25}>
        Annexure&nbsp; Reports
      </Title>
      <At x={26} y={54}>
        <Radio checked={mode === 'unit'} onChange={() => setMode('unit')}>
          Unit Rate
        </Radio>
      </At>
      <At x={109} y={54}>
        <Radio checked={mode === 'dept'} onChange={() => setMode('dept')}>
          Dept Wise
        </Radio>
      </At>
      <At x={196} y={54}>
        <L>From</L>
      </At>
      <At x={240} y={54}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={335} y={54}>
        <L>To</L>
      </At>
      <At x={364} y={54}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={466} y={54} style={{ gap: 8 }}>
        <Btn style={{ width: 60 }} onClick={view}>
          View
        </Btn>
        <Btn style={{ width: 60 }} onClick={() => window.print()}>
          Print
        </Btn>
        <Btn style={{ width: 60 }} onClick={() => res && exportRows('Annexure', res.cols, res.rows)}>
          Export
        </Btn>
      </At>
      <ResultBlock y={70} x={18} width={986} searchWidth={447} height={686} cols={cols} rows={res?.rows ?? []} />
    </Canvas>
  )
}

/* ── BRS Report ────────────────────────────────────────────────────────── */
type BrsRow = { type: string; cheque: string; date: string; dr: string; cr: string; bank: string }
export function BrsReport() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [bank, setBank] = useState('----Select----')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const stored = useKv<BrsRow[]>('medapp:brs', [])
  const [rows, setRows] = useState<Cells[]>([])
  const cols = [C('type', 'Types Of', 100), C('cheque', 'Cheque No', 100), C('date', 'Cheque Date', 100), C('dr', 'Dr', 100, 'right'), C('cr', 'Cr', 590)]
  const upload = async () => {
    if (!file) return toast('Choose an Excel (CSV) file first', 'error')
    const data = parseCsv(await file.text())
    const body = data[0] && /type/i.test(data[0][0] ?? '') ? data.slice(1) : data
    const parsed: BrsRow[] = body.map((r) => ({ type: r[0] ?? '', cheque: r[1] ?? '', date: r[2] ?? '', dr: r[3] ?? '', cr: r[4] ?? '', bank: bank === '----Select----' ? '' : bank }))
    await setKv('medapp:brs', [...stored, ...parsed])
    toast(`${parsed.length} statement lines uploaded`)
  }
  const view = () =>
    setRows(
      stored
        .filter((r) => bank === '----Select----' || r.bank === bank)
        .filter((r) => {
          const ts = parseDmy(r.date.replace(/\./g, '/'))
          return ts === undefined || inRange(ts, from, to)
        })
        .map((r) => ({ ...r })),
    )
  return (
    <Canvas height={780}>
      <Title x={512} y={22}>
        BRS Report
      </Title>
      <At x={342} y={54}>
        <L>Excel File</L>
      </At>
      <At x={409} y={57} style={{ gap: 2 }}>
        <Input value={file?.name ?? ''} readOnly width={160} />
        <IBtn title="Browse" style={{ width: 24, height: 22, borderRadius: 5 }} onClick={() => fileRef.current?.click()}>
          <OpenFolderIcon />
        </IBtn>
        <IBtn title="Clear" style={{ width: 24, height: 22, borderRadius: 5 }} onClick={() => setFile(null)}>
          <EditDocIcon />
        </IBtn>
        <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </At>
      <At x={629} y={57}>
        <Btn style={{ width: 54 }} onClick={upload}>
          Upload
        </Btn>
      </At>
      <At x={264} y={90}>
        <L>Bank Name</L>
      </At>
      <At x={343} y={91}>
        <Select value={bank} onChange={setBank} options={['----Select----', 'MPESA', 'EQUITY BANK', 'KCB BANK', 'CO-OP BANK']} width={102} plain round />
      </At>
      <At x={458} y={90}>
        <L>From</L>
      </At>
      <At x={502} y={91}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={597} y={90}>
        <L>To</L>
      </At>
      <At x={626} y={91}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={717} y={91}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
      </At>
      <ResultBlock y={113} height={618} cols={cols} rows={rows} />
    </Canvas>
  )
}

/* ── Audit Trail Report ────────────────────────────────────────────────── */
export function AuditTrailReport() {
  const users = useLiveQuery(async () => (await db.users.toArray()).map((u) => u.name.toUpperCase()), [], [] as string[])
  const [user, setUser] = useState('')
  const [txn, setTxn] = useState('')
  const [op, setOp] = useState('Select')
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [rows, setRows] = useState<Cells[] | null>(null)
  const cols = rows
    ? [C('img', 'Image', 100), C('date', 'Date', 90), C('time', 'Time', 70), C('user', 'User Name', 120), C('op', 'Operation', 90), C('action', 'Transaction', 180), C('detail', 'Details', 240)]
    : [C('img', 'Image', 100), C('_', '', 790)]
  const view = async () => {
    const logs = (await db.logs.orderBy('at').reverse().toArray()) as LogEntry[]
    setRows(
      logs
        .filter((l) => inRange(l.at, from, to))
        .filter((l) => !user || (l.userName ?? '').toUpperCase() === user)
        .filter((l) => !txn || l.action.toLowerCase().includes(txn.toLowerCase()))
        .filter((l) => op === 'Select' || l.kind.toUpperCase() === op)
        .map((l) => ({
          img: <Thumb label={l.userName ?? 'S'} />,
          date: dmy(l.at),
          time: new Date(l.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          user: (l.userName ?? 'SYSTEM').toUpperCase(),
          op: l.kind.toUpperCase(),
          action: l.action,
          detail: l.detail ?? '',
        })),
    )
  }
  return (
    <Canvas height={560}>
      <Title x={488} y={32}>
        Audit Trail Report
      </Title>
      <At x={24} y={68}>
        <L>Select User</L>
      </At>
      <At x={99} y={70}>
        <LookupField value={user} onChange={setUser} options={users} title="User" />
      </At>
      <At x={280} y={68}>
        <L>Transaction</L>
      </At>
      <At x={357} y={70}>
        <LookupField value={txn} onChange={setTxn} options={['Signed in', 'Till locked', 'Sale', 'Refund', 'Settings updated', 'Shift']} title="Transaction" />
      </At>
      <At x={545} y={68}>
        <L>Select Operation</L>
      </At>
      <At x={640} y={70}>
        <Select value={op} onChange={setOp} options={['Select', 'AUTH', 'SALE', 'STOCK', 'SHIFT', 'SETTINGS', 'USER', 'SYSTEM']} width={138} plain />
      </At>
      <At x={24} y={105}>
        <L>From Date</L>
      </At>
      <At x={99} y={105}>
        <DateField value={from} onChange={setFrom} width={76} />
      </At>
      <At x={204} y={105}>
        <L>To Date</L>
      </At>
      <At x={252} y={105}>
        <DateField value={to} onChange={setTo} width={76} />
      </At>
      <At x={370} y={105} style={{ gap: 12 }}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
        <Btn style={{ width: 44 }} onClick={() => window.print()}>
          Print
        </Btn>
        <Btn style={{ width: 52 }} onClick={() => rows && exportRows('Audit-Trail', cols, rows)}>
          Export
        </Btn>
      </At>
      <ResultBlock y={137} x={25} width={892} searchWidth={403} height={346} cols={cols} rows={rows ?? []} />
    </Canvas>
  )
}

/* ── Exception Report ──────────────────────────────────────────────────── */
export function ExceptionReport() {
  const toast = useToast()
  const [kind, setKind] = useState('')
  const [rows, setRows] = useState<Cells[]>([])
  const cols = [C('doc', 'Doc No', 150), C('dt', 'Doc Dt', 150), C('txn', 'Transaction', 690)]
  const view = async () => {
    if (!kind) return toast('Select an exception type', 'error')
    const out: Cells[] = []
    if (kind === 'Stock') {
      for (const p of await db.products.filter((x) => x.trackStock && x.stock < 0).toArray()) out.push({ doc: p.sku, dt: dmy(p.updatedAt), txn: `NEGATIVE STOCK - ${p.name} (${p.stock})` })
    } else if (kind === 'Accounts') {
      for (const s of await db.sales.toArray()) {
        const paid = s.payments.reduce((t, p) => t + p.amount, 0) - s.change
        if (Math.abs(paid - s.total) > 1) out.push({ doc: s.receiptNo, dt: dmy(s.createdAt), txn: `PAYMENT MISMATCH - billed ${amt(s.total)}, received ${amt(paid)}` })
        if (s.payments.some((p) => p.method === 'account') && s.customerId === undefined) out.push({ doc: s.receiptNo, dt: dmy(s.createdAt), txn: 'CREDIT SALE WITHOUT PARTY' })
      }
    } else if (kind === 'Link') {
      const sales = await db.sales.toArray()
      const ids = new Set(sales.map((s) => s.id))
      for (const s of sales.filter((x) => x.refundOf !== undefined && !ids.has(x.refundOf))) out.push({ doc: s.receiptNo, dt: dmy(s.createdAt), txn: 'RETURN WITHOUT ORIGINAL BILL' })
      for (const j of await db.jobs.filter((x) => x.status === 'collected' && x.saleId === undefined).toArray()) out.push({ doc: j.jobNo, dt: dmy(j.updatedAt), txn: 'SERVICE COLLECTED WITHOUT BILL' })
    } else if (kind === 'Receivables') {
      for (const c of await db.customers.filter((x) => x.creditLimit > 0 && x.balance > x.creditLimit).toArray()) out.push({ doc: `PTY${String(c.id).padStart(4, '0')}`, dt: dmy(c.createdAt), txn: `CREDIT LIMIT EXCEEDED - ${c.name.toUpperCase()} ${amt(c.balance)} / ${amt(c.creditLimit)}` })
    } else if (kind === 'Payables') {
      for (const p of await db.purchaseOrders.filter((x) => x.status === 'partial').toArray()) out.push({ doc: p.poNo, dt: dmy(p.createdAt), txn: 'LPO PARTIALLY RECEIVED' })
    }
    setRows(out)
  }
  return (
    <Canvas height={600}>
      <Title x={512} y={22}>
        Exception Report
      </Title>
      {(
        [
          ['Accounts', 12],
          ['Stock', 90],
          ['Link', 152],
          ['Receivables', 207],
          ['Payables', 298],
        ] as const
      ).map(([label, x]) => (
        <At key={label} x={x} y={53}>
          <Radio checked={kind === label} onChange={() => setKind(label)}>
            {label}
          </Radio>
        </At>
      ))}
      <At x={410} y={55}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
      </At>
      <ResultBlock y={73} height={390} cols={cols} rows={rows} />
      <At x={12} y={537} top>
        <IBtn lg title="Mark Reviewed" style={{ width: 32, height: 32 }} onClick={() => toast(rows.length ? `${rows.length} exception(s) reviewed` : 'Nothing to review')}>
          <ApproveSheetIcon />
        </IBtn>
      </At>
    </Canvas>
  )
}

/* ── Ancillary party stock ledger ──────────────────────────────────────── */
const ACCOUNT_PARTIES = ['CASH PAYING OUTPATIENT - PAY NOW', 'CASH COLLECTION ACCOUNT', 'CHEQUE COLLECTION ACCOUNT', 'MPESA COLLECTION ACCOUNT', 'CREDIT CARD COLLECTION ACCOUNT']

export function AncillaryLedger() {
  const customers = useCustomerMap()
  const extra = useLiveQuery(async () => [...(await db.customers.toArray()), ...(await db.suppliers.toArray())].map((p) => p.name.toUpperCase()), [], [] as string[])
  const parties = [...ACCOUNT_PARTIES, ...extra]
  const { rows: prodRows } = useProductRows()
  const tp = useTransfer(prodRows.map((r) => r.id))
  const tq = useTransfer(parties)
  const [from, setFrom] = useState(todayDmy())
  const [to, setTo] = useState(todayDmy())
  const [res, setRes] = useState<Record<string, string>[] | null>(null)
  const view = async () => {
    const sales = (await db.sales.toArray()).filter((s) => inRange(s.createdAt, from, to))
    const prods = new Set(tp.chosen)
    const pts = new Set(tq.chosen)
    setRes(
      sales.flatMap((s) => {
        const party = payableBy(s, customers)
        if (pts.size && !pts.has(party)) return []
        return s.lines
          .filter((l) => !prods.size || (l.productId !== undefined && prods.has(l.productId)))
          .map((l) => ({ date: dmy(s.createdAt), doc: s.receiptNo, party, name: l.name, qty: String(l.qty), rate: amt(l.unitPrice), amount: amt(l.qty * l.unitPrice - l.discount) }))
      }),
    )
  }
  return (
    <Canvas height={700}>
      <Title x={512} y={22}>
        Ancillary party stock ledger
      </Title>
      <At x={16} y={54}>
        <L>From</L>
      </At>
      <At x={60} y={54}>
        <DateField value={from} onChange={setFrom} />
      </At>
      <At x={155} y={54}>
        <L>To</L>
      </At>
      <At x={184} y={54}>
        <DateField value={to} onChange={setTo} />
      </At>
      <At x={275} y={54}>
        <Btn style={{ width: 44 }} onClick={view}>
          View
        </Btn>
      </At>
      <At x={16} y={73} top>
        <PickGrid cols={[C('name', 'Product Name', 370)]} items={prodRows.filter((r) => !tp.chosen.includes(r.id))} width={370} height={312} searchWidth={120} selected={tp.pickLeft} onSelect={(id) => tp.setPickLeft(id as number)} />
      </At>
      <At x={405} y={198} center>
        <TransferArrows onRight={tp.right} onLeft={tp.left} gap={20} />
      </At>
      <At x={405} y={290} center>
        <TransferArrows onAllRight={tp.allRight} onAllLeft={tp.allLeft} gap={3} />
      </At>
      <At x={427} y={73} top>
        <PickGrid cols={[C('name', 'Product Name', 358)]} items={prodRows.filter((r) => tp.chosen.includes(r.id))} width={358} height={312} searchWidth={114} selected={tp.pickRight} onSelect={(id) => tp.setPickRight(id as number)} />
      </At>
      <At x={16} y={424} top>
        <PickGrid cols={[C('p', 'Party Name', 370)]} items={tq.available.map((p) => ({ id: p, cells: { p } }))} width={370} height={165} searchWidth={114} selected={tq.pickLeft} onSelect={(id) => tq.setPickLeft(id as string)} />
      </At>
      <At x={405} y={550} center>
        <TransferArrows onRight={tq.right} onLeft={tq.left} gap={20} />
      </At>
      <At x={405} y={643} center>
        <TransferArrows onAllRight={tq.allRight} onAllLeft={tq.allLeft} gap={3} />
      </At>
      <At x={427} y={424} top>
        <PickGrid cols={[C('p', 'Party Name', 358)]} items={tq.chosen.map((p) => ({ id: p, cells: { p } }))} width={358} height={165} searchWidth={114} selected={tq.pickRight} onSelect={(id) => tq.setPickRight(id as string)} />
      </At>
      {res && (
        <ResultDialog
          title="Ancillary party stock ledger"
          cols={[C('date', 'Date', 90), C('doc', 'Doc No', 100), C('party', 'Party Name', 200), C('name', 'Product Name', 220), C('qty', 'Qty', 60, 'right'), C('rate', 'Rate', 80, 'right'), C('amount', 'Amount', 90, 'right')]}
          rows={res}
          onClose={() => setRes(null)}
        />
      )}
    </Canvas>
  )
}

/* ── Policy Comparison Statement ───────────────────────────────────────── */
export function PolicyComparison() {
  const toast = useToast()
  const [txn, setTxn] = useState('')
  const [rows, setRows] = useState<Cells[] | null>(null)
  const cols = rows
    ? [C('img', 'Image', 100), C('name', 'Product Name', 220), C('list', 'Price List Rate', 110, 'right'), C('billed', 'Avg Billed Rate', 110, 'right'), C('diff', 'Difference', 160, 'right')]
    : [C('img', 'Image', 100), C('_', '', 606)]
  const compare = async () => {
    const [ps, sales] = await Promise.all([db.products.filter((p) => p.active).toArray(), db.sales.toArray()])
    const billed = new Map<number, { q: number; v: number }>()
    for (const s of sales.filter((x) => !x.refundOf))
      for (const l of s.lines)
        if (l.productId !== undefined) {
          const cur = billed.get(l.productId) ?? { q: 0, v: 0 }
          cur.q += l.qty
          cur.v += l.qty * l.unitPrice - l.discount
          billed.set(l.productId, cur)
        }
    const out = ps
      .filter((p) => billed.has(p.id!))
      .map((p) => {
        const b = billed.get(p.id!)!
        const avg = b.q ? Math.round(b.v / b.q) : 0
        return { img: <Thumb src={p.image} label={p.name} />, name: p.name, list: amt(p.price), billed: amt(avg), diff: amt(avg - p.price) }
      })
    if (!out.length) toast('No billed products to compare', 'error')
    setRows(out)
  }
  return (
    <Canvas height={520}>
      <Title x={372} y={22}>
        Policy Comparison Statement
      </Title>
      <At x={15} y={54}>
        <L>Select Transaction</L>
      </At>
      <At x={126} y={56}>
        <LookupField value={txn} onChange={setTxn} options={['OTC Medicine Issued/Bill', 'Whole Sale Invoice']} title="Transaction" />
      </At>
      <At x={312} y={56}>
        <Btn style={{ width: 66 }} onClick={compare}>
          Compare
        </Btn>
      </At>
      <ResultBlock y={85} width={708} searchWidth={305} height={372} cols={cols} rows={rows ?? []} />
    </Canvas>
  )
}

/* ── Budget Analysis ───────────────────────────────────────────────────── */
type Budgets = Record<string, Record<string, number>>
export function BudgetAnalysis() {
  const toast = useToast()
  const budgets = useKv<Budgets>('medapp:budget', {})
  const [tpl, setTpl] = useState('')
  const [rows, setRows] = useState<(Cells & { uid: number })[]>([])
  const [edit, setEdit] = useState<{ uid: number; name: string; value: string } | null>(null)
  const cols = [C('name', 'User Name', 300), C('actual', 'Actual Amount', 100, 'right'), C('budget', 'Budget Amount', 490, 'right')]
  const view = async (b = budgets) => {
    if (!tpl) return toast('Select a Template Name', 'error')
    const now = new Date()
    const start = tpl === 'DAILY SALES' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const [users, sales] = await Promise.all([db.users.toArray(), db.sales.where('createdAt').aboveOrEqual(start).toArray()])
    setRows(
      users.map((u) => ({
        uid: u.id!,
        name: u.name.toUpperCase(),
        actual: amt(sales.filter((s) => s.userId === u.id).reduce((t, s) => t + s.total, 0)),
        budget: amt(b[tpl]?.[u.id!] ?? 0),
      })),
    )
  }
  return (
    <Canvas height={520}>
      <Title x={511} y={21}>
        Budget&nbsp; Analysis
      </Title>
      <At x={361} y={68}>
        <L>Template Name</L>
      </At>
      <At x={464} y={70}>
        <Select value={tpl} onChange={setTpl} options={['', 'MONTHLY SALES', 'DAILY SALES']} width={160} />
      </At>
      <At x={632} y={70}>
        <Btn style={{ width: 52 }} onClick={() => view()}>
          View
        </Btn>
      </At>
      <ResultBlock
        y={104}
        x={64}
        width={892}
        searchWidth={403}
        height={327}
        cols={cols}
        rows={rows}
        onOpen={(i) => {
          const r = rows[i]
          if (r) setEdit({ uid: r.uid, name: String(r.name), value: String(r.budget) })
        }}
      />
      {edit && (
        <Dialog
          title={`Budget Amount - ${edit.name}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn
                onClick={async () => {
                  const cur = await getKv<Budgets>('medapp:budget', {})
                  const next = { ...cur, [tpl]: { ...(cur[tpl] ?? {}), [edit.uid]: Math.round((parseFloat(edit.value) || 0) * 100) } }
                  await setKv('medapp:budget', next)
                  setEdit(null)
                  await view(next)
                }}
              >
                Save
              </Btn>
              <Btn onClick={() => setEdit(null)}>cancel</Btn>
            </>
          }
        >
          <div className="ma-form">
            <label className="ma-label">Budget Amount</label>
            <Input value={edit.value} onChange={(v) => setEdit({ ...edit, value: v })} width={160} autoFocus />
          </div>
        </Dialog>
      )}
    </Canvas>
  )
}
