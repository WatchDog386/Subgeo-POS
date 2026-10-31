import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Customer, Payment, Product, Sale, SaleLine, ServiceJob, Supplier } from '../../db/types'
import { completeSale, refundSale } from '../../db/sales'
import { toCents } from '../../lib/money'
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
import { Btn, Check, Dialog, Grid, HScroll, IBtn, Input, PickList, Rows, SearchBar, Select, ToolBtn, type Col, type Opt } from '../ui'

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
  /** 'grid': "+" opens an in-panel entry table with the list's headers instead of the pop-up form. */
  entry?: 'grid'
}

/** What to type in each field: shown greyed inside the empty input. */
const FIELD_HINTS: Record<string, string> = {
  accId: 'Account code, e.g. 4010',
  address: 'Postal / street address',
  advDetails: 'What the advance is for',
  approx: 'Estimated cost, e.g. 2500.00',
  cheque: 'Cheque number (blank if cash/M-Pesa)',
  cost: 'Buying price per unit, e.g. 45.00',
  customer: 'Type or look up the customer',
  depositTo: 'Account the money goes to, e.g. MPESA',
  expense: 'Expense account, e.g. PURCHASES MEDICINE',
  faxNo: 'Fax (optional)',
  fromAccount: 'Paying account, e.g. CASH / BANK',
  group: 'Product group, e.g. SYRUPS, TABS/CAPSULES',
  indentNo: 'Indent no. this follows, e.g. PI-3-26',
  indentor: 'Who asked for the items',
  invoice: "Supplier's invoice / receipt no.",
  invoiceNo: 'Invoice number',
  lpoNo: 'LPO no. this receives, e.g. PO-4-26',
  name: 'Full name as it should print',
  narration: 'What the payment is for',
  packSize: 'Units per pack, e.g. 1 or 100',
  partyId: 'Party code (optional)',
  pettyCash: 'Petty cash account',
  phoneNo: 'Phone, e.g. 0712 345 678',
  purpose: 'Why: reorder, new stock, …',
  quoteNo: 'Quotation no. this follows',
  receivedBy: 'Who received the goods',
  ref: 'Reference / description',
  refNo: 'Reference number',
  retail: 'Retail price per unit, e.g. 150.00',
  status: 'e.g. GOOD RECEIVED, INDENT APPROVED',
  supplierName: 'Type or look up the supplier',
  total: 'Total value, e.g. 1746.00',
  type: 'S = stock item, N = non-stock',
  uom: 'Unit, e.g. ML, MG, TABS',
  vendorName: 'Type or look up the vendor',
  whole: 'Wholesale price per unit',
}
const hintFor = (f: Field): string | undefined =>
  FIELD_HINTS[f.key] ?? (f.kind === 'date' ? 'dd-mm-yyyy' : f.kind === 'money' ? '0.00' : f.kind === 'party' ? 'Type or look up a name' : undefined)

/** Fields filled from the newest record of the same register (what the shop usually types). */
const REPEAT_FIELDS = new Set(['expense', 'status', 'receivedBy', 'fromAccount', 'pettyCash', 'depositTo', 'group', 'uom', 'type', 'packSize', 'indentor'])

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
      C('docNo', 'Mrn No', 100),
      C('mrnDate', 'Mrn Date', 100),
      C('invoice', 'Invoice/Receipt', 100),
      C('vendorName', 'Vendor Name', 190),
      C('total', 'TOTAL VALUE', 100, 'right'),
      C('expense', 'Expense A/c', 200),
      C('receivedBy', 'Received By', 100),
      C('status', 'Status', 200),
      C('phoneNo', 'Phone No', 120),
    ],
    entry: 'grid',
    fields: [
      { key: 'docNo', kind: 'docno' },
      { key: 'mrnDate', kind: 'date' },
      { key: 'invoice', kind: 'text' },
      { key: 'vendorName', kind: 'party' },
      { key: 'total', kind: 'money' },
      { key: 'expense', kind: 'text' },
      { key: 'receivedBy', kind: 'text' },
      { key: 'status', kind: 'text' },
      { key: 'phoneNo', kind: 'text' },
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
  /* Purchases dashboard — Petty Cash Issue (screenshot 12.24.48 (1)). */
  'petty-cash-voucher': {
    title: 'Petty Cash Voucher',
    source: 'docs',
    prefix: 'PCV',
    hscroll: 0.65,
    tools: BASE_TOOLS,
    cols: [
      C('location', 'Location', 310),
      C('docNo', 'Vch No', 215),
      C('vchDate', 'VchDate', 215),
      C('pettyCash', 'Petty Cash A/C', 240),
      C('accId', 'Acc ID', 170),
      C('narration', 'Narration', 260),
    ],
    fields: [
      { key: 'location', kind: 'location' },
      { key: 'docNo', kind: 'docno' },
      { key: 'vchDate', kind: 'date' },
      { key: 'pettyCash', kind: 'text' },
      { key: 'accId', kind: 'text' },
      { key: 'narration', kind: 'text' },
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
/** Approval workflow stamps (Modules list → approval dropdown + stamp). */
const APPROVALS = ['APPROVAL REQUEST', 'APPROVED', 'REJECTED', 'ON HOLD'] as const
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
  const [approval, setApproval] = useState<string>(APPROVALS[0])
  const { user } = useSession()
  const [entering, setEntering] = useState(false)
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)
  const [checked, setChecked] = useState<Set<string | number>>(new Set())
  const [selected, setSelected] = useState<string | number | undefined>()
  const [showFilter, setShowFilter] = useState(true)
  const [valuePick, setValuePick] = useState(false)
  const [view, setView] = useState<RawRow | null>(null)
  const [edit, setEdit] = useState<RawRow | 'new' | null>(null)
  const [action, setAction] = useState('SELECT')
  const [otcOpen, setOtcOpen] = useState(false)
  const [refund, setRefund] = useState<Sale | null | undefined>(undefined)

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
    if (def.source === 'otc') setOtcOpen(true)
    else if (def.source === 'otc-return') setRefund(undefined)
    else if (def.source === 'service') nav('/service')
    else if (def.entry === 'grid') setEntering(true)
    else setEdit('new')
  }
  const editDoc = () => {
    const t = target()
    if (!t) return toast('Select a record first', 'error')
    if (def.source === 'otc') setRefund(t.detail as Sale)
    else if (def.source === 'otc-return') setView(t)
    else if (def.source === 'service') nav('/service')
    else setEdit(t)
  }
  const viewDoc = () => {
    const t = target()
    if (!t) return toast('Select a record first', 'error')
    setView(t)
  }
  /** Stamp the approval status on the chosen documents (synced to every till). */
  const approve = async () => {
    const rows = chosenRows()
    if (!rows.length) return toast('Tick or select the record(s) to stamp first', 'error')
    const hasStatus = def.fields?.some((f) => f.key === 'status')
    const at = dmy(Date.now())
    for (const r of rows) {
      const id = Number(String(r.id).slice(1))
      const doc = await db.docs.get(id)
      if (!doc) continue
      const values: Record<string, string> = { ...doc.values, approval, approvedBy: user?.name.toUpperCase() ?? '', approvedOn: at }
      if (hasStatus) values.status = approval
      await saveDoc(slug, values, id)
    }
    toast(`${rows.length} record(s) marked ${approval}`)
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

  if (entering) return <GridEntry slug={slug} def={def} onClose={() => setEntering(false)} />

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
        {def.source === 'docs' && (
          <>
            <Select value={approval} onChange={setApproval} width={170} options={[...APPROVALS]} />
            <IBtn title={`Set ${approval} on the ticked / selected record(s)`} onClick={() => void approve()}>
              <StampIcon />
            </IBtn>
          </>
        )}
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
      {otcOpen && def.source === 'otc' && <OtcBillDialog onClose={() => setOtcOpen(false)} />}
      {refund !== undefined && <OtcReturnDialog sale={refund ?? undefined} onClose={() => setRefund(undefined)} />}
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
        {row.cells.approval && <FragmentRow label="Approval" value={`${row.cells.approval}${row.cells.approvedBy ? ` by ${row.cells.approvedBy}` : ''}${row.cells.approvedOn ? ` on ${row.cells.approvedOn}` : ''}`} />}
        {row.cells.attachment && <FragmentRow label="Document" value={row.cells.attachmentName || 'attachment'} />}
      </div>
      {row.cells.attachment &&
        (row.cells.attachment.startsWith('data:image') ? (
          <img
            src={row.cells.attachment}
            alt={row.cells.attachmentName || 'entry document'}
            style={{ maxWidth: '100%', maxHeight: 320, marginTop: 10, border: '1px solid #c3c3c3' }}
          />
        ) : (
          <a href={row.cells.attachment} download={row.cells.attachmentName || 'document'} style={{ display: 'inline-block', marginTop: 10 }} className="ma-btn">
            Open document ({row.cells.attachmentName || 'file'})
          </a>
        ))}
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

/* ── OTC Medicine Issue/Bill entry ─────────────────────────────────────── */
const PAY_OPTIONS: Opt[] = [
  { value: 'cash', label: 'CASH COLLECTION ACCOUNT' },
  { value: 'mpesa', label: 'MPESA COLLECTION ACCOUNT' },
  { value: 'card', label: 'CREDIT CARD COLLECTION ACCOUNT' },
  { value: 'account', label: 'CREDIT ACCOUNT' },
]

interface OtcLine extends SaleLine {
  key: string
  product?: Product
  qtyText: string
  rateText: string
  discText: string
}

function LineNum({ value, onChange, width = 60 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <input
      className="ma-input is-plain"
      style={{ width, height: 19, padding: '0 4px', fontSize: 11 }}
      value={value}
      inputMode="decimal"
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function OtcBillDialog({ onClose }: { onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const [category, setCategory] = useState(d.patientCategory.toUpperCase())
  const [pay, setPay] = useState('cash')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<OtcLine[]>([])
  const [pickItem, setPickItem] = useState(false)
  const [pickCat, setPickCat] = useState(false)
  const [saving, setSaving] = useState(false)

  const labelOf = (p: Product) => `${p.name}${p.sku ? ` [${p.sku}]` : ''}`
  const addLine = (name: string) => {
    const p = products.find((x) => labelOf(x).toLowerCase() === name.toLowerCase())
    if (!p) return toast('Pick a medicine from the list', 'error')
    if (lines.some((l) => l.product?.id === p.id)) {
      toast(`${p.name} is already on the bill — edit its quantity`, 'error')
      return
    }
    setLines((ls) => [
      ...ls,
      {
        key: String(Date.now()) + String(ls.length),
        product: p,
        name: p.name,
        sku: p.sku,
        qty: 1,
        unitPrice: p.price,
        unitCost: p.cost,
        discount: 0,
        taxable: p.taxable,
        qtyText: '1',
        rateText: (p.price / 100).toFixed(2),
        discText: '0',
      },
    ])
  }
  const setText = (key: string, field: 'qty' | 'rate' | 'disc', text: string) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l
        const upd: OtcLine = { ...l, [field === 'qty' ? 'qtyText' : field === 'rate' ? 'rateText' : 'discText']: text }
        upd.qty = Math.max(0, Number(upd.qtyText) || 0)
        upd.unitPrice = Math.max(0, toCents(upd.rateText))
        upd.discount = Math.max(0, toCents(upd.discText))
        return upd
      }),
    )

  const lineAmount = (l: OtcLine) => Math.max(0, l.qty * l.unitPrice - l.discount)
  const total = lines.reduce((s, l) => s + lineAmount(l), 0)

  const save = async () => {
    if (!user || saving) return
    if (!lines.length) return toast('Add at least one medicine to the bill', 'error')
    if (lines.some((l) => l.qty <= 0)) return toast('Every line needs a quantity above zero', 'error')
    if (pay === 'account' && category.trim().toUpperCase() === d.patientCategory.toUpperCase())
      return toast('For a CREDIT ACCOUNT bill, type or pick the customer who is buying', 'error')
    setSaving(true)
    try {
      let customerId: number | undefined
      const cat = category.trim().toUpperCase()
      if (cat && cat !== d.patientCategory.toUpperCase()) {
        const existing = customers.find((c) => c.name.toUpperCase() === cat)
        customerId = existing?.id ?? ((await db.customers.add({ name: cat, balance: 0, creditLimit: 0, createdAt: Date.now() })) as number)
      }
      const saleLines: SaleLine[] = lines.map(({ key: _k, qtyText: _q, rateText: _r, discText: _c, ...l }) => ({ ...l }))
      const sale = await completeSale({
        lines: saleLines,
        discount: 0,
        payments: [{ method: pay as Payment['method'], amount: total }],
        customerId,
        userId: user.id ?? 0,
        note: narration.trim() || undefined,
      })
      toast(`Bill ${billNo(sale, d.billPrefix)} issued`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="OTC Medicine Issue/Bill - New"
      onClose={onClose}
      width={690}
      footer={
        <>
          <Btn onClick={() => void save()} disabled={saving || !lines.length}>
            Save &amp; Issue Bill
          </Btn>
          <Btn onClick={onClose}>cancel</Btn>
        </>
      }
    >
      <div className="ma-form" style={{ gridTemplateColumns: '130px 1fr' }}>
        <FieldRow label="Bill No.">
          <Input value="(auto)" readOnly width={140} />
        </FieldRow>
        <FieldRow label="Date">
          <Input value={dmy(Date.now())} readOnly width={140} />
        </FieldRow>
        <FieldRow label="Patient Category" req>
          <span style={{ display: 'inline-flex' }}>
            <Input value={category} onChange={(v) => setCategory(v.toUpperCase())} width={220} />
            <button type="button" className="ma-lookup" onClick={() => setPickCat(true)} title="Customer lookup">
              <MagnifierIcon size={13} />
            </button>
          </span>
        </FieldRow>
        <FieldRow label="Narration">
          <Input value={narration} onChange={setNarration} width={220} />
        </FieldRow>
        <FieldRow label="User Name">
          <Input value={user?.name.toUpperCase() ?? ''} readOnly width={220} />
        </FieldRow>
        <FieldRow label="Payable By" req>
          <Select value={pay} onChange={setPay} options={PAY_OPTIONS} width={250} />
        </FieldRow>
        <FieldRow label="Bill Amount">
          <Input value={amt(total)} readOnly width={140} />
        </FieldRow>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <Btn round onClick={() => setPickItem(true)}>
            + Add medicine
          </Btn>
          <span style={{ fontSize: 11, color: '#666' }}>Double-click a row to remove it. Stock is deducted when the bill is saved.</span>
        </div>
        <Grid
          compact
          height={Math.min(320, Math.max(60, 26 + lines.length * 23 + 23))}
          cols={[
            { key: 'name', label: 'Medicine / Item', width: 240 },
            { key: 'qty', label: 'Qty', width: 70 },
            { key: 'rate', label: 'Rate', width: 90 },
            { key: 'disc', label: 'Discount', width: 90 },
            { key: 'amount', label: 'Amount', width: 90, align: 'right' },
          ]}
          rows={lines.map((l) => ({
            id: l.key,
            cells: {
              name: l.name + (l.sku ? ` [${l.sku}]` : ''),
              qty: <LineNum value={l.qtyText} onChange={(n) => setText(l.key, 'qty', n)} />,
              rate: <LineNum value={l.rateText} width={80} onChange={(n) => setText(l.key, 'rate', n)} />,
              disc: <LineNum value={l.discText} width={80} onChange={(n) => setText(l.key, 'disc', n)} />,
              amount: amt(lineAmount(l)),
            },
          }))}
          onOpen={(id) => setLines((ls) => ls.filter((l) => l.key !== id))}
        />
      </div>

      {pickItem && (
        <PickList
          title="Medicine"
          options={[...products].sort((a, b) => a.name.localeCompare(b.name)).map(labelOf)}
          onClose={() => setPickItem(false)}
          onPick={(v) => {
            addLine(v)
            setPickItem(false)
          }}
        />
      )}
      {pickCat && (
        <PickList
          title="Patient / Customer"
          options={customers.map((c) => c.name.toUpperCase())}
          onClose={() => setPickCat(false)}
          onPick={(v) => {
            setCategory(v)
            setPickCat(false)
          }}
        />
      )}
    </Dialog>
  )
}

/* ── OTC Medicine Isse Return ──────────────────────────────────────────── */
function OtcReturnDialog({ sale, onClose }: { sale?: Sale; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const [orig, setOrig] = useState<Sale | undefined>(sale)
  const [q, setQ] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})
  const [restock, setRestock] = useState(true)
  const [method, setMethod] = useState('cash')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const sales = useLiveQuery(async () => {
    const all = await db.sales.filter((s) => !s.refundOf && s.status !== 'voided').toArray()
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
  }, [], [] as Sale[])
  const shown = sales

  const lineReturnAmount = (i: number, l: SaleLine) => {
    const n = chosenQty(i, l)
    return n * l.unitPrice - Math.round((l.discount * n) / Math.max(1, l.qty))
  }
  const chosenQty = (i: number, l: SaleLine) => Math.min(Math.max(0, Number(qty[i]) || 0), l.qty - (l.refundedQty ?? 0))
  const amount = orig ? orig.lines.reduce((t, l, i) => t + lineReturnAmount(i, l), 0) : 0

  const save = async () => {
    if (!user || !orig || saving) return
    const qtyByLine: Record<number, number> = {}
    let any = false
    orig.lines.forEach((l, i) => {
      const n = chosenQty(i, l)
      if (n > 0) {
        qtyByLine[i] = n
        any = true
      }
    })
    if (!any) return toast('Enter the quantity to return', 'error')
    setSaving(true)
    try {
      const refund = await refundSale(orig.id!, { qtyByLine, restock, method: method as Payment['method'], userId: user.id ?? 0, reason: reason.trim() || undefined })
      toast(`Return ${refund.receiptNo} (${amt(-refund.total)}) recorded`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={orig ? `OTC Medicine Isse Return - ${billNo(orig, d.billPrefix)}` : 'OTC Medicine Isse Return - New Bill'} onClose={onClose} width={690}>
      {!orig ? (
        <>
          <div style={{ marginBottom: 4 }}>
            <SearchBar value={q} onChange={setQ} width={330} autoFocus />
          </div>
          <Grid
            compact
            height={300}
            cols={[
              { key: 'billNo', label: 'Bill No.', width: 150 },
              { key: 'date', label: 'Date', width: 100 },
              { key: 'amount', label: 'Bill Amount', width: 110, align: 'right' },
              { key: 'narration', label: 'First medicine on the bill', width: 240 },
            ]}
            rows={shown
              .filter((s) => !q.trim() || billNo(s, d.billPrefix).toLowerCase().includes(q.toLowerCase()) || s.lines.some((l) => l.name.toLowerCase().includes(q.toLowerCase())))
              .map((s) => ({
                id: s.id!,
                cells: { billNo: billNo(s, d.billPrefix), date: dmy(s.createdAt), amount: amt(s.total), narration: s.lines[0]?.name ?? '' },
              }))}
            onOpen={(id) => setOrig(shown.find((s) => s.id === id))}
          />
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Double-click a bill to start its return.</div>
        </>
      ) : (
        <>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 1fr' }}>
            <FieldRow label="Bill No.">
              <Input value={billNo(orig, d.billPrefix)} readOnly width={200} />
            </FieldRow>
            <FieldRow label="Date">
              <Input value={dmy(orig.createdAt)} readOnly width={140} />
            </FieldRow>
          </div>
          <Grid
            compact
            height={Math.min(300, 26 + orig.lines.length * 23 + 23)}
            cols={[
              { key: 'name', label: 'Medicine / Item', width: 250 },
              { key: 'avail', label: 'Available', width: 70, align: 'right' },
              { key: 'ret', label: 'Return', width: 80 },
              { key: 'amount', label: 'Amount', width: 100, align: 'right' },
            ]}
            rows={orig.lines.map((l, i) => {
              const avail = l.qty - (l.refundedQty ?? 0)
              return {
                id: i,
                cells: {
                  name: l.name + (l.sku ? ` [${l.sku}]` : ''),
                  avail: String(avail),
                  ret: avail > 0 ? <LineNum value={qty[i] ?? ''} onChange={(v) => setQty({ ...qty, [i]: v })} /> : '—',
                  amount: avail > 0 ? amt(lineReturnAmount(i, l)) : '—',
                },
              }
            })}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Check checked={restock} onChange={setRestock}>
              Put returned stock back
            </Check>
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 1fr', marginTop: 6 }}>
            <FieldRow label="Return To">
              <Select value={method} onChange={setMethod} options={PAY_OPTIONS} width={250} />
            </FieldRow>
            <FieldRow label="Reason">
              <Input value={reason} onChange={setReason} width={280} />
            </FieldRow>
            <FieldRow label="Refund Amount">
              <Input value={amt(amount)} readOnly width={140} />
            </FieldRow>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn onClick={() => void save()} disabled={saving || amount <= 0}>
              Save
            </Btn>
            <Btn onClick={() => setOrig(undefined)}>Back</Btn>
            <Btn onClick={onClose}>cancel</Btn>
          </div>
        </>
      )}
    </Dialog>
  )
}

/* ── Whole-sale document entry ─────────────────────────────────────────── */
const PICKED_NEW = '(new party) '

function DocDialog({ slug, def, row, onClose }: { slug: string; def: ModuleDef; row?: RawRow; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const parties = useLiveQuery(async () => [...(await db.customers.toArray()), ...(await db.suppliers.toArray())].map((p) => p.name.toUpperCase()), [], [] as string[])
  const fields = def.fields ?? []
  const register = useDocs(slug)
  const blank = (last: Record<string, string>) => {
    const v: Record<string, string> = {}
    for (const f of fields) {
      if (f.kind === 'date') v[f.key] = dmy(Date.now())
      else if (f.kind === 'user' || f.key === 'receivedBy') v[f.key] = user?.name.toUpperCase() ?? ''
      else if (f.kind === 'location') v[f.key] = d.location
      else v[f.key] = REPEAT_FIELDS.has(f.key) ? last[f.key] ?? '' : ''
    }
    return v
  }
  const [vals, setVals] = useState<Record<string, string>>(() => (row ? { ...row.cells } : blank({})))
  const [typed, setTyped] = useState(false)
  // Usual values (expense account, status…) come from the newest record once the register has loaded.
  const lastId = register[0]?.id
  useEffect(() => {
    if (!row && !typed && lastId !== undefined) setVals(blank(register[0].values))
  }, [lastId, d.location]) // eslint-disable-line react-hooks/exhaustive-deps
  const setField = (key: string, v: string) => {
    setTyped(true)
    setVals((cur) => ({ ...cur, [key]: v }))
  }
  const [pick, setPick] = useState<string | null>(null)
  const [pickExtra, setPickExtra] = useState('') // current text of the party field being picked
  // One scanned document per entry (supplier invoice, receipt…), kept as a data URL.
  const [file, setFile] = useState<{ name: string; data: string } | null>(() =>
    row?.cells.attachment ? { name: row.cells.attachmentName || 'document', data: row.cells.attachment } : null,
  )
  const fileInput = useRef<HTMLInputElement | null>(null)
  const label = (key: string) => def.cols.find((c) => c.key === key)?.label || (key === 'docNo' ? 'Doc No' : key === 'total' ? 'Amount' : key)
  const required = fields.find((f) => f.kind === 'party')?.key
  /** Vendor fields write new suppliers; customer fields write new customers. */
  const partyIsSupplier = (key: string) => /vendor|supplier/i.test(key)

  const pickFile = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast('Document is too big (max 5 MB)', 'error')
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = () => rej(r.error)
      r.readAsDataURL(f)
    })
    setFile({ name: f.name, data })
  }

  // The Medicine master is where a chemist's inventory starts: a new product is
  // added to stock at its cost/retail prices; edits refresh the prices.
  const upsertMedicine = async (values: Record<string, string>) => {
    const name = values.name.trim()
    if (!name) return
    const cost = toCents(values.cost || '0')
    const price = toCents(values.retail || values.whole || '0')
    const existingP = await db.products.filter((p) => p.name.toUpperCase() === name.toUpperCase()).first()
    if (existingP) await db.products.update(existingP.id!, { cost, price, updatedAt: Date.now() })
    else {
      await db.products.add({
        sku: values.docNo,
        name,
        fitment: [],
        cost,
        price,
        stock: 0,
        reorderLevel: 0,
        taxable: true,
        serialized: false,
        trackStock: !/^N/i.test((values.type || 'S').trim()),
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  const save = async () => {
    if (required && !vals[required]?.trim()) return toast(`${label(required)} is required`, 'error')
    const values = { ...vals }
    if (!row && fields.some((f) => f.kind === 'docno')) values.docNo = await nextDocNo(def.prefix ?? 'DOC')
    for (const f of fields) if (f.kind === 'money' && values[f.key]) values[f.key] = (parseFloat(values[f.key]) || 0).toFixed(2)
    if (file) {
      values.attachment = file.data
      values.attachmentName = file.name
    } else {
      delete values.attachment
      delete values.attachmentName
    }
    await saveDoc(slug, values, row ? Number(String(row.id).slice(1)) : undefined, user?.id)
    if (slug === 'medicine') await upsertMedicine(values)
    toast(row ? 'Record updated' : 'Record saved')
    onClose()
  }

  const saveParty = async (key: string, typed: string) => {
    const name = typed.trim().toUpperCase()
    if (!name) return toast('Type the party name first', 'error')
    if ((await db.customers.filter((c) => c.name.toUpperCase() === name).first()) || (await db.suppliers.filter((s) => s.name.toUpperCase() === name).first())) {
      return toast(`${name} already exists`, 'error')
    }
    if (partyIsSupplier(key)) await db.suppliers.add({ name, notes: 'Added from ' + def.title })
    else await db.customers.add({ name, balance: 0, creditLimit: 0, createdAt: Date.now() })
    toast(`${name} added to Party Master`)
    setVals((cur) => ({ ...cur, [key]: name }))
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
              <Select plain value={vals[f.key]} onChange={(v) => setField(f.key, v)} options={d.locations} width={200} />
            ) : f.kind === 'docno' ? (
              <Input value={vals[f.key] || '(auto)'} readOnly width={200} />
            ) : f.kind === 'user' ? (
              <Input value={vals[f.key]} readOnly width={200} />
            ) : f.kind === 'party' ? (
              <span style={{ display: 'inline-flex' }}>
                <Input value={vals[f.key]} onChange={(v) => setField(f.key, v)} width={200} placeholder={hintFor(f)} />
                <button
                  type="button"
                  className="ma-lookup"
                  onClick={() => {
                    setPickExtra(vals[f.key].trim().toUpperCase())
                    setPick(f.key)
                  }}
                  title="Lookup — also adds a typed new party"
                >
                  <MagnifierIcon size={13} />
                </button>
              </span>
            ) : (
              <Input value={vals[f.key]} onChange={(v) => setField(f.key, v)} width={200} placeholder={hintFor(f)} />
            )}
          </FieldRow>
        ))}
        <FieldRow label="Doc Upload">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,.pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void pickFile(f)
              }}
            />
            <Btn round onClick={() => fileInput.current?.click()}>
              Upload Document
            </Btn>
            {file && (
              <>
                <span className="ma-label" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                  {file.name}
                </span>
                <button type="button" className="ma-lookup" title="Remove document" onClick={() => setFile(null)}>
                  ×
                </button>
              </>
            )}
          </span>
        </FieldRow>
      </div>
      {pick && (
        <PickList
          title="Party"
          options={
            pickExtra.trim()
              ? [`${PICKED_NEW}${pickExtra.trim()}`, ...parties.filter((p) => p !== pickExtra.trim())]
              : parties
          }
          onClose={() => setPick(null)}
          onPick={(v) => {
            if (v.startsWith(PICKED_NEW)) void saveParty(pick, v.slice(PICKED_NEW.length))
            else setField(pick, v)
            setPick(null)
          }}
        />
      )}
    </Dialog>
  )
}

/* ── In-panel entry table ("+" on Pur/GRN (Direct Invoice)) ───────────────
   Same title bar and table headers as the list; each row of the table is one
   new record, typed straight into the cells. */
type EntryRow = { key: number; vals: Record<string, string>; file?: { name: string; data: string }; dirty?: boolean }

function GridEntry({ slug, def, onClose }: { slug: string; def: ModuleDef; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const existing = useDocs(slug)
  const fields = def.fields ?? []
  const required = fields.find((f) => f.kind === 'party')?.key
  const last = existing[0]?.values ?? {}
  const blank = (key: number): EntryRow => {
    const v: Record<string, string> = {}
    for (const f of fields) {
      if (f.kind === 'date') v[f.key] = dmy(Date.now())
      else if (f.kind === 'location') v[f.key] = d.location
      else if (f.kind === 'user' || f.key === 'receivedBy') v[f.key] = user?.name.toUpperCase() ?? ''
      else v[f.key] = REPEAT_FIELDS.has(f.key) && f.key !== 'receivedBy' ? last[f.key] ?? '' : ''
    }
    return { key, vals: v }
  }
  const [rows, setRows] = useState<EntryRow[]>(() => [blank(1)])
  // The register loads a moment after the screen: carry its usual values into untouched rows.
  const lastKey = existing[0]?.id
  useEffect(() => {
    if (lastKey === undefined) return
    setRows((list) => list.map((r) => (touched(r) ? r : { ...r, vals: blank(r.key).vals })))
  }, [lastKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(1)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const fileFor = useRef<number>(0)
  const kindOf = (key: string) => fields.find((f) => f.key === key)?.kind
  const pristine = blank(0).vals
  const touched = (r: EntryRow) => !!r.file || !!r.dirty

  const set = (rk: number, key: string, v: string) =>
    setRows((list) =>
      list.map((r) => {
        if (r.key !== rk) return r
        const vals = { ...r.vals, [key]: v }
        // Picking a known vendor fills in its phone number.
        if (key === 'vendorName' && 'phoneNo' in vals) {
          const s = suppliers.find((x) => x.name.toUpperCase() === v.trim().toUpperCase())
          if (s?.phone && !r.vals.phoneNo) vals.phoneNo = s.phone
        }
        return { ...r, vals, dirty: true }
      }),
    )
  const addRow = () => {
    const k = Math.max(0, ...rows.map((r) => r.key)) + 1
    setRows((list) => [...list, blank(k)])
    setSel(k)
  }
  const removeRow = () => {
    if (rows.length === 1) return setRows([blank(rows[0].key + 1)])
    setRows((list) => list.filter((r) => r.key !== sel))
    setSel(rows.find((r) => r.key !== sel)?.key ?? 0)
  }
  const pickFile = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast('Document is too big (max 5 MB)', 'error')
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = () => rej(r.error)
      r.readAsDataURL(f)
    })
    setRows((list) => list.map((r) => (r.key === fileFor.current ? { ...r, file: { name: f.name, data }, dirty: true } : r)))
  }

  const save = async () => {
    if (saving) return
    const todo = rows.filter(touched)
    if (!todo.length) return toast('Type the details into the table first', 'error')
    for (const [i, r] of todo.entries()) {
      if (required && !r.vals[required]?.trim()) return toast(`Row ${i + 1}: ${def.cols.find((c) => c.key === required)?.label ?? required} is required`, 'error')
      for (const f of fields) {
        if (f.kind === 'money' && r.vals[f.key]?.trim() && Number.isNaN(parseFloat(r.vals[f.key].replace(/,/g, ''))))
          return toast(`Row ${i + 1}: ${def.cols.find((c) => c.key === f.key)?.label ?? f.key} must be a number`, 'error')
      }
    }
    setSaving(true)
    try {
      for (const r of todo) {
        const values: Record<string, string> = {}
        for (const [k, v] of Object.entries(r.vals)) values[k] = kindOf(k) === 'party' ? v.trim().toUpperCase() : v.trim()
        if (fields.some((f) => f.kind === 'docno')) values.docNo = await nextDocNo(def.prefix ?? 'DOC')
        for (const f of fields) if (f.kind === 'money' && values[f.key]) values[f.key] = (parseFloat(values[f.key].replace(/,/g, '')) || 0).toFixed(2)
        if (r.file) {
          values.attachment = r.file.data
          values.attachmentName = r.file.name
        }
        // A vendor typed for the first time goes into the Party Master.
        const vendor = values.vendorName
        if (vendor && !(await db.suppliers.filter((s) => s.name.toUpperCase() === vendor).first())) {
          await db.suppliers.add({ name: vendor, phone: values.phoneNo || undefined, notes: 'Added from ' + def.title })
        }
        await saveDoc(slug, values, undefined, user?.id)
      }
      toast(`${todo.length} record(s) saved`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        void save()
      } else if (e.key === 'F3' || e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const cols = def.cols.filter((c) => c.label)
  const total = cols.reduce((s, c) => s + c.width, 0) + 20 + 34
  const filler = Math.max(0, 11 - rows.length)
  const sum = rows.reduce((s, r) => s + (parseFloat((r.vals.total ?? '').replace(/,/g, '')) || 0), 0)
  const cellInput = (r: EntryRow, c: Col, last: boolean) => {
    const kind = kindOf(c.key)
    const v = r.vals[c.key] ?? ''
    if (kind === 'docno') return <span style={{ color: '#888' }}>(auto)</span>
    if (kind === 'location')
      return (
        <select className="ma-input is-plain" style={{ width: '100%', height: 20, fontSize: 11 }} value={v} onChange={(e) => set(r.key, c.key, e.target.value)}>
          {d.locations.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      )
    return (
      <input
        className="ma-input is-plain"
        style={{ width: '100%', height: 20, padding: '0 3px', fontSize: 11, textAlign: c.align === 'right' ? 'right' : undefined, textTransform: kind === 'party' ? 'uppercase' : undefined }}
        value={v}
        list={kind === 'party' ? 'ma-entry-vendors' : undefined}
        inputMode={kind === 'money' ? 'decimal' : undefined}
        placeholder={(() => {
          const f = fields.find((x) => x.key === c.key)
          return f ? hintFor(f) : undefined
        })()}
        title={c.label}
        onFocus={() => setSel(r.key)}
        onChange={(e) => set(r.key, c.key, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && last && r.key === rows[rows.length - 1].key) {
            e.preventDefault()
            addRow()
          }
        }}
        aria-label={c.label}
      />
    )
  }

  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10, height: 30 }}>
        <span className="ma-title" style={{ marginRight: 10 }}>
          {def.title}
        </span>
        <IBtn lg title="Add Row" onClick={addRow}>
          <PlusIcon />
        </IBtn>
        <span className="ma-label" style={{ marginLeft: 6, color: '#c00', fontWeight: 'bold' }}>
          NEW ENTRY
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, whiteSpace: 'nowrap' }}>
        <Btn onClick={onClose}>
          Back <span style={{ fontSize: 10, color: '#777' }}>(F3)</span>
        </Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save <span style={{ fontSize: 10, color: '#777' }}>(F2)</span>
        </Btn>
        <span style={{ borderLeft: '1px solid #c3c3c3', height: 20 }} />
        <Btn onClick={addRow}>Add Row</Btn>
        <Btn onClick={removeRow}>Remove Row</Btn>
        <Btn
          onClick={() => {
            fileFor.current = sel
            fileInput.current?.click()
          }}
        >
          Upload Document
        </Btn>
        <span className="ma-label" style={{ marginLeft: 6 }}>
          Type each record into a row. Enter on the last cell adds a row.
        </span>
        <span style={{ marginLeft: 'auto', marginRight: 10 }}>
          <Rows n={rows.filter(touched).length} />
        </span>
      </div>

      <div style={{ marginTop: 4 }}>
        <div className="ma-grid" style={{ height: 352 }}>
          <table style={{ width: total, minWidth: total }}>
            <colgroup>
              <col style={{ width: 20 }} />
              {cols.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
              <col style={{ width: 34 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="chk" />
                {cols.map((c) => (
                  <th key={c.key} className={c.align === 'right' ? 'r' : undefined} title={c.label}>
                    {c.label}
                    {c.key === required && <span className="ma-req">*</span>}
                  </th>
                ))}
                <th title="Document">Doc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`is-data${sel === r.key ? ' is-selected' : ''}`} onClick={() => setSel(r.key)}>
                  <td className="chk">
                    <span className={`cbox${sel === r.key ? ' is-on' : ''}`} />
                  </td>
                  {cols.map((c, i) => (
                    <td key={c.key} style={{ padding: '0 2px' }}>
                      {cellInput(r, c, i === cols.length - 1)}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="ma-lookup"
                      title={r.file ? `Attached: ${r.file.name} (click to replace)` : 'Attach supplier invoice / receipt'}
                      onClick={() => {
                        fileFor.current = r.key
                        fileInput.current?.click()
                      }}
                      style={{ color: r.file ? '#2e7d32' : undefined, fontWeight: 'bold' }}
                    >
                      {r.file ? '✓' : '…'}
                    </button>
                  </td>
                </tr>
              ))}
              {Array.from({ length: filler }, (_, i) => (
                <tr key={`f${i}`} onClick={addRow} style={{ cursor: 'pointer' }}>
                  <td className="chk" />
                  {cols.map((c) => (
                    <td key={c.key} />
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {def.hscroll && <HScroll thumb={def.hscroll} />}
      </div>

      {'total' in pristine && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8, marginRight: 10 }}>
          <span className="ma-bold-label">TOTAL VALUE</span>
          <b>{sum.toFixed(2)}</b>
        </div>
      )}

      <datalist id="ma-entry-vendors">
        {suppliers.map((s) => (
          <option key={s.id} value={s.name.toUpperCase()} />
        ))}
      </datalist>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void pickFile(f)
          e.target.value = ''
        }}
      />
    </div>
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
          <IBtn lg title="Filter list" onClick={() => document.getElementById('ma-mod-q')?.focus()}>
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
