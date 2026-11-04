import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { DocLine, Product, Sale, ServiceJob, Supplier } from '../../db/types'
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
import { OtcEntry, PartyEntry, WHOLESALE_RULES, WholesaleEntry } from './EntryScreens'
import { useInvoiceUpload } from './InvoiceImport'
import { ADJUST_MINUS, ADJUST_PLUS, GrnEntry, StockAdjustEntry } from './StockScreens'
import { MedicineEntry } from './MedicineScreen'
import PriceTable from './PriceTable'
import { hasAdminRights } from '../../db/syncSchema'
import { ProductLookup } from './ProductLookup'
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
/** medicine: the real stock list (products), with the Medicine form's extra details. */
type Source = 'otc' | 'otc-return' | 'service' | 'party' | 'services' | 'docs' | 'medicine'
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
  /** "+" opens a full-page stock screen (StockScreens.tsx) instead of the pop-up form; saving moves stock. */
  entry?: 'grn' | 'adjust' | 'medicine'
  /** Offer "Upload Supplier Invoice (PDF)" (reads the lines and receives them into stock). */
  importInvoice?: boolean
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
  minPrice: 'Best Price: lowest it may be sold for (KES)',
  reorder: 'Re-order when stock falls to, e.g. 10',
  maxStock: 'Most to hold (blank = no limit)',
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
      C('patient', 'Patient Name', 150),
      C('contact', 'Contact No', 110),
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
      C('returnNo', 'Return No.', 100),
      C('date', 'Date', 100),
      C('category', 'Patient Category', 200),
      C('patient', 'Patient Name', 150),
      C('contact', 'Contact No', 110),
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
      C('contact', 'Contact No', 110),
      C('location', 'Location', 190),
      C('category', 'Patient Category', 190),
      C('amount', 'Bill Amount', 75, 'right'),
      C('cash', 'CASH', 75, 'right'),
      C('mpesa', 'MPESA', 75, 'right'),
      C('paybill', 'PAYBILL', 75, 'right'),
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
    cols: [C('location', 'Location', 200), C('docNo', 'Quote.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('contact', 'Contact No', 110), C('total', 'Total', 75, 'right'), C('user', 'User', 225)],
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
      C('contact', 'Contact No', 110),
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
      C('contact', 'Contact No', 110),
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
    cols: [C('location', 'Location', 200), C('quoteNo', 'Quote.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('contact', 'Contact No', 110), C('total', 'Total', 75, 'right'), C('user', 'User', 100), C('_', '', 125)],
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
    cols: [C('location', 'Location', 200), C('docNo', 'CR Note.No', 100), C('date', 'Date', 75), C('customer', 'Customer Name', 190), C('contact', 'Contact No', 110), C('partyId', 'Party ID', 75), C('total', 'Total', 75, 'right'), C('user', 'User', 100), C('_', '', 50)],
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
      C('contact', 'Contact No', 110),
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
      C('contactPerson', 'Contact Person', 150),
      C('contactPhone', 'Contacts No', 110),
      C('kraPin', 'KRA PIN', 110),
      C('billType', 'Bill Type', 90),
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
      C('contact', 'Contact No', 110),
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
      C('contact', 'Contact No', 110),
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
      C('docNo', 'Mran No', 100),
      C('mrnDate', 'Mran Date', 100),
      C('invoice', 'Invoice/Receipt', 100),
      C('vendorName', 'Vendor Name', 190),
      C('total', 'TOTAL VALUE', 100, 'right'),
      C('expense', 'Expense A/c', 200),
      C('receivedBy', 'Received By', 100),
      C('status', 'Status', 200),
      C('phoneNo', 'Phone No', 120),
      C('address', 'Address', 200),
    ],
    entry: 'grn',
    importInvoice: true,
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
      { key: 'address', kind: 'text' },
    ],
  },
  [ADJUST_MINUS]: {
    title: 'Stock Adjust -',
    source: 'docs',
    prefix: 'SAM',
    hscroll: 0.5,
    tools: BASE_TOOLS,
    cols: [
      C('docNo', 'Doc No', 100),
      C('date', 'Date', 100),
      C('location', 'Location', 140),
      C('types', 'Type Of Adjustment', 200),
      C('items', 'Products', 80, 'right'),
      C('qty', 'Qty', 80, 'right'),
      C('total', 'Value (Cost)', 110, 'right'),
      C('user', 'User', 110),
      C('approval', 'Status', 160),
    ],
    entry: 'adjust',
  },
  [ADJUST_PLUS]: {
    title: 'Stock Adjust +(DBH)',
    source: 'docs',
    prefix: 'SAP',
    hscroll: 0.5,
    tools: BASE_TOOLS,
    cols: [
      C('docNo', 'Doc No', 100),
      C('date', 'Date', 100),
      C('location', 'Location', 140),
      C('types', 'Type Of Adjustment', 200),
      C('items', 'Products', 80, 'right'),
      C('qty', 'Qty', 80, 'right'),
      C('total', 'Value (Cost)', 110, 'right'),
      C('user', 'User', 110),
      C('approval', 'Status', 160),
    ],
    entry: 'adjust',
  },
  'medicine': {
    title: 'Medicine',
    source: 'medicine',
    entry: 'medicine',
    prefix: 'PRD00',
    hscroll: 0.75,
    tools: BASE_TOOLS,
    cols: [
      C('docNo', 'Product Code', 200),
      C('name', 'Product Name', 200),
      C('group', 'Product Group', 310),
      C('uom', 'UOM', 100),
      C('retail', 'Retail Sale', 130, 'right'),
      C('minPrice', 'Best Price', 110, 'right'),
      C('whole', 'Whole sale', 140, 'right'),
      C('cost', 'Cost Rate', 130, 'right'),
      C('packSize', 'Pack Size', 110, 'right'),
      C('type', 'Stock/Non-Stock', 80),
      C('stock', 'Qty In Stock', 90, 'right'),
      C('reorder', 'Re-order Level', 100, 'right'),
      C('maxStock', 'Max Level', 90, 'right'),
      C('molecular', 'Moleculor Name', 160),
      C('productType', 'Product Type', 110),
      C('supplier', 'Preffered Supplier', 200),
      C('markup', 'Markup%', 80, 'right'),
      C('vat', 'VAT ?', 60),
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
      { key: 'minPrice', kind: 'money' },
      { key: 'reorder', kind: 'text' },
      { key: 'maxStock', kind: 'text' },
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

type RawRow = { id: string; ts: number; cells: Record<string, string>; detail?: Sale | ServiceJob; docLines?: DocLine[]; productId?: number; docId?: number }

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
  // Bills raised from a Service Request belong to that register, not the OTC list.
  const serviceSaleIds = useLiveQuery(
    async () => (def.source === 'otc' ? new Set((await db.jobs.toArray()).map((j) => j.saleId).filter((x): x is number => x !== undefined)) : new Set<number>()),
    [def.source],
    new Set<number>(),
  )
  const jobSales = useLiveQuery(
    async () => {
      const ids = jobs.map((j) => j.saleId).filter((x): x is number => x !== undefined)
      return ids.length ? db.sales.bulkGet(ids) : []
    },
    [jobs],
    [] as (Sale | undefined)[],
  )
  // Suppliers: the Party Master list, and the contact numbers of vendors on documents.
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const services = useLiveQuery(
    () => (def.source === 'services' ? db.products.filter((p) => !p.trackStock).toArray() : Promise.resolve([] as Product[])),
    [def.source],
    [] as Product[],
  )
  // Medicine register: every medicine in stock (typed here, received on a GRN / uploaded invoice, or keyed in Inventory).
  const medicines = useLiveQuery(
    async () => {
      if (def.source !== 'medicine') return { products: [] as Product[], cats: new Map<number, string>(), docs: [] as { id: number; values: Record<string, string> }[] }
      const [products, cats, docs] = await Promise.all([db.products.filter((p) => !/^SRV-/i.test(p.sku)).toArray(), db.categories.toArray(), db.docs.where('slug').equals('medicine').toArray()])
      return { products, cats: new Map(cats.map((c) => [c.id!, c.name])), docs }
    },
    [def.source],
  )
  const uname = (id?: number) => (id !== undefined ? users.get(id)?.name.toUpperCase() ?? '' : '')
  /** Contact number of a party by name: contact person's phone, else its own phone. */
  const contactOf = (name?: string) => {
    const n = (name ?? '').trim().toUpperCase()
    if (!n) return ''
    const p = [...customers.values()].find((c) => c.name.toUpperCase() === n) ?? suppliers.find((x) => x.name.toUpperCase() === n)
    return p?.contactPhone || p?.phone || ''
  }
  const custPhone = (id?: number) => (id !== undefined ? customers.get(id)?.contactPhone || customers.get(id)?.phone || '' : '')

  return useMemo(() => {
    switch (def.source) {
      case 'otc':
        return sales
          .filter((s) => !s.refundOf && !s.serviceBill && !serviceSaleIds.has(s.id!))
          .map((s) => ({
            id: `s${s.id}`,
            ts: s.createdAt,
            detail: s,
            cells: {
              billNo: billNo(s, d.billPrefix),
              date: dmy(s.createdAt),
              category: s.customerId !== undefined ? (customers.get(s.customerId)?.name ?? d.patientCategory).toUpperCase() : d.patientCategory,
              patient: s.patientName ?? '',
              contact: s.patientPhone || custPhone(s.customerId),
              payable: payableBy(s, customers),
              narration: `${s.note ? `${s.note} ` : ''}-${uname(s.userId)}`,
              amount: amt(s.total),
              user: uname(s.userId),
              location: s.location || d.location,
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
                returnNo: `RTN-${seqOf(s.receiptNo)}-${yy(s.createdAt)}`,
                date: dmy(s.createdAt),
                category: s.customerId !== undefined ? (customers.get(s.customerId)?.name ?? d.patientCategory).toUpperCase() : d.patientCategory,
                patient: s.patientName ?? orig?.patientName ?? '',
                contact: s.patientPhone || orig?.patientPhone || custPhone(s.customerId),
                payable: payableBy(s, customers),
                narration: `${orig ? `RET ${billNo(orig, d.billPrefix)} ` : ''}${s.note ? `${s.note} ` : ''}-${uname(s.userId)}`,
                amount: amt(-s.total),
                user: uname(s.userId),
                location: s.location || d.location,
              },
            }
          })
      }
      case 'service': {
        const saleMap = new Map<number, Sale>()
        for (const s of jobSales) if (s) saleMap.set(s.id!, s)
        return jobs.map((j) => {
          const sale = j.saleId !== undefined ? saleMap.get(j.saleId) : undefined
          const total = sale?.total ?? j.labour + j.lines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0)
          const paid = (m: 'cash' | 'mpesa' | 'paybill' | 'card' | 'cheque' | 'account') => (sale ? amt(paidBy(sale, m)) : '0.00')
          return {
            id: `j${j.id}`,
            ts: j.createdAt,
            detail: j,
            cells: {
              billNo: `${d.servicePrefix}-${seqOf(j.jobNo)}-${yy(j.createdAt)}`,
              patient: (j.customerName || 'OTC CLIENT').toUpperCase(),
              contact: j.phone || sale?.patientPhone || custPhone(j.customerId),
              location: sale?.location || d.location,
              category: j.customerId !== undefined ? (customers.get(j.customerId)?.name ?? d.patientCategory).toUpperCase() : d.patientCategory,
              amount: amt(total),
              cash: paid('cash'),
              mpesa: paid('mpesa'),
              paybill: paid('paybill'),
              credit: paid('account'),
              cheque: paid('cheque'),
              card: paid('card'),
            },
          }
        })
      }
      case 'party': {
        const card = (p: Supplier, kind: 'SUPPLIERS' | 'CUSTOMER') => ({
          name: p.name.toUpperCase(),
          group: p.groupAccount || (kind === 'SUPPLIERS' ? 'SUNDRY CREDITORS' : 'SUNDRY DEBTORS'),
          type: kind,
          blacklisted: p.blacklisted || /blacklist/i.test(p.notes ?? '') ? 'YES' : 'NO',
          address: p.address || p.notes || '-',
          pobox: p.poBox || '-',
          phone: p.phone || '-',
          email: p.email || '-',
          contactPerson: p.contactPerson || '-',
          contactPhone: p.contactPhone || '-',
          kraPin: p.kraPin || '-',
          billType: p.billType || 'PAY LATER',
        })
        return [
          ...suppliers.map((s) => ({ id: `sup${s.id}`, ts: s.id ?? 0, cells: card(s, 'SUPPLIERS') })),
          ...[...customers.values()].map((c) => ({ id: `cus${c.id}`, ts: c.createdAt, cells: card(c, 'CUSTOMER') })),
        ].sort((a, b) => b.ts - a.ts)
      }
      case 'services':
        return services
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((p) => ({
            id: `p${p.id}`,
            ts: p.createdAt,
            cells: { name: p.name.toUpperCase(), charges: amt(p.price), outsource: p.brand === 'OUTSOURCED' ? 'YES' : 'NO' },
          }))
      case 'medicine': {
        if (!medicines) return []
        const byKey = new Map<string, { id: number; values: Record<string, string> }>()
        for (const doc of medicines.docs) {
          if (doc.values.name) byKey.set(`n:${doc.values.name.trim().toUpperCase()}`, doc)
          if (doc.values.docNo) byKey.set(`c:${doc.values.docNo.trim().toUpperCase()}`, doc)
        }
        return medicines.products.map((p) => {
          const doc = byKey.get(`c:${p.sku.trim().toUpperCase()}`) ?? byKey.get(`n:${p.name.trim().toUpperCase()}`)
          const v = doc?.values ?? {}
          return {
            id: `p${p.id}`,
            ts: p.updatedAt || p.createdAt,
            productId: p.id,
            docId: doc?.id,
            cells: {
              docNo: p.sku,
              name: p.name.toUpperCase(),
              group: (p.categoryId !== undefined ? medicines.cats.get(p.categoryId) : undefined)?.toUpperCase() || v.group || '',
              uom: v.uom || '',
              retail: amt(p.price),
              whole: v.whole || amt(p.price),
              cost: amt(p.cost),
              packSize: v.packSize || '1.00',
              type: p.trackStock ? 'S' : 'N',
              stock: String(p.stock),
              minPrice: p.minPrice ? amt(p.minPrice) : '',
              reorder: String(p.reorderLevel ?? 0),
              maxStock: p.maxStock !== undefined ? String(p.maxStock) : '',
              molecular: v.molecular || 'NONE',
              productType: v.productType || 'MEDICINE',
              supplier: (p.supplierId !== undefined ? suppliers.find((x) => x.id === p.supplierId)?.name : undefined)?.toUpperCase() || v.supplier || '',
              markup: v.markup || '0.00',
              vat: p.taxable ? 'YES' : 'NO',
            },
          }
        })
      }
      case 'docs':
        return docs.map((doc) => {
          const v = doc.values
          const contact = v.contact || v.phoneNo || contactOf(v.customer || v.vendorName || v.supplierName)
          return { id: `d${doc.id}`, ts: doc.createdAt, cells: { ...v, contact }, docLines: doc.lines }
        })
    }
  }, [def.source, sales, jobs, jobSales, suppliers, customers, services, docs, d, users, serviceSaleIds, medicines]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* ── Screen ────────────────────────────────────────────────────────────── */
export function ModuleListPage() {
  const { slug = '' } = useParams()
  const { user } = useSession()
  // Medicine Prices (Best Price): admin / purchase only.
  if (slug === 'medicine-prices') return hasAdminRights(user?.role) ? <PriceTable /> : <ModulesEmpty />
  const def = DEFS[slug]
  if (!def) return <ModulesEmpty />
  return <ModuleList key={slug} slug={slug} def={def} />
}

function ModuleList({ slug, def }: { slug: string; def: ModuleDef }) {
  const nav = useNavigate()
  const toast = useToast()
  const all = useRows(slug, def)
  const medicineProducts = useLiveQuery(() => (def.entry === 'medicine' ? db.products.filter((p) => !/^SRV-/i.test(p.sku)).toArray() : []), [def.entry], [] as Product[])
  const upload = useInvoiceUpload()
  const [quick, setQuick] = useState('')
  const [col, setCol] = useState('SELECT')
  const [op, setOp] = useState('WHERE')
  const [val, setVal] = useState('')
  const [applied, setApplied] = useState<{ col: string; op: string; val: string } | null>(null)
  const [approval, setApproval] = useState<string>(APPROVALS[0])
  const { user } = useSession()
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)
  // Eye with nothing selected: every record on one page, no filters.
  const [showAll, setShowAll] = useState(false)
  const [findMed, setFindMed] = useState(false)
  const [checked, setChecked] = useState<Set<string | number>>(new Set())
  const [selected, setSelected] = useState<string | number | undefined>()
  const [showFilter, setShowFilter] = useState(true)
  const [valuePick, setValuePick] = useState(false)
  const [view, setView] = useState<RawRow | null>(null)
  const [edit, setEdit] = useState<RawRow | 'new' | null>(null)
  const [action, setAction] = useState('SELECT')
  // Full-page entry screens (EntryScreens.tsx) that replace the list while open.
  const [screen, setScreen] = useState<{ kind: 'wholesale' | 'grn' | 'adjust' | 'medicine'; editId?: number } | { kind: 'otc'; mode: 'bill' | 'return' | 'service'; sale?: Sale } | { kind: 'party'; row?: RawRow } | null>(null)

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
  const size = showAll ? Math.max(filtered.length, 1) : PAGE
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const pg = Math.min(page, pages - 1)
  const pageRows = filtered.slice(pg * size, pg * size + size)
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
    if (def.source === 'otc') setScreen({ kind: 'otc', mode: 'bill' })
    else if (def.source === 'otc-return') setScreen({ kind: 'otc', mode: 'return' })
    else if (def.source === 'service') setScreen({ kind: 'otc', mode: 'service' })
    else if (def.source === 'party') setScreen({ kind: 'party' })
    else if (WHOLESALE_RULES[slug]) setScreen({ kind: 'wholesale' })
    else if (def.entry) setScreen({ kind: def.entry })
    else setEdit('new')
  }
  const editDoc = () => {
    const t = target()
    // Medicine: with nothing selected, search for the one to edit.
    if (!t && def.entry === 'medicine') return setFindMed(true)
    if (!t) return toast('Select a record first', 'error')
    if (def.entry === 'medicine') return setScreen({ kind: 'medicine', editId: t.productId })
    if (def.source === 'otc') setScreen({ kind: 'otc', mode: 'return', sale: t.detail as Sale })
    else if (def.source === 'otc-return') setView(t)
    else if (def.source === 'service') nav('/service')
    else if (WHOLESALE_RULES[slug]) setScreen({ kind: 'wholesale', editId: Number(String(t.id).slice(1)) })
    else if (def.entry === 'grn' || def.entry === 'adjust') setScreen({ kind: def.entry, editId: Number(String(t.id).slice(1)) })
    else if (def.source === 'party') setScreen({ kind: 'party', row: t })
    else setEdit(t)
  }
  const viewDoc = () => {
    const t = target()
    // Medicine: its details page shows every field (no separate view box).
    if (t && def.entry === 'medicine') return setScreen({ kind: 'medicine', editId: t.productId })
    if (t) return setView(t)
    // Nothing selected: show everything (all records, no filters, one page).
    setQuick('')
    setApplied(null)
    setVal('')
    setCol('SELECT')
    setOp('WHERE')
    setPage(0)
    setShowAll(true)
    toast(`Showing all ${all.length} record(s) — double-click one to open it`)
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
        setShowAll(false)
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
      case 'printAll': {
        if (slug === 'service-bill') {
          const missing = pageRows.filter((r) => !r.cells.cash || r.cells.cash === '0.00' || !r.cells.paybill || r.cells.paybill === '0.00')
          if (missing.length > 0) return toast('Print blocked: every row must have CASH and PAYBILL amounts entered', 'error')
        }
        return window.print()
      }
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

  if (screen?.kind === 'medicine') return <MedicineEntry productId={screen.editId} onClose={() => setScreen(null)} />
  if (screen?.kind === 'grn') return <GrnEntry editId={screen.editId} onClose={() => setScreen(null)} />
  if (screen?.kind === 'adjust') return <StockAdjustEntry slug={slug as typeof ADJUST_MINUS} editId={screen.editId} onClose={() => setScreen(null)} />
  if (screen?.kind === 'wholesale') return <WholesaleEntry slug={slug} def={def} editId={screen.editId} onClose={() => setScreen(null)} />
  if (screen?.kind === 'otc') return <OtcEntry mode={screen.mode} fromSale={screen.sale} onClose={() => setScreen(null)} />
  if (screen?.kind === 'party')
    return <PartyEntry party={screen.row ? { kind: String(screen.row.id).startsWith('sup') ? 'supplier' : 'customer', id: Number(String(screen.row.id).replace(/\D/g, '')) } : undefined} onClose={() => setScreen(null)} />

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
        {def.importInvoice && (
          <span style={{ marginLeft: 24 }}>
            <Btn onClick={upload.pick} disabled={upload.busy} title="Read a supplier invoice / proforma / sales order PDF and receive all its lines into stock">
              {upload.busy ? 'Reading PDF…' : 'Upload Supplier Invoice (PDF)'}
            </Btn>
            <Btn onClick={upload.pick} disabled={upload.busy} title="Upload a stock report XLS/XLSX exported from another chemist and receive its lines into stock">
              {upload.busy ? 'Reading CSV…' : 'Upload Stock Report (XLS/XLSX)'}
            </Btn>
          </span>
        )}
        {upload.element}
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
        <Input value={showAll ? `0-${filtered.length}` : `${pg * PAGE}-${pg * PAGE + PAGE}`} readOnly width={40} />
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
          onOpen={(id) => {
            const r = all.find((x) => x.id === id)
            if (!r) return
            // Double-click: the stock screens open straight on the edit page.
            if (def.entry === 'medicine') setScreen({ kind: 'medicine', editId: r.productId })
            else if (def.entry === 'grn' || def.entry === 'adjust') setScreen({ kind: def.entry, editId: Number(String(r.id).slice(1)) })
            else setView(r)
          }}
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
      {findMed && (
        <ProductLookup
          title="Search Medicine to edit"
          products={medicineProducts}
          onClose={() => setFindMed(false)}
          onPick={(p) => {
            setFindMed(false)
            setScreen({ kind: 'medicine', editId: p.id })
          }}
        />
      )}
      {edit && (def.source === 'docs' || def.source === 'medicine') && <DocDialog slug={slug} def={def} row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {edit && def.source === 'services' && <ServiceDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

/* ── View dialog ───────────────────────────────────────────────────────── */
function ViewDialog({ def, row, onClose }: { def: ModuleDef; row: RawRow; onClose: () => void }) {
  const lines = row.detail && 'lines' in row.detail
    ? row.detail.lines
    : (row.docLines ?? []).map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.rate, discount: Math.round(l.qty * l.rate) - l.total })) // shows Amount = the line total (incl. VAT when added on)
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

/* ── Whole-sale document entry ─────────────────────────────────────────── */
const PICKED_NEW = '(new party) '

function DocDialog({ slug, def, row, onClose }: { slug: string; def: ModuleDef; row?: RawRow; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const d = useMedDefaults()
  const parties = useLiveQuery(async () => [...(await db.customers.toArray()), ...(await db.suppliers.toArray())].map((p) => p.name.toUpperCase()), [], [] as string[])
  const fields = def.fields ?? []
  const register = useDocs(slug)
  // A Medicine row is a product; its Medicine-form record (uom, pack size…) may or may not exist yet.
  const productId = row?.productId
  const docId = productId !== undefined ? row?.docId : row ? Number(String(row.id).slice(1)) : undefined
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

  const save = async () => {
    if (required && !vals[required]?.trim()) return toast(`${label(required)} is required`, 'error')
    const values = { ...vals }
    if (!values.docNo?.trim() && fields.some((f) => f.kind === 'docno')) values.docNo = await nextDocNo(def.prefix ?? 'DOC')
    for (const f of fields) if (f.kind === 'money' && values[f.key]) values[f.key] = (parseFloat(values[f.key]) || 0).toFixed(2)
    if (file) {
      values.attachment = file.data
      values.attachmentName = file.name
    } else {
      delete values.attachment
      delete values.attachmentName
    }
    await saveDoc(slug, values, docId, user?.id)
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
          {docId !== undefined && productId === undefined && (
            <Btn
              onClick={async () => {
                await deleteDocs(slug, [docId])
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
