import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Customer, Product, Sale, ServiceJob, Supplier } from '../../db/types'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import {
  amt,
  billNo,
  deleteDocs,
  dmy,
  nextDocNo,
  paidBy,
  payableBy,
  saveDoc,
  seqOf,
  useCustomerMap,
  useDocs,
  useMedDefaults,
  useUserMap,
  yy,
} from '../data'
import { MODULE_GROUPS } from '../nav'
import {
  EyeIcon,
  FindIcon,
  FunnelIcon,
  MagnifierIcon,
  OrangeArrow,
  PlusIcon,
  SearchLens,
  SortIcon,
  StampIcon,
  ToolGlyph,
  type ToolKey,
} from '../icons'
import { Btn, Dialog, Grid, HScroll, IBtn, Input, PickList, Rows, Select, ToolBtn, type Col } from '../ui'

/* ── Definitions ───────────────────────────────────────────────────────── */
type Source = 'otc' | 'otc-return' | 'service' | 'party' | 'services' | 'docs'
type FieldKind = 'docno' | 'date' | 'user' | 'location' | 'text' | 'party' | 'money'
interface Field {
  key: string
  kind: FieldKind
}
interface ModuleDef {
  title: string
  source: Source
  cols: Col[]
  tools: ToolKey[]
  hscroll?: number
  yellowChk?: boolean
  prefix?: string
  fields?: Field[]
}

const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })
const BASE_TOOLS: ToolKey[] = ['mail', 'add', 'list', 'note', 'chat', 'edit', 'copy', 'print', 'scanner', 'fax', 'download', 'docs']

const DEFS: Record<string, ModuleDef> = {
  'otc-bill': {
    title: 'OTC Medicine Issue/Bill',
    source: 'otc',
    hscroll: 0.5,
    tools: BASE_TOOLS,
    cols: [
      C('billNo', 'Bill No.', 100),
      C('date', 'Date', 98),
      C('category', 'Patient Category', 200),
      C('payable', 'Payable By', 190),
      C('narration', 'Narration', 200),
      C('amount', 'Bill Amount', 75, 'right'),
      C('user', 'User Name', 100),
      C('location', 'Location', 110),
    ],
  },
  'otc-return': {
    title: 'OTC Medicine Isse Return',
    source: 'otc-return',
    hscroll: 0.5,
    yellowChk: true,
    tools: BASE_TOOLS,
    cols: [
      C('date', 'Date', 100),
      C('category', 'Patient Category', 200),
      C('payable', 'Payable By', 190),
      C('narration', 'Narration', 200),
      C('amount', 'Bill Amount', 75, 'right'),
      C('user', 'User Name', 100),
      C('location', 'Location', 110),
    ],
  },
  'service-bill': {
    title: 'Service Request/Bill',
    source: 'service',
    hscroll: 0.65,
    tools: BASE_TOOLS,
    cols: [
      C('billNo', 'SERV Bill No', 100),
      C('patient', 'Patient Name', 150),
      C('location', 'Location', 190),
      C('category', 'Patient Category', 190),
      C('amount', 'Bill Amount', 75, 'right'),
      C('cash', 'CASH', 75, 'right'),
      C('mpesa', 'MPESA', 75, 'right'),
      C('credit', 'CREDIT', 75, 'right'),
      C('cheque', 'CHEQUE', 75, 'right'),
      C('card', 'CARD', 75, 'right'),
    ],
  },
  'sales-quotation': {
    title: 'Sales Quotation',
    source: 'docs',
    prefix: 'SQ',
    tools: ['mail', 'add', 'list', 'note', 'chat', 'edit', 'copyAll', 'print', 'scanner', 'fax', 'download', 'docs'],
    cols: [C('location', 'Location', 200), C('docNo', 'Quote.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('user', 'User', 410)],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'date', kind: 'date' },
      { key: 'customer', kind: 'party' },
      { key: 'user', kind: 'user' },
    ],
  },
  'delivery-note': {
    title: 'Delivery Note',
    source: 'docs',
    prefix: 'DN',
    tools: ['mail', 'add', 'list', 'note', 'chat', 'edit', 'copyAll', 'print', 'scanner', 'fax', 'download', 'docs', 'stack'],
    cols: [
      C('location', 'Location', 200),
      C('date', 'Date', 75),
      C('customer', 'Customer Name', 190),
      C('invoiceNo', 'Invoice No', 100),
      C('docNo', 'Delivery No.', 100),
      C('quoteNo', 'Quote.No', 100),
      C('total', 'Total', 75, 'right'),
      C('user', 'User', 140),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'date', kind: 'date' },
      { key: 'customer', kind: 'party' },
      { key: 'invoiceNo', kind: 'text' },
      { key: 'docNo', kind: 'docno' },
      { key: 'quoteNo', kind: 'text' },
      { key: 'total', kind: 'money' },
      { key: 'user', kind: 'user' },
    ],
  },
  'credit-note': {
    title: 'Credit Note',
    source: 'docs',
    prefix: 'CN',
    tools: BASE_TOOLS,
    cols: [
      C('location', 'Location', 200),
      C('docNo', 'Return No', 100),
      C('date', 'Date', 75),
      C('customer', 'Organization Name', 190),
      C('quoteNo', 'Quotation No', 100),
      C('user', 'User', 100),
      C('total', 'Net Amt', 75, 'right'),
      C('partyId', 'Party ID', 140),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'date', kind: 'date' },
      { key: 'customer', kind: 'party' },
      { key: 'quoteNo', kind: 'text' },
      { key: 'user', kind: 'user' },
      { key: 'total', kind: 'money' },
      { key: 'partyId', kind: 'text' },
    ],
  },
  'whole-sale-invoice': {
    title: 'Whole Sale Invoice',
    source: 'docs',
    prefix: 'WSI',
    tools: ['mail', 'add', 'list', 'note', 'chat', 'edit', 'globe', 'copyAll', 'print', 'scanner', 'fax', 'download', 'docs'],
    cols: [C('location', 'Location', 200), C('quoteNo', 'Quote.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('user', 'User', 100), C('_', '', 310)],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'quoteNo', kind: 'text' },
      { key: 'date', kind: 'date' },
      { key: 'customer', kind: 'party' },
      { key: 'total', kind: 'money' },
      { key: 'user', kind: 'user' },
    ],
  },
  'credit-note-direct': {
    title: 'Credit Note - Direct Invoice',
    source: 'docs',
    prefix: 'CRN',
    tools: BASE_TOOLS,
    cols: [C('location', 'Location', 200), C('docNo', 'CR Note.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('partyId', 'Party ID', 75), C('user', 'User', 100), C('_', '', 235)],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'date', kind: 'date' },
      { key: 'customer', kind: 'party' },
      { key: 'partyId', kind: 'text' },
      { key: 'total', kind: 'money' },
      { key: 'user', kind: 'user' },
    ],
  },
  'final-bill-receipt': {
    title: 'Final Bill Receipt',
    source: 'docs',
    prefix: 'FBR',
    hscroll: 0.4,
    tools: ['mail', 'add', 'list', 'note', 'chat', 'copy', 'print', 'scanner', 'fax', 'download', 'docs', 'link', 'stack'],
    cols: [
      C('date', 'Date', 100),
      C('advDetails', 'Adv Details', 250),
      C('customer', 'Received From', 200),
      C('depositTo', 'Deposit To', 200),
      C('docNo', 'Receipt No', 100),
      C('total', 'Total', 75, 'right'),
      C('cheque', 'Cheque', 100),
    ],
    fields: [
      { key: 'date', kind: 'date' },
      { key: 'advDetails', kind: 'text' },
      { key: 'customer', kind: 'party' },
      { key: 'depositTo', kind: 'text' },
      { key: 'docNo', kind: 'docno' },
      { key: 'total', kind: 'money' },
      { key: 'cheque', kind: 'text' },
    ],
  },
  'party-master': {
    title: 'Party Master',
    source: 'party',
    hscroll: 0.7,
    tools: ['mail', 'add', 'list', 'note', 'chat', 'edit', 'globe', 'copyAll', 'print', 'scanner', 'fax', 'download', 'docs'],
    cols: [
      C('name', 'Facilty Name', 200),
      C('group', 'Group Account', 200),
      C('type', 'Type', 190),
      C('blacklisted', 'Blacklisted', 75),
      C('address', 'Address', 190),
      C('pobox', 'P.O Box No', 100),
      C('phone', 'Telephone', 110),
      C('email', 'Email', 160),
    ],
  },
  'services-master': {
    title: 'Services Master',
    source: 'services',
    tools: ['mail', 'add', 'list', 'note', 'chat', 'edit', 'copyAll', 'print', 'scanner', 'fax', 'download', 'docs'],
    cols: [C('name', 'Service Type', 400), C('charges', 'Service Charges', 190), C('outsource', 'Outsource?', 400)],
  },
  /* Admin-only modules (screenshots 14.40.05 (4)-(6), 14.40.06 (2)-(4)). */
  'supplier-payment': {
    title: 'Supplier Payment',
    source: 'docs',
    prefix: 'REM',
    tools: [...BASE_TOOLS, 'link'],
    cols: [
      C('docNo', 'Payment Vouche', 95),
      C('voucherDate', 'Voucher Date', 100),
      C('supplierName', 'Supplier Name', 215),
      C('fromAccount', 'From Account', 250),
      C('refNo', 'REF NO#', 100),
      C('ref', 'REF', 250),
    ],
    fields: [
      { key: 'docNo', kind: 'docno' },
      { key: 'voucherDate', kind: 'date' },
      { key: 'supplierName', kind: 'party' },
      { key: 'fromAccount', kind: 'text' },
      { key: 'refNo', kind: 'text' },
      { key: 'ref', kind: 'text' },
    ],
  },
  'purchase-indent': {
    title: 'Purchase Indent',
    source: 'docs',
    prefix: 'PI',
    hscroll: 0.7,
    tools: BASE_TOOLS,
    cols: [
      C('location', 'Location', 160),
      C('docNo', 'Indent No', 115),
      C('indentDate', 'Indent Date', 125),
      C('indentor', 'Indentor', 105),
      C('status', 'Status', 215),
      C('purpose', 'Purpose/Remarks', 230),
      C('approx', 'Approx Cost', 105, 'right'),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'indentDate', kind: 'date' },
      { key: 'indentor', kind: 'text' },
      { key: 'status', kind: 'text' },
      { key: 'purpose', kind: 'text' },
      { key: 'approx', kind: 'money' },
    ],
  },
  'local-purchase-order': {
    title: 'Local Purchase Order',
    source: 'docs',
    prefix: 'PO',
    hscroll: 0.8,
    tools: BASE_TOOLS,
    cols: [
      C('location', 'Location', 305),
      C('indentNo', 'Indent No', 115),
      C('poDate', 'PO Date', 205),
      C('indentDate', 'Indent Date', 205),
      C('docNo', 'PO No', 190),
      C('vendorName', 'Vendor Name', 210),
      C('address', 'Address', 220),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'indentNo', kind: 'text' },
      { key: 'poDate', kind: 'date' },
      { key: 'indentDate', kind: 'date' },
      { key: 'docNo', kind: 'docno' },
      { key: 'vendorName', kind: 'party' },
      { key: 'address', kind: 'text' },
    ],
  },
  'pur-inv-grn': {
    title: 'Pur Inv/GRN',
    source: 'docs',
    prefix: 'GRN',
    hscroll: 0.75,
    tools: BASE_TOOLS,
    cols: [
      C('location', 'Location', 300),
      C('supInvDate', 'Sup Inv. DATE', 205),
      C('docNo', 'GRN No', 200),
      C('lpoNo', 'LPO No', 200),
      C('lpoDate', 'LPO Date', 210),
      C('vendorName', 'Vendor Name', 210),
      C('phoneNo', 'Phone No', 170),
      C('faxNo', 'Fax No', 150),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'supInvDate', kind: 'date' },
      { key: 'docNo', kind: 'docno' },
      { key: 'lpoNo', kind: 'text' },
      { key: 'lpoDate', kind: 'date' },
      { key: 'vendorName', kind: 'party' },
      { key: 'phoneNo', kind: 'text' },
      { key: 'faxNo', kind: 'text' },
    ],
  },
  'pur-grn-direct-invoice': {
    title: 'Pur/GRN (Direct Invoice)',
    source: 'docs',
    prefix: 'MRN',
    hscroll: 0.6,
    tools: BASE_TOOLS,
    cols: [
      C('docNo', 'Mrn No', 115),
      C('mrnDate', 'Mrn Date', 120),
      C('invoice', 'Invoice/Receipt', 125),
      C('vendorName', 'Vendor Name', 200),
      C('total', 'TOTAL VALUE', 115, 'right'),
      C('expense', 'Expense A/c', 200),
      C('receivedBy', 'Received By', 115),
      C('status', 'Status', 120),
    ],
    fields: [
      { key: 'docNo', kind: 'docno' },
      { key: 'mrnDate', kind: 'date' },
      { key: 'invoice', kind: 'text' },
      { key: 'vendorName', kind: 'party' },
      { key: 'total', kind: 'money' },
      { key: 'expense', kind: 'text' },
      { key: 'receivedBy', kind: 'text' },
      { key: 'status', kind: 'text' },
    ],
  },
  'medicine': {
    title: 'Medicine',
    source: 'docs',
    prefix: 'PRD00',
    hscroll: 0.75,
    tools: BASE_TOOLS,
    cols: [
      C('docNo', 'Product Code', 200),
      C('name', 'Product Name', 200),
      C('group', 'Product Group', 310),
      C('uom', 'UOM', 100),
      C('retail', 'Retail Sale', 130, 'right'),
      C('whole', 'Whole sale', 140, 'right'),
      C('cost', 'Cost Rate', 130, 'right'),
      C('packSize', 'Pack Size', 110, 'right'),
      C('type', 'Stock/Non-Stock', 80),
    ],
    fields: [
      { key: 'docNo', kind: 'docno' },
      { key: 'name', kind: 'text' },
      { key: 'group', kind: 'text' },
      { key: 'uom', kind: 'text' },
      { key: 'retail', kind: 'money' },
      { key: 'whole', kind: 'money' },
      { key: 'cost', kind: 'money' },
      { key: 'packSize', kind: 'money' },
      { key: 'type', kind: 'text' },
    ],
  },
}

const TOOL_TITLES: Record<ToolKey, string> = {
  mail: 'E-Mail',
  add: 'New',
  list: 'Refresh List',
  note: 'View Details',
  chat: 'Messages',
  edit: 'Edit',
  globe: 'Customer Display',
  excel: 'Export To Excel',
  copy: 'Copy Rows',
  copyAll: 'Copy Rows',
  print: 'Print',
  scanner: 'Print Selected',
  fax: 'Direct Print',
  download: 'Export',
  docs: 'Document Center',
  link: 'Re-Generate Link',
  stack: 'Data Management',
  printAll: 'Print',
  columns: 'Columns',
}

type RawRow = { id: string; ts: number; cells: Record<string, string>; detail?: Sale | ServiceJob }

const PAGE = 50
const OPS = ['WHERE', '=', 'LIKE', 'START WITH', '>', '<']

/* ── Data adapters ─────────────────────────────────────────────────────── */
function useRows(slug: string, def: ModuleDef): RawRow[] {
  const users = useUserMap()
  const customers = useCustomerMap()
  const d = useMedDefaults()
  const docs = useDocs(slug)
  const sales = useLiveQuery(
    () => (def.source === 'otc' || def.source === 'otc-return' ? db.sales.orderBy('createdAt').reverse().toArray() : Promise.resolve([] as Sale[])),
    [def.source],
    [] as Sale[],
  )
  const jobs = useLiveQuery(
    () => (def.source === 'service' ? db.jobs.orderBy('createdAt').reverse().toArray() : Promise.resolve([] as ServiceJob[])),
    [def.source],
    [] as ServiceJob[],
  )
  const jobSales = useLiveQuery(
    async () => {
      const ids = jobs.map((j) => j.saleId).filter((x): x is number => x !== undefined)
      return ids.length ? db.sales.bulkGet(ids) : []
    },
    [jobs],
    [] as (Sale | undefined)[],
  )
  const suppliers = useLiveQuery(() => (def.source === 'party' ? db.suppliers.toArray() : Promise.resolve([] as Supplier[])), [def.source], [] as Supplier[])
  const services = useLiveQuery(
    () => (def.source === 'services' ? db.products.filter((p) => !p.trackStock).toArray() : Promise.resolve([] as Product[])),
    [def.source],
    [] as Product[],
  )
  const uname = (id?: number) => (id !== undefined ? users.get(id)?.name.toUpperCase() ?? '' : '')

  return useMemo(() => {
    switch (def.source) {
      case 'otc':
        return sales
          .filter((s) => !s.refundOf)
          .map((s) => ({
            id: `s${s.id}`,
            ts: s.createdAt,
            detail: s,
            cells: {
              billNo: billNo(s, d.billPrefix),
              date: dmy(s.createdAt),
              category: s.customerId !== undefined ? (customers.get(s.customerId)?.name ?? d.patientCategory).toUpperCase() : d.patientCategory,
              payable: payableBy(s, customers),
              narration: `${s.note ? `${s.note} ` : ''}-${uname(s.userId)}`,
              amount: amt(s.total),
              user: uname(s.userId),
              location: d.location,
            },
          }))
      case 'otc-return': {
        const byId = new Map(sales.map((s) => [s.id!, s]))
        return sales
          .filter((s) => s.refundOf !== undefined)
          .map((s) => {
            const orig = byId.get(s.refundOf!)
            return {
              id: `r${s.id}`,
              ts: s.createdAt,
              detail: s,
              cells: {
                date: dmy(s.createdAt),
                category: d.patientCategory,
                payable: payableBy(s, customers),
                narration: `${orig ? `RET ${billNo(orig, d.billPrefix)} ` : ''}-${uname(s.userId)}`,
                amount: amt(-s.total),
                user: uname(s.userId),
                location: d.location,
              },
            }
          })
      }
      case 'service': {
        const saleMap = new Map<number, Sale>()
        for (const s of jobSales) if (s) saleMap.set(s.id!, s)
        return jobs.map((j) => {
          const total = j.labour + j.lines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0)
          const sale = j.saleId !== undefined ? saleMap.get(j.saleId) : undefined
          const paid = (m: 'cash' | 'mpesa' | 'card' | 'account') => (sale ? amt(paidBy(sale, m)) : '0.00')
          return {
            id: `j${j.id}`,
            ts: j.createdAt,
            detail: j,
            cells: {
              billNo: `${d.servicePrefix}-${seqOf(j.jobNo)}-${yy(j.createdAt)}`,
              patient: (j.customerName || 'OTC CLIENT').toUpperCase(),
              location: d.location,
              category: d.patientCategory,
              amount: amt(total),
              cash: paid('cash'),
              mpesa: paid('mpesa'),
              credit: paid('account'),
              cheque: '0.00',
              card: paid('card'),
            },
          }
        })
      }
      case 'party':
        return [
          ...suppliers.map((s) => ({
            id: `sup${s.id}`,
            ts: s.id ?? 0,
            cells: {
              name: s.name.toUpperCase(),
              group: 'Sundry Creditors',
              type: 'SUPPLIERS',
              blacklisted: 'NO',
              address: s.notes || '-',
              pobox: '-',
              phone: s.phone || '-',
              email: s.email || '-',
            },
          })),
          ...[...customers.values()].map((c) => ({
            id: `cus${c.id}`,
            ts: c.createdAt,
            cells: {
              name: c.name.toUpperCase(),
              group: 'SUNDRY DEBTORS',
              type: 'CUSTOMER',
              blacklisted: /blacklist/i.test(c.notes ?? '') ? 'YES' : 'NO',
              address: c.notes || '-',
              pobox: '-',
              phone: c.phone || '-',
              email: c.email || '-',
            },
          })),
        ].sort((a, b) => b.ts - a.ts)
      case 'services':
        return services
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((p) => ({
            id: `p${p.id}`,
            ts: p.createdAt,
            cells: { name: p.name.toUpperCase(), charges: amt(p.price), outsource: p.brand === 'OUTSOURCED' ? 'YES' : 'NO' },
          }))
      case 'docs':
        return docs.map((doc) => ({ id: `d${doc.id}`, ts: doc.createdAt, cells: doc.values }))
    }
  }, [def.source, sales, jobs, jobSales, suppliers, customers, services, docs, d, users]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* ── Screen ────────────────────────────────────────────────────────────── */
export function ModuleListPage() {
  const { slug = '' } = useParams()
  const def = DEFS[slug]
  if (!def) return <ModulesEmpty />
  return <ModuleList key={slug} slug={slug} def={def} />
}

function ModuleList({ slug, def }: { slug: string; def: ModuleDef }) {
  const nav = useNavigate()
  const toast = useToast()
  const all = useRows(slug, def)
  const [quick, setQuick] = useState('')
  const [col, setCol] = useState('SELECT')
  const [op, setOp] = useState('WHERE')
  const [val, setVal] = useState('')
  const [applied, setApplied] = useState<{ col: string; op: string; val: string } | null>(null)
  const [approval, setApproval] = useState('SPECIMEN COLLECTED')
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)
  const [checked, setChecked] = useState<Set<string | number>>(new Set())
  const [selected, setSelected] = useState<string | number | undefined>()
  const [showFilter, setShowFilter] = useState(true)
  const [valuePick, setValuePick] = useState(false)
  const [view, setView] = useState<RawRow | null>(null)
  const [edit, setEdit] = useState<RawRow | 'new' | null>(null)
  const [action, setAction] = useState('SELECT')

  const colKey = def.cols.find((c) => c.label === col)?.key
  const filtered = all
    .filter((r) => !quick.trim() || Object.values(r.cells).some((v) => v.toLowerCase().includes(quick.trim().toLowerCase())))
    .filter((r) => {
      if (!applied) return true
      const k = def.cols.find((c) => c.label === applied.col)?.key
      if (!k) return true
      const cell = (r.cells[k] ?? '').toLowerCase()
      const v = applied.val.toLowerCase()
      switch (applied.op) {
        case '=':
          return cell === v
        case 'START WITH':
          return cell.startsWith(v)
        case '>':
          return parseFloat(cell) > parseFloat(v)
        case '<':
          return parseFloat(cell) < parseFloat(v)
        default:
          return cell.includes(v)
      }
    })
    .sort((a, b) => (asc ? a.ts - b.ts : b.ts - a.ts))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const pg = Math.min(page, pages - 1)
  const pageRows = filtered.slice(pg * PAGE, pg * PAGE + PAGE)
  const target = () => all.find((r) => r.id === selected) ?? all.find((r) => checked.has(r.id))

  const exportCsv = () =>
    downloadCsv(
      def.title.replace(/[^a-z0-9]+/gi, '-'),
      def.cols.filter((c) => c.label).map((c) => c.label),
      filtered.map((r) => def.cols.filter((c) => c.label).map((c) => r.cells[c.key] ?? '')),
    )
  const chosenRows = () => {
    const rows = all.filter((r) => checked.has(r.id))
    return rows.length ? rows : target() ? [target()!] : []
  }
  const newDoc = () => {
    if (def.source === 'otc') nav('/sell')
    else if (def.source === 'otc-return') nav('/sales')
    else if (def.source === 'service') nav('/service')
    else setEdit('new')
  }
  const editDoc = () => {
    const t = target()
    if (!t) return toast('Select a record first', 'error')
    if (def.source === 'otc' || def.source === 'otc-return') nav('/sales')
    else if (def.source === 'service') nav('/service')
    else setEdit(t)
  }
  const viewDoc = () => {
    const t = target()
    if (!t) return toast('Select a record first', 'error')
    setView(t)
  }
  const tool = (k: ToolKey) => {
    switch (k) {
      case 'mail': {
        const rows = chosenRows()
        const body = rows.map((r) => def.cols.map((c) => r.cells[c.key] ?? '').join(' | ')).join('\n')
        window.location.href = `mailto:?subject=${encodeURIComponent(def.title)}&body=${encodeURIComponent(body)}`
        return
      }
      case 'add':
        return newDoc()
      case 'list':
        setQuick('')
        setApplied(null)
        setVal('')
        setCol('SELECT')
        setOp('WHERE')
        setPage(0)
        return
      case 'note':
        return viewDoc()
      case 'chat':
        return nav('/messages')
      case 'edit':
        return editDoc()
      case 'globe':
        return nav('/display')
      case 'copy':
      case 'copyAll': {
        const rows = chosenRows()
        if (!rows.length) return toast('Select a record first', 'error')
        void navigator.clipboard?.writeText(rows.map((r) => def.cols.map((c) => r.cells[c.key] ?? '').join('\t')).join('\n'))
        return toast(`${rows.length} row(s) copied`)
      }
      case 'print':
      case 'fax':
      case 'printAll':
        return window.print()
      case 'scanner':
        return viewDoc()
      case 'excel':
      case 'download':
        return exportCsv()
      case 'docs':
        return nav('/utilities/document-center')
      case 'link':
        return nav('/utilities/regenerate-link')
      case 'stack':
        return nav('/utilities/data-management')
      case 'columns':
        return
    }
  }

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10, height: 30 }}>
        <span className="ma-title" style={{ marginRight: 10 }}>
          {def.title}
        </span>
        <IBtn lg title="New" onClick={newDoc}>
          <PlusIcon />
        </IBtn>
        <IBtn lg title="View" onClick={viewDoc}>
          <EyeIcon />
        </IBtn>
        <IBtn lg title="Find" onClick={() => document.getElementById('ma-quick')?.focus()}>
          <FindIcon />
        </IBtn>
        <IBtn lg title="Filter" onClick={() => setShowFilter(!showFilter)}>
          <FunnelIcon />
        </IBtn>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, whiteSpace: 'nowrap' }}>
        <span className="ma-search" style={{ width: 105 }}>
          <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 3 }}>
            <span
              className="ma-grid"
              style={{ border: 0, background: 'transparent', overflow: 'visible' }}
              onClick={() =>
                setChecked(checked.size === pageRows.length && pageRows.length > 0 ? new Set() : new Set(pageRows.map((r) => r.id)))
              }
            >
              <span className={`cbox${checked.size > 0 && checked.size === pageRows.length ? ' is-on' : ''}`} style={{ cursor: 'pointer' }} />
            </span>
          </span>
          <span className="ma-search-ico" style={{ width: 24, borderRight: 0, background: 'transparent' }}>
            <SearchLens size={20} />
          </span>
          <input id="ma-quick" value={quick} onChange={(e) => setQuick(e.target.value)} aria-label="Quick search" />
        </span>
        {showFilter && (
          <>
            <Select value={col} onChange={setCol} width={125} options={['SELECT', ...def.cols.filter((c) => c.label).map((c) => c.label)]} />
            <Select value={op} onChange={setOp} width={95} options={OPS} />
            <Input value={val} onChange={setVal} width={78} onEnter={() => setApplied({ col, op, val })} />
            <Btn round onClick={() => (colKey ? setValuePick(true) : toast('Select a column first', 'error'))}>
              value
            </Btn>
            <IBtn title="Search" onClick={() => setApplied(col === 'SELECT' ? null : { col, op, val })}>
              <MagnifierIcon />
            </IBtn>
          </>
        )}
        <span style={{ borderLeft: '1px solid #c3c3c3', height: 20 }} />
        <Select value={approval} onChange={setApproval} width={170} options={['SPECIMEN COLLECTED', 'APPROVED', 'PENDING', 'REJECTED']} />
        <IBtn
          title="Approve"
          onClick={() => {
            const n = chosenRows().length
            toast(n ? `${n} record(s) approved` : 'Select a record first', n ? 'ok' : 'error')
          }}
        >
          <StampIcon />
        </IBtn>
        <span style={{ borderLeft: '1px solid #c3c3c3', height: 20 }} />
        <IBtn title="Sort" onClick={() => setAsc(!asc)}>
          <SortIcon />
        </IBtn>
        <IBtn bare title="Previous" onClick={() => setPage(Math.max(0, pg - 1))}>
          <OrangeArrow dir="left" />
        </IBtn>
        <Input value={`${pg * PAGE}-${pg * PAGE + PAGE}`} readOnly width={40} />
        <IBtn bare title="Next" onClick={() => setPage(Math.min(pages - 1, pg + 1))}>
          <OrangeArrow dir="right" />
        </IBtn>
        <Rows n={pageRows.length} />
      </div>

      <div style={{ marginTop: 4 }}>
        <Grid
          cols={def.cols}
          rows={pageRows.map((r) => ({ id: r.id, cells: r.cells }))}
          height={def.hscroll ? 352 : 366}
          checkbox
          yellowCheckHeader={def.yellowChk}
          checked={checked}
          onCheck={(id) => {
            const n = new Set(checked)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            setChecked(n)
          }}
          selected={selected}
          onSelect={setSelected}
          onOpen={(id) => setView(all.find((r) => r.id === id) ?? null)}
          fillWidth={false}
        />
        {def.hscroll && <HScroll thumb={def.hscroll} />}
      </div>

      <div className="ma-noprint" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
        {def.tools.map((k) => (
          <ToolBtn key={k} k={k} title={TOOL_TITLES[k]} onClick={() => tool(k)} />
        ))}
        <Select
          value={action}
          width={100}
          options={['SELECT', 'PRINT', 'EXPORT', 'VIEW', 'EDIT']}
          onChange={(v) => {
            setAction('SELECT')
            if (v === 'PRINT') window.print()
            else if (v === 'EXPORT') exportCsv()
            else if (v === 'VIEW') viewDoc()
            else if (v === 'EDIT') editDoc()
          }}
        />
      </div>

      {valuePick && colKey && (
        <PickList
          title={`Values - ${col}`}
          options={[...new Set(all.map((r) => r.cells[colKey] ?? '').filter(Boolean))]}
          onClose={() => setValuePick(false)}
          onPick={(v) => {
            setVal(v)
            setOp(op === 'WHERE' ? '=' : op)
            setApplied({ col, op: op === 'WHERE' ? '=' : op, val: v })
            setValuePick(false)
          }}
        />
      )}
      {view && <ViewDialog def={def} row={view} onClose={() => setView(null)} />}
      {edit && def.source === 'docs' && <DocDialog slug={slug} def={def} row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {edit && def.source === 'party' && <PartyDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {edit && def.source === 'services' && <ServiceDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

/* ── View dialog ───────────────────────────────────────────────────────── */
function ViewDialog({ def, row, onClose }: { def: ModuleDef; row: RawRow; onClose: () => void }) {
  const lines = row.detail && 'lines' in row.detail ? row.detail.lines : []
  return (
    <Dialog
      title={def.title}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Btn onClick={() => window.print()}>Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </>
      }
    >
      <div className="ma-form" style={{ gridTemplateColumns: '140px 1fr' }}>
        {def.cols
          .filter((c) => c.label)
          .map((c) => (
            <FragmentRow key={c.key} label={c.label} value={row.cells[c.key] ?? ''} />
          ))}
      </div>
      {lines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Grid
            compact
            cols={[C('item', 'Medicine / Item', 260), C('qty', 'Qty', 60, 'right'), C('rate', 'Rate', 80, 'right'), C('amount', 'Amount', 90, 'right')]}
            rows={lines.map((l, i) => ({
              id: i,
              cells: { item: l.name, qty: String(l.qty), rate: amt(l.unitPrice), amount: amt(l.qty * l.unitPrice - l.discount) },
            }))}
          />
        </div>
      )}
    </Dialog>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <label className="ma-bold-label">{label}</label>
      <span>{value || '-'}</span>
    </>
  )
}

/* ── Whole-sale document entry ─────────────────────────────────────────── */
function DocDialog({ slug, def, row, onClose }: { slug: string; def: ModuleDef; row?: RawRow; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const parties = useLiveQuery(async () => [...(await db.customers.toArray()), ...(await db.suppliers.toArray())].map((p) => p.name.toUpperCase()), [], [] as string[])
  const fields = def.fields ?? []
  const [vals, setVals] = useState<Record<string, string>>(() => {
    if (row) return { ...row.cells }
    const v: Record<string, string> = {}
    for (const f of fields) {
      if (f.kind === 'date') v[f.key] = dmy(Date.now())
      else if (f.kind === 'user') v[f.key] = user?.name.toUpperCase() ?? ''
      else if (f.kind === 'location') v[f.key] = d.location
      else v[f.key] = ''
    }
    return v
  })
  const [pick, setPick] = useState<string | null>(null)
  const label = (key: string) => def.cols.find((c) => c.key === key)?.label || (key === 'docNo' ? 'Doc No' : key === 'total' ? 'Amount' : key)
  const required = fields.find((f) => f.kind === 'party')?.key

  const save = async () => {
    if (required && !vals[required]?.trim()) return toast(`${label(required)} is required`, 'error')
    const values = { ...vals }
    if (!row && fields.some((f) => f.kind === 'docno')) values.docNo = await nextDocNo(def.prefix ?? 'DOC')
    for (const f of fields) if (f.kind === 'money' && values[f.key]) values[f.key] = (parseFloat(values[f.key]) || 0).toFixed(2)
    await saveDoc(slug, values, row ? Number(String(row.id).slice(1)) : undefined)
    toast(row ? 'Record updated' : 'Record saved')
    onClose()
  }

  return (
    <Dialog
      title={`${def.title} - ${row ? 'Edit' : 'New'}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Btn onClick={save}>Save</Btn>
          {row && (
            <Btn
              onClick={async () => {
                await deleteDocs(slug, [Number(String(row.id).slice(1))])
                toast('Record deleted')
                onClose()
              }}
            >
              Delete
            </Btn>
          )}
          <Btn onClick={onClose}>cancel</Btn>
        </>
      }
    >
      <div className="ma-form">
        {fields.map((f) => (
          <FieldRow key={f.key} label={label(f.key)} req={f.key === required}>
            {f.kind === 'location' ? (
              <Select plain value={vals[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} options={d.locations} width={200} />
            ) : f.kind === 'docno' ? (
              <Input value={vals[f.key] || '(auto)'} readOnly width={200} />
            ) : f.kind === 'user' ? (
              <Input value={vals[f.key]} readOnly width={200} />
            ) : f.kind === 'party' ? (
              <span style={{ display: 'inline-flex' }}>
                <Input value={vals[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} width={200} />
                <button type="button" className="ma-lookup" onClick={() => setPick(f.key)} title="Lookup">
                  <MagnifierIcon size={13} />
                </button>
              </span>
            ) : (
              <Input value={vals[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} width={200} />
            )}
          </FieldRow>
        ))}
      </div>
      {pick && (
        <PickList
          title="Party"
          options={parties}
          onClose={() => setPick(null)}
          onPick={(v) => {
            setVals({ ...vals, [pick]: v })
            setPick(null)
          }}
        />
      )}
    </Dialog>
  )
}

function FieldRow({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <>
      <label className="ma-label">
        {label}
        {req && <span className="ma-req">*</span>}
      </label>
      <span>{children}</span>
    </>
  )
}

/* ── Party Master entry (writes the real customer / supplier tables) ───── */
function PartyDialog({ row, onClose }: { row?: RawRow; onClose: () => void }) {
  const toast = useToast()
  const isSup = row ? String(row.id).startsWith('sup') : false
  const id = row ? Number(String(row.id).replace(/\D/g, '')) : undefined
  const existing = useLiveQuery(async () => (id === undefined ? undefined : isSup ? db.suppliers.get(id) : db.customers.get(id)), [id, isSup])
  const [type, setType] = useState(isSup ? 'SUPPLIERS' : 'CUSTOMER')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [limit, setLimit] = useState('0')
  const [loaded, setLoaded] = useState(false)
  if (existing && !loaded) {
    setName(existing.name)
    setPhone(existing.phone ?? '')
    setEmail(existing.email ?? '')
    setAddress(existing.notes ?? '')
    if (!isSup) setLimit(String((existing as Customer).creditLimit / 100))
    setLoaded(true)
  }

  const save = async () => {
    if (!name.trim()) return toast('Facilty Name is required', 'error')
    const base = { name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, notes: address.trim() || undefined }
    if (type === 'SUPPLIERS') {
      if (row && isSup) await db.suppliers.update(id!, base)
      else await db.suppliers.add(base)
    } else {
      const creditLimit = Math.round((parseFloat(limit) || 0) * 100)
      if (row && !isSup) await db.customers.update(id!, { ...base, creditLimit })
      else await db.customers.add({ ...base, balance: 0, creditLimit, createdAt: Date.now() })
    }
    toast('Party saved')
    onClose()
  }
  return (
    <Dialog
      title={`Party Master - ${row ? 'Edit' : 'New'}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Btn onClick={save}>Save</Btn>
          <Btn onClick={onClose}>cancel</Btn>
        </>
      }
    >
      <div className="ma-form">
        <FieldRow label="Facilty Name" req>
          <Input value={name} onChange={setName} width={220} autoFocus />
        </FieldRow>
        <FieldRow label="Type">
          <Select value={type} onChange={setType} options={['CUSTOMER', 'SUPPLIERS']} width={220} />
        </FieldRow>
        <FieldRow label="Address">
          <Input value={address} onChange={setAddress} width={220} />
        </FieldRow>
        <FieldRow label="Telephone">
          <Input value={phone} onChange={setPhone} width={220} />
        </FieldRow>
        <FieldRow label="Email">
          <Input value={email} onChange={setEmail} width={220} />
        </FieldRow>
        {type === 'CUSTOMER' && (
          <FieldRow label="Credit Limit">
            <Input value={limit} onChange={setLimit} width={220} />
          </FieldRow>
        )}
      </div>
    </Dialog>
  )
}

/* ── Services Master entry (service = product without stock) ───────────── */
function ServiceDialog({ row, onClose }: { row?: RawRow; onClose: () => void }) {
  const toast = useToast()
  const id = row ? Number(String(row.id).slice(1)) : undefined
  const existing = useLiveQuery(async () => (id === undefined ? undefined : db.products.get(id)), [id])
  const [name, setName] = useState('')
  const [charges, setCharges] = useState('')
  const [outsource, setOutsource] = useState('NO')
  const [loaded, setLoaded] = useState(false)
  if (existing && !loaded) {
    setName(existing.name)
    setCharges((existing.price / 100).toFixed(2))
    setOutsource(existing.brand === 'OUTSOURCED' ? 'YES' : 'NO')
    setLoaded(true)
  }
  const save = async () => {
    if (!name.trim()) return toast('Service Type is required', 'error')
    const price = Math.round((parseFloat(charges) || 0) * 100)
    const now = Date.now()
    if (existing) {
      await db.products.update(existing.id!, { name: name.trim().toUpperCase(), price, brand: outsource === 'YES' ? 'OUTSOURCED' : undefined, updatedAt: now })
    } else {
      const n = (await db.products.filter((p) => !p.trackStock).count()) + 1
      let sku = `SRV-${n}`
      while (await db.products.where('sku').equals(sku).first()) sku = `SRV-${n}-${Math.floor(Math.random() * 1000)}`
      await db.products.add({
        sku,
        name: name.trim().toUpperCase(),
        fitment: [],
        cost: 0,
        price,
        stock: 0,
        reorderLevel: 0,
        taxable: false,
        serialized: false,
        trackStock: false,
        active: true,
        brand: outsource === 'YES' ? 'OUTSOURCED' : undefined,
        createdAt: now,
        updatedAt: now,
      })
    }
    toast('Service saved')
    onClose()
  }
  return (
    <Dialog
      title={`Services Master - ${row ? 'Edit' : 'New'}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Btn onClick={save}>Save</Btn>
          {existing && (
            <Btn
              onClick={async () => {
                await db.products.update(existing.id!, { active: false })
                await db.products.delete(existing.id!)
                toast('Service deleted')
                onClose()
              }}
            >
              Delete
            </Btn>
          )}
          <Btn onClick={onClose}>cancel</Btn>
        </>
      }
    >
      <div className="ma-form">
        <FieldRow label="Service Type" req>
          <Input value={name} onChange={setName} width={220} autoFocus />
        </FieldRow>
        <FieldRow label="Service Charges">
          <Input value={charges} onChange={setCharges} width={220} />
        </FieldRow>
        <FieldRow label="Outsource?">
          <Select value={outsource} onChange={setOutsource} options={['NO', 'YES']} width={220} />
        </FieldRow>
      </div>
    </Dialog>
  )
}

/* ── Modules tab with nothing selected (screenshot 11.15.09) ───────────── */
function RefreshGlyph({ double }: { double?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M14 6a6 6 0 1 0 1 5" stroke="#3c4f60" strokeWidth="2.2" fill="none" />
      <path d="M15 1.5v5h-5" fill="#3c4f60" />
      {double && <path d="M4 12a6 6 0 0 0 9 1" stroke="#7a8b99" strokeWidth="1.4" fill="none" />}
    </svg>
  )
}

export function ModulesEmpty() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const all = MODULE_GROUPS.flatMap((g) => g.items)
  const firstSlug = all.find((i) => q && i.label.toLowerCase().includes(q.toLowerCase()))?.slug
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 30 }}>
        <span style={{ marginLeft: 52 }}>
          <IBtn lg title="New Sale" onClick={() => nav('/sell')}>
            <PlusIcon />
          </IBtn>
        </span>
        <span style={{ marginLeft: 38, display: 'flex', gap: 6 }}>
          <IBtn lg title="Find" onClick={() => document.getElementById('ma-mod-q')?.focus()}>
            <FindIcon />
          </IBtn>
          <IBtn lg title="Filter">
            <FunnelIcon />
          </IBtn>
          <IBtn lg title="Upload" onClick={() => nav('/utilities/sync')}>
            <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
              <ToolGlyph k="download" />
            </span>
          </IBtn>
        </span>
        <span style={{ marginLeft: 104, display: 'flex', gap: 6 }}>
          <IBtn lg title="Documents" onClick={() => nav('/utilities/document-center')}>
            <ToolGlyph k="list" />
          </IBtn>
          <IBtn lg title="Refresh" onClick={() => window.location.reload()}>
            <RefreshGlyph />
          </IBtn>
          <IBtn lg title="Synchronize" onClick={() => nav('/utilities/sync')}>
            <RefreshGlyph double />
          </IBtn>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
        <span className="ma-search" style={{ width: 160 }}>
          <span className="ma-search-ico">
            <SearchLens />
          </span>
          <input id="ma-mod-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && firstSlug && nav(`/modules/${firstSlug}`)} />
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 7, marginRight: 26 }}>
          <ToolBtn k="copyAll" title="Copy" />
          <ToolBtn k="printAll" title="Print" onClick={() => window.print()} />
          <ToolBtn k="columns" title="Columns" />
        </span>
      </div>
      <div className="ma-grid" style={{ marginTop: 3, height: 586 }}>
        <div style={{ height: 25, background: 'linear-gradient(to bottom,#f0f0f0,#d8d8d8)', borderBottom: '1px solid #c3c3c3' }} />
        {q && (
          <div>
            {all
              .filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
              .map((i) => (
                <div key={i.slug} className="ma-side-item" style={{ fontSize: 11 }} onClick={() => nav(`/modules/${i.slug}`)}>
                  {i.label}
                </div>
              ))}
          </div>
        )}
      </div>
      <div className="ma-noprint" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
        {(['mail', 'add', 'list', 'note', 'chat', 'edit', 'globe', 'excel', 'copy', 'print', 'scanner', 'fax', 'download', 'docs', 'link', 'stack'] as ToolKey[]).map(
          (k) => (
            <ToolBtn
              key={k}
              k={k}
              title={TOOL_TITLES[k]}
              onClick={() => {
                if (k === 'add') nav('/sell')
                else if (k === 'chat') nav('/messages')
                else if (k === 'globe') nav('/display')
                else if (k === 'print' || k === 'fax') window.print()
                else if (k === 'docs') nav('/utilities/document-center')
                else if (k === 'link') nav('/utilities/regenerate-link')
                else if (k === 'stack') nav('/utilities/data-management')
              }}
            />
          ),
        )}
        <Select value="SELECT" width={100} options={['SELECT']} />
      </div>
    </div>
  )
}
