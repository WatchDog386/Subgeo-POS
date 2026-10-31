import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Customer, Sale } from '../../db/types'
import { useToast } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { amt, billNo, dmy, getMedDefaults, inRange, monthStartDmy, paidBy, todayDmy } from '../data'
import { ADMIN_REPORT_TREE } from '../nav-admin'
import { MagnifierIcon, SearchLens, ZoomGlass } from '../icons'
import { Btn, DateField, Grid, IBtn, Rows, SearchBar, Select, type Col } from '../ui'

type Result = { cols: Col[]; rows: Record<string, string>[] }
interface ReportDef {
  name: string
  selectDefault: string
  datesPrefilled: boolean
  selWidth: number
  initialCols: Col[]
  run: (from: string, to: string, sel: string) => Promise<Result>
}

const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })
const AGE_COLS = [C('d30', '0-30', 90, 'right'), C('d60', '31-60', 90, 'right'), C('d90', '61-90', 90, 'right'), C('d120', '91-120', 90, 'right'), C('dmore', '>120', 90, 'right'), C('total', 'Total', 100, 'right')]

function bucket(days: number): string {
  if (days <= 30) return 'd30'
  if (days <= 60) return 'd60'
  if (days <= 90) return 'd90'
  if (days <= 120) return 'd120'
  return 'dmore'
}
const daysAgo = (ts: number) => Math.floor((Date.now() - ts) / 86_400_000)
const accountPart = (s: Sale) => s.payments.filter((p) => p.method === 'account').reduce((t, p) => t + p.amount, 0)

/** Admin Report List pages (screenshots 14.47.15 (1)-(11), 14.47.16). */
const ADMIN_REPORTS: Record<string, ReportDef> = {
  'account-statement': {
    name: 'ACCOUNT STATEMENT',
    selectDefault: '',
    datesPrefilled: true,
    selWidth: 145,
    initialCols: [C('image', 'Image', 96), C('blank', '', 900)],
    async run(from, to, sel) {
      const d = await getMedDefaults()
      const customers = await db.customers.toArray()
      const party = customers.find((c) => c.name.toUpperCase() === sel)
      const sales = (await db.sales.orderBy('createdAt').toArray()).filter((s) => inRange(s.createdAt, from, to))
      let bal = 0
      const rows: Record<string, string>[] = []
      for (const s of sales) {
        if (party && s.customerId !== party.id) continue
        const value = party ? accountPart(s) : s.total
        if (party && value === 0) continue
        const debit = value > 0 ? value : 0
        const credit = value < 0 ? -value : 0
        bal += debit - credit
        rows.push({
          date: dmy(s.createdAt),
          doc: billNo(s, d.billPrefix),
          part: s.refundOf ? 'OTC MEDICINE RETURN' : party ? 'CREDIT SALE' : 'OTC MEDICINE ISSUE',
          debit: debit ? amt(debit) : '',
          credit: credit ? amt(credit) : '',
          bal: amt(bal),
        })
      }
      return {
        cols: [C('date', 'Date', 100), C('doc', 'Doc No', 150), C('part', 'Particulars', 300), C('debit', 'Debit', 110, 'right'), C('credit', 'Credit', 110, 'right'), C('bal', 'Balance', 120, 'right')],
        rows,
      }
    },
  },
  'os-debtor': {
    name: 'OS DEBTOR',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [],
    async run() {
      const cs = (await db.customers.toArray()).filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance)
      return {
        cols: [C('name', 'Party Name', 300), C('phone', 'Telephone', 140), C('limit', 'Credit Limit', 120, 'right'), C('os', 'Outstanding Amt', 140, 'right')],
        rows: cs.map((c) => ({ name: c.name.toUpperCase(), phone: c.phone ?? '-', limit: amt(c.creditLimit), os: amt(c.balance) })),
      }
    },
  },
  'os-creditor': {
    name: 'OS CREDITOR',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [],
    async run(from, to) {
      const [sups, pos] = await Promise.all([db.suppliers.toArray(), db.purchaseOrders.toArray()])
      const rows = sups
        .map((s) => {
          const mine = pos.filter((p) => p.supplierId === s.id && p.status !== 'cancelled' && inRange(p.createdAt, from, to))
          const ordered = mine.reduce((t, p) => t + p.lines.reduce((u, l) => u + l.qty * l.unitCost, 0), 0)
          const received = mine.reduce((t, p) => t + p.lines.reduce((u, l) => u + l.received * l.unitCost, 0), 0)
          return { name: s.name.toUpperCase(), count: String(mine.length), ordered: amt(ordered), received: amt(received) }
        })
        .filter((r) => r.count !== '0')
      return {
        cols: [C('name', 'Party Name', 300), C('count', 'Orders', 80, 'right'), C('ordered', 'Ordered Value', 140, 'right'), C('received', 'Received Value', 140, 'right')],
        rows,
      }
    },
  },
  'all-debtor-ageing': {
    name: 'ALL DEBTOR AGEING',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [],
    async run() {
      const [cs, sales] = await Promise.all([db.customers.toArray(), db.sales.toArray()])
      const rows = cs
        .filter((c: Customer) => c.balance > 0)
        .map((c) => {
          const last = sales.filter((s) => s.customerId === c.id && accountPart(s) > 0).reduce((m, s) => Math.max(m, s.createdAt), c.createdAt)
          const r: Record<string, string> = { name: c.name.toUpperCase(), d30: '', d60: '', d90: '', d120: '', dmore: '', total: amt(c.balance) }
          r[bucket(daysAgo(last))] = amt(c.balance)
          return r
        })
      return { cols: [C('name', 'Party Name', 260), ...AGE_COLS], rows }
    },
  },
  'all-creditor-ageing': {
    name: 'ALL CREDITOR AGEING',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [],
    async run() {
      const [sups, pos] = await Promise.all([db.suppliers.toArray(), db.purchaseOrders.toArray()])
      const rows = sups
        .map((s) => {
          const r: Record<string, string> = { name: s.name.toUpperCase() }
          const sums: Record<string, number> = {}
          let total = 0
          for (const p of pos.filter((x) => x.supplierId === s.id && x.status !== 'cancelled' && x.status !== 'draft')) {
            const v = p.lines.reduce((u, l) => u + l.received * l.unitCost, 0)
            const k = bucket(daysAgo(p.createdAt))
            sums[k] = (sums[k] ?? 0) + v
            total += v
          }
          for (const k of ['d30', 'd60', 'd90', 'd120', 'dmore']) r[k] = sums[k] ? amt(sums[k]) : ''
          r.total = amt(total)
          return { r, total }
        })
        .filter((x) => x.total > 0)
        .map((x) => x.r)
      return { cols: [C('name', 'Party Name', 260), ...AGE_COLS], rows }
    },
  },
  'daily-sales': {
    name: 'DAILY SALES REPORT',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [C('date', 'Date', 105), C('doc', 'Doc No', 110), C('client', 'Client Name', 215), C('cost', 'TOT COST', 115, 'right'), C('amount', 'Amount', 100, 'right'), C('profit', 'TOT PROFIT', 400, 'right')],
    async run(from, to) {
      const d = await getMedDefaults()
      const customers = await db.customers.toArray()
      const cName = new Map(customers.map((c) => [c.id!, c.name.toUpperCase()]))
      const sales = (await db.sales.orderBy('createdAt').toArray()).filter((s) => !s.refundOf && inRange(s.createdAt, from, to))
      const rows = sales.map((s) => {
        const cost = s.lines.reduce((t, l) => t + l.unitCost * l.qty, 0)
        return {
          date: dmy(s.createdAt),
          doc: billNo(s, d.billPrefix),
          client: s.customerId !== undefined ? (cName.get(s.customerId) ?? d.patientCategory) : d.patientCategory,
          cost: amt(cost),
          amount: amt(s.total),
          profit: amt(s.total - cost),
        }
      })
      return {
        cols: [C('date', 'Date', 105), C('doc', 'Doc No', 110), C('client', 'Client Name', 215), C('cost', 'TOT COST', 115, 'right'), C('amount', 'Amount', 100, 'right'), C('profit', 'TOT PROFIT', 400, 'right')],
        rows,
      }
    },
  },
  'cash-collection': {
    name: 'CASH COLLECTION DEBTORS + OTC',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [C('date', 'Date', 105), C('rec', 'Rec No', 110), C('cash', 'Cash', 100), C('mpesa', 'Mpesa', 100), C('card', 'Credit Card', 105), C('cheque', 'Cheque', 110), C('total', 'Total Rec Amt', 400)],
    async run(from, to) {
      const d = await getMedDefaults()
      const sales = (await db.sales.orderBy('createdAt').toArray()).filter((s) => inRange(s.createdAt, from, to))
      const t = { cash: 0, mpesa: 0, card: 0, cheque: 0, total: 0 }
      const rows = sales.map((s) => {
        const cash = paidBy(s, 'cash')
        const mpesa = paidBy(s, 'mpesa')
        const card = paidBy(s, 'card')
        const cheque = paidBy(s, 'cheque')
        const total = cash + mpesa + card + cheque
        t.cash += cash
        t.mpesa += mpesa
        t.card += card
        t.cheque += cheque
        t.total += total
        return { date: dmy(s.createdAt), rec: billNo(s, d.billPrefix), cash: amt(cash), mpesa: amt(mpesa), card: amt(card), cheque: amt(cheque), total: amt(total) }
      })
      if (rows.length) rows.push({ date: 'TOTAL', rec: '', cash: amt(t.cash), mpesa: amt(t.mpesa), card: amt(t.card), cheque: amt(t.cheque), total: amt(t.total) })
      return {
        cols: [C('date', 'Date', 105), C('rec', 'Rec No', 150), C('cash', 'Cash', 100, 'right'), C('mpesa', 'Mpesa', 100, 'right'), C('card', 'Credit Card', 105, 'right'), C('cheque', 'Cheque', 110, 'right'), C('total', 'Total Rec Amt', 130, 'right')],
        rows,
      }
    },
  },
  'medicine-list': {
    name: 'MEDICINE LIST',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [C('name', 'Medicine Name', 105), C('group', 'Group', 95), C('cost', 'Cost Rate', 95, 'right'), C('cash', 'Cash S Rate', 105), C('credit', 'Credit S Rate', 85, 'right'), C('type', 'Type', 400)],
    async run() {
      const [products, cats] = await Promise.all([db.products.toArray(), db.categories.toArray()])
      const catName = new Map(cats.map((c) => [c.id!, c.name]))
      const rows = products
        .filter((p) => p.active && p.trackStock)
        .map((p) => ({
          name: p.name.toUpperCase(),
          group: (p.categoryId !== undefined ? catName.get(p.categoryId) : undefined)?.toUpperCase() ?? '',
          cost: amt(p.cost),
          cash: amt(p.price),
          credit: amt(p.price),
          type: 'S',
        }))
      return {
        cols: [C('name', 'Medicine Name', 105), C('group', 'Group', 95), C('cost', 'Cost Rate', 95, 'right'), C('cash', 'Cash S Rate', 105), C('credit', 'Credit S Rate', 85, 'right'), C('type', 'Type', 400)],
        rows,
      }
    },
  },
  'expiry-medicines': {
    name: 'EXPIARY MEDICINIES REPORT',
    selectDefault: 'SELECT',
    datesPrefilled: false,
    selWidth: 65,
    initialCols: [C('exp', 'Expiary Date', 105), C('name', 'Product Name', 215), C('qty', 'Avl Qty', 100, 'right'), C('rate', 'Rate', 400, 'right')],
    async run() {
      // The POS does not capture batch / expiry dates yet, so there is
      // nothing to list until that field exists on products.
      return { cols: [C('exp', 'Expiary Date', 105), C('name', 'Product Name', 215), C('qty', 'Avl Qty', 100, 'right'), C('rate', 'Rate', 400, 'right')], rows: [] }
    },
  },
  'otc-medicine-issue': {
    name: 'OTC MEDICINE ISSUE',
    selectDefault: 'DATE',
    datesPrefilled: true,
    selWidth: 65,
    initialCols: [C('doc', 'DOC NO', 105), C('date', 'DATE', 100), C('patient', 'PATIENT NAME', 120), C('age', 'AGE', 100), C('med', 'MEDICINE', 100), C('qty', 'QTY', 100), C('rate', 'RATE', 155, 'right'), C('amount', 'AMT', 400, 'right')],
    async run(from, to) {
      const d = await getMedDefaults()
      const customers = await db.customers.toArray()
      const cName = new Map(customers.map((c) => [c.id!, c.name.toUpperCase()]))
      const sales = (await db.sales.orderBy('createdAt').toArray()).filter((s) => !s.refundOf && inRange(s.createdAt, from, to))
      const rows = sales.flatMap((s) =>
        s.lines.map((l) => ({
          doc: billNo(s, d.billPrefix),
          date: dmy(s.createdAt),
          patient: s.customerId !== undefined ? (cName.get(s.customerId) ?? d.patientCategory) : d.patientCategory,
          age: '-',
          med: l.name,
          qty: String(l.qty),
          rate: amt(l.unitPrice),
          amount: amt(l.qty * l.unitPrice - l.discount),
        })),
      )
      return {
        cols: [C('doc', 'DOC NO', 105), C('date', 'DATE', 100), C('patient', 'PATIENT NAME', 120), C('age', 'AGE', 100), C('med', 'MEDICINE', 100), C('qty', 'QTY', 100), C('rate', 'RATE', 155, 'right'), C('amount', 'AMT', 400, 'right')],
        rows,
      }
    },
  },
}

export default function AdminReportListPage() {
  const { slug = 'account-statement' } = useParams()
  const def = ADMIN_REPORTS[slug] ?? ADMIN_REPORTS['account-statement']
  return <AdminReportViewer key={slug} slug={slug} def={def} />
}

function AdminReportViewer({ slug, def }: { slug: string; def: ReportDef }) {
  const toast = useToast()
  const [from, setFrom] = useState(def.datesPrefilled ? monthStartDmy() : '')
  const [to, setTo] = useState(def.datesPrefilled ? todayDmy() : '')
  const [sel, setSel] = useState(def.selectDefault)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [fmt, setFmt] = useState('ExportReportToPdfFile')
  const searchRef = useRef<HTMLDivElement>(null)
  const parties = useLiveQuery(async () => (await db.customers.toArray()).map((c) => c.name.toUpperCase()), [], [] as string[])
  const label = ADMIN_REPORT_TREE.find((r) => r.slug === slug)?.label ?? def.name
  useEffect(() => setResult(null), [slug])

  const view = async () => {
    try {
      setResult(await def.run(from, to, sel))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }
  const cols = result?.cols ?? def.initialCols
  const rows = (result?.rows ?? []).filter((r) => !q.trim() || Object.values(r).some((v) => v.toLowerCase().includes(q.trim().toLowerCase())))
  const exportNow = () => {
    if (fmt === 'ExportReportToPdfFile') return window.print()
    downloadCsv(label.replace(/[^a-z0-9]+/gi, '-'), cols.map((c) => c.label), rows.map((r) => cols.map((c) => r[c.key] ?? '')))
  }
  const selOptions =
    slug === 'account-statement' ? ['', ...parties] : def.selectDefault === 'DATE' ? ['DATE', 'ALL'] : ['SELECT', 'ALL']

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 30 }}>
        <span style={{ marginLeft: 80, display: 'flex', gap: 18 }}>
          <span className="ma-bold-label">Report :</span>
          <span className="ma-report-name">{def.name}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, marginRight: 60 }}>
          <IBtn bare title="Find" onClick={() => searchRef.current?.querySelector('input')?.focus()}>
            <SearchLens size={24} />
          </IBtn>
          <IBtn bare title="Search" onClick={view}>
            <MagnifierIcon size={24} />
          </IBtn>
          <IBtn bare title="View" onClick={view}>
            <ZoomGlass />
          </IBtn>
          <Select value={sel} onChange={setSel} options={selOptions} width={def.selWidth} plain={slug === 'account-statement'} />
          {def.datesPrefilled && (
            <>
              <DateField value={from} onChange={setFrom} />
              <DateField value={to} onChange={setTo} />
            </>
          )}
          <Btn onClick={view}>View</Btn>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }} ref={searchRef}>
        <SearchBar value={q} onChange={setQ} width={450} />
        <span style={{ marginLeft: 'auto', marginRight: 12 }}>
          <Rows n={rows.length} />
        </span>
      </div>
      <div style={{ marginTop: 3 }}>
        {cols.length ? (
          <Grid cols={cols} rows={rows.map((r, i) => ({ id: i, cells: r }))} height={600} />
        ) : (
          <div className="ma-grid" style={{ height: 600 }}>
            <div style={{ height: 34, background: 'linear-gradient(to bottom,#fbfbfb,#f0f0f0 45%,#dcdcdc)', borderBottom: '1px solid #c3c3c3' }} />
          </div>
        )}
      </div>
      <div className="ma-noprint" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 13 }}>
        <Select value={fmt} onChange={setFmt} plain round width={152} options={['ExportReportToPdfFile', 'ExportReportToExcelFile', 'ExportReportToCsvFile']} />
        <Btn onClick={() => window.print()}>Print</Btn>
        <Btn onClick={exportNow}>Export</Btn>
      </div>
    </div>
  )
}
