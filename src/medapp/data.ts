import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Customer, Sale, User } from '../db/types'

// ── Legacy header constants ─────────────────────────────────────────────
export const APP_VERSION = '9.5.21'

/** Values the old system kept in "Default Values Management". Editable there. */
export interface MedDefaults {
  companyName: string
  branchCode: string
  licenceFrom: string
  licenceTo: string
  location: string
  locations: string[]
  patientCategory: string
  billPrefix: string
  servicePrefix: string
}

export const DEFAULTS: MedDefaults = {
  companyName: 'SUBGEO CHEMIST LTD',
  branchCode: 'CHEM3',
  licenceFrom: '01-12-2023',
  licenceTo: '30-11-2030',
  location: 'SCL UMOJA 3',
  locations: ['SCL UMOJA 3', 'NURSING STATION', 'LAB STATION'],
  patientCategory: 'OTC CLIENTS',
  billPrefix: 'CHPL-OTC',
  servicePrefix: 'SER-BILL',
}

// ── Small key/value store on top of the existing Dexie kv table ─────────
export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key)
  return (row?.value as T) ?? fallback
}
export async function setKv<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value })
}
export function useKv<T>(key: string, fallback: T): T {
  return useLiveQuery(() => getKv(key, fallback), [key], fallback)
}

export function useMedDefaults(): MedDefaults {
  const stored = useKv<Partial<MedDefaults>>('medapp:defaults', {})
  return { ...DEFAULTS, ...stored }
}
export async function getMedDefaults(): Promise<MedDefaults> {
  return { ...DEFAULTS, ...(await getKv<Partial<MedDefaults>>('medapp:defaults', {})) }
}

// ── Dates (the old app shows dd-mm-yyyy in grids, dd/mm/yyyy in pickers) ─
const pad = (n: number) => String(n).padStart(2, '0')
export function dmy(ts: number | Date | undefined, sep = '-'): string {
  if (ts === undefined) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  return `${pad(d.getDate())}${sep}${pad(d.getMonth() + 1)}${sep}${d.getFullYear()}`
}
/** Parse dd/mm/yyyy or dd-mm-yyyy. Returns start-of-day ms, or undefined. */
export function parseDmy(s: string): number | undefined {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s.trim())
  if (!m) return undefined
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return Number.isNaN(d.getTime()) ? undefined : d.getTime()
}
export const todayDmy = () => dmy(Date.now(), '/')
export const monthStartDmy = () => {
  const d = new Date()
  return dmy(new Date(d.getFullYear(), d.getMonth(), 1), '/')
}
/** Inclusive date range filter; empty strings mean open-ended. */
export function inRange(ts: number, from: string, to: string): boolean {
  const f = parseDmy(from)
  const t = parseDmy(to)
  if (f !== undefined && ts < f) return false
  if (t !== undefined && ts >= t + 86_400_000) return false
  return true
}

// ── Number formatting ───────────────────────────────────────────────────
/** Cents → "1000.00" (no thousands separator, like the legacy grid). */
export const amt = (cents: number) => (cents / 100).toFixed(2)

// ── Lookups used by many screens ────────────────────────────────────────
export function useUserMap(): Map<number, User> {
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  return new Map(users.map((u) => [u.id!, u]))
}
export function useCustomerMap(): Map<number, Customer> {
  const cs = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  return new Map(cs.map((c) => [c.id!, c]))
}

export function seqOf(docNo: string): number {
  const m = /(\d+)\D*$/.exec(docNo)
  return m ? Number(m[1]) : 0
}
export function yy(ts: number): string {
  return String(new Date(ts).getFullYear()).slice(-2)
}
export function billNo(sale: Sale, prefix = DEFAULTS.billPrefix): string {
  return `${prefix}-${seqOf(sale.receiptNo)}-${yy(sale.createdAt)}`
}

const ACCOUNTS: Record<string, string> = {
  cash: 'CASH COLLECTION ACCOUNT',
  mpesa: 'MPESA COLLECTION ACCOUNT',
  card: 'CREDIT CARD COLLECTION ACCOUNT',
}
export function payableBy(sale: Sale, customers: Map<number, Customer>): string {
  const method = sale.payments[0]?.method ?? 'cash'
  if (method === 'account') {
    const c = sale.customerId !== undefined ? customers.get(sale.customerId) : undefined
    return (c?.name ?? 'CREDIT ACCOUNT').toUpperCase()
  }
  return ACCOUNTS[method] ?? 'CASH COLLECTION ACCOUNT'
}
export function paidBy(sale: Sale | undefined, method: 'cash' | 'mpesa' | 'card' | 'account'): number {
  if (!sale) return 0
  return sale.payments.filter((p) => p.method === method).reduce((s, p) => s + p.amount, 0) - (method === 'cash' ? sale.change : 0)
}

// ── Generic documents for whole-sale transactions (quotes, DNs, …) ───────
export type DocRecord = { id: number; createdAt: number; values: Record<string, string> }

export function docsKey(slug: string) {
  return `medapp:docs:${slug}`
}
export function useDocs(slug: string): DocRecord[] {
  return useKv<DocRecord[]>(docsKey(slug), [])
}
export async function saveDoc(slug: string, values: Record<string, string>, id?: number): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const list = await getKv<DocRecord[]>(docsKey(slug), [])
    if (id !== undefined) {
      await setKv(
        docsKey(slug),
        list.map((d) => (d.id === id ? { ...d, values } : d)),
      )
    } else {
      const nextId = list.reduce((m, d) => Math.max(m, d.id), 0) + 1
      await setKv(docsKey(slug), [{ id: nextId, createdAt: Date.now(), values }, ...list])
    }
  })
}
export async function deleteDocs(slug: string, ids: number[]): Promise<void> {
  const list = await getKv<DocRecord[]>(docsKey(slug), [])
  await setKv(
    docsKey(slug),
    list.filter((d) => !ids.includes(d.id)),
  )
}
/** Per-transaction running number: "<prefix>-<n>-<yy>". */
export async function nextDocNo(prefix: string): Promise<string> {
  return db.transaction('rw', db.kv, async () => {
    const key = `medapp:seq:${prefix}`
    const n = (await getKv<number>(key, 0)) + 1
    await setKv(key, n)
    return `${prefix}-${n}-${yy(Date.now())}`
  })
}

// ── Favourites (Set Favorites screen) ───────────────────────────────────
export interface Favourite {
  label: string
  home: boolean
  sidebar: boolean
}
export const DEFAULT_FAVOURITES: Favourite[] = [
  { label: 'Medicine Returns', home: true, sidebar: true },
  { label: 'Movie Return...', home: true, sidebar: true },
  { label: 'Stock Entry (Opening)', home: true, sidebar: true },
  { label: 'Stock Adjust -', home: true, sidebar: true },
]
export function useFavourites(): Favourite[] {
  return useKv<Favourite[]>('medapp:favourites', DEFAULT_FAVOURITES)
}

// ── Admin register seeds (legacy admin screenshots 14.40.06 (2)-(9)) ────
const D = (values: Record<string, string>, n: number, day: string, month: string, year: string): DocRecord => ({
  id: n,
  createdAt: new Date(Number(year), Number(month) - 1, Number(day), 9, 0).getTime(),
  values,
})
const KENTONS = { vendorName: 'KENTONS LIMITED', address: 'P.O BOX KISUMU' }
export const MED_DOC_SEEDS: Record<string, DocRecord[]> = {
  'supplier-payment': [
    D({ docNo: 'REM-1-24', voucherDate: '15-01-2024', supplierName: 'ADWEL PHARMACY', fromAccount: 'null', refNo: '-', ref: 'PAYMENT FOR OCT TO DEC INVOICES' }, 1, '15', '1', '2024'),
  ],
  'purchase-indent': [
    D({ location: 'SCL UMOJA 3', docNo: 'PI-1-24', indentDate: '15-01-2024', indentor: 'ADMIN', status: 'INDENT APPROVED', purpose: 'reorder', approx: '2000.00' }, 1, '15', '1', '2024'),
    D({ location: 'SCL UMOJA 3', docNo: 'PI-1-21', indentDate: '17-03-2021', indentor: 'PHARM', status: 'INDENT APPROVED', purpose: 'STOCK', approx: '0.00' }, 2, '17', '3', '2021'),
    D({ location: 'SCL UMOJA 3', docNo: 'PI-1-20', indentDate: '24-07-2020', indentor: 'PURCHASE', status: 'INDENT APPROVED', purpose: 'REORDER', approx: '0.00' }, 3, '24', '7', '2020'),
  ],
  'local-purchase-order': [
    D({ location: 'SCL UMOJA 3', poDate: '02-02-2024', indentDate: '', docNo: 'PO-11-24', ...KENTONS }, 1, '2', '2', '2024'),
    D({ location: 'SCL UMOJA 3', poDate: '01-02-2024', indentDate: '', docNo: 'PO-10-24', ...KENTONS }, 2, '1', '2', '2024'),
    D({ location: 'SCL UMOJA 3', poDate: '26-01-2024', indentDate: '', docNo: 'PO-9-24', ...KENTONS }, 3, '26', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: '006', poDate: '22-01-2024', indentDate: '', docNo: 'PO-8-24', ...KENTONS }, 4, '22', '1', '2024'),
    D({ location: 'SCL UMOJA 3', poDate: '22-01-2024', indentDate: '', docNo: 'PO-7-24', vendorName: '', address: '' }, 5, '22', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: '005', poDate: '17-01-2024', indentDate: '17/1/2024', docNo: 'PO-6-24', ...KENTONS }, 6, '17', '1', '2024'),
    D({ location: 'SCL UMOJA 3', poDate: '17-01-2024', indentDate: '', docNo: 'PO-5-24', vendorName: '', address: '' }, 7, '17', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: '004', poDate: '17-01-2024', indentDate: '', docNo: 'PO-4-24', ...KENTONS }, 8, '17', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: 'PI-1-24', poDate: '15-01-2024', indentDate: '15-01-2024', docNo: 'PO-3-24', vendorName: 'ADWEL PHARMACY', address: '' }, 9, '15', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: '003', poDate: '13-01-2024', indentDate: '', docNo: 'PO-2-23', ...KENTONS }, 10, '13', '1', '2024'),
    D({ location: 'SCL UMOJA 3', indentNo: '1', poDate: '28-12-2023', indentDate: '', docNo: 'PO-1-23', ...KENTONS }, 11, '28', '12', '2023'),
  ],
  'pur-inv-grn': [
    D({ location: 'SCL UMOJA 3', supInvDate: '15-01-2024', docNo: 'GRN-1-24', lpoNo: 'PO-3-24', lpoDate: '15-01-2024', vendorName: 'ADWEL PHARMACY', phoneNo: '', faxNo: '' }, 1, '15', '1', '2024'),
  ],
  'pur-grn-direct-invoice': [
    D({ docNo: 'MRN-300-26', mrnDate: '20-10-2026', invoice: '174357', vendorName: 'TABACAN LTD', total: '166.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 1, '20', '10', '2026'),
    D({ docNo: 'MRN-299-26', mrnDate: '19-10-2026', invoice: '21436547', vendorName: 'TABACAN LTD', total: '626.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 2, '19', '10', '2026'),
    D({ docNo: 'MRN-298-26', mrnDate: '17-10-2026', invoice: '21111456', vendorName: 'TABACAN LTD', total: '400.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 3, '17', '10', '2026'),
    D({ docNo: 'MRN-297-26', mrnDate: '17-10-2026', invoice: '1212153', vendorName: 'TABACAN LTD', total: '645.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 4, '17', '10', '2026'),
    D({ docNo: 'MRN-296-26', mrnDate: '17-10-2026', invoice: '21435352', vendorName: 'VICTORIA HEALTHCARE LIMITED', total: '1746.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 5, '17', '10', '2026'),
    D({ docNo: 'MRN-295-26', mrnDate: '17-10-2026', invoice: '1325546', vendorName: 'TABACAN LTD', total: '532.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 6, '17', '10', '2026'),
    D({ docNo: 'MRN-294-26', mrnDate: '16-10-2026', invoice: '112345', vendorName: 'TABACAN LTD', total: '500.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 7, '16', '10', '2026'),
    D({ docNo: 'MRN-293-26', mrnDate: '15-10-2026', invoice: '12143643', vendorName: 'TABACAN LTD', total: '1000.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 8, '15', '10', '2026'),
    D({ docNo: 'MRN-292-26', mrnDate: '13-10-2026', invoice: '21124523', vendorName: 'TABACAN LTD', total: '325.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 9, '13', '10', '2026'),
    D({ docNo: 'MRN-291-26', mrnDate: '08-10-2026', invoice: '530087', vendorName: 'VICTORIA HEALTHCARE LIMITED', total: '2958.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 10, '8', '10', '2026'),
    D({ docNo: 'MRN-290-26', mrnDate: '07-10-2026', invoice: '12334546', vendorName: 'TABACAN LTD', total: '1500.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' }, 12, '7', '10', '2026'),
  ],
  medicine: [
    D({ docNo: 'PRD00-34-26', name: 'COFANART SYP 60ML', group: 'SYRUPS', uom: 'ML', retail: '300.00', whole: '300.00', cost: '120.00', packSize: '1.00', type: 'S' }, 1, '20', '10', '2026'),
    D({ docNo: 'PRD00-33-26', name: 'MICROMOL SYP 100ML', group: 'SYRUPS', uom: 'ML', retail: '150.00', whole: '150.00', cost: '25.00', packSize: '1.00', type: 'S' }, 2, '19', '10', '2026'),
    D({ docNo: 'PRD00-32-26', name: 'SCALPEL', group: 'SURGICALS', uom: '20MG', retail: '20.00', whole: '20.00', cost: '15.00', packSize: '100.00', type: 'S' }, 3, '17', '10', '2026'),
    D({ docNo: 'PRD00-31-25', name: 'OJEN OZ', group: 'TABS/CAPSULES', uom: 'MG', retail: '650.00', whole: '650.00', cost: '340.00', packSize: '1.00', type: 'S' }, 4, '17', '10', '2026'),
    D({ docNo: 'PRD00-30-25', name: 'TRIDAHIST 100 MLS', group: 'SYRUPS', uom: 'ML', retail: '150.00', whole: '150.00', cost: '45.00', packSize: '1.00', type: 'S' }, 5, '17', '10', '2026'),
    D({ docNo: 'PRD00-29-25', name: 'UNIVIR CREAM 10MG', group: 'CREAMS', uom: 'MG', retail: '300.00', whole: '300.00', cost: '0.00', packSize: '1.00', type: 'S' }, 6, '17', '10', '2026'),
    D({ docNo: 'PRD00-28-25', name: 'HERBIGOR SYRP 100MLS', group: 'SYRUPS', uom: 'MLS', retail: '450.00', whole: '450.00', cost: '0.00', packSize: '1.00', type: 'S' }, 7, '17', '10', '2026'),
    D({ docNo: 'PRD00-27-25', name: 'TRIPACOF EXP 60ML', group: 'SYRUPS', uom: 'MLS', retail: '100.00', whole: '100.00', cost: '0.00', packSize: '1.00', type: 'S' }, 8, '17', '10', '2026'),
    D({ docNo: 'PRD00-26-25', name: 'PIRITON SYRP GEN 100MLS', group: 'SYRUPS', uom: 'MLS', retail: '150.00', whole: '150.00', cost: '0.00', packSize: '1.00', type: 'S' }, 9, '17', '10', '2026'),
    D({ docNo: 'PRD00-25-25', name: 'ABZ ALTOA SUSP 10ML', group: 'SYRUPS', uom: 'MLS', retail: '70.00', whole: '70.00', cost: '0.00', packSize: '1.00', type: 'S' }, 10, '17', '10', '2026'),
    D({ docNo: 'PRD00-24-25', name: 'ABZ NILWORM TABS', group: 'TABS/CAPSULES', uom: 'MG', retail: '50.00', whole: '50.00', cost: '0.00', packSize: '100.00', type: 'S' }, 11, '17', '10', '2026'),
  ],
}
export async function seedAdminDocs(): Promise<void> {
  for (const [slug, list] of Object.entries(MED_DOC_SEEDS)) {
    if ((await getKv(docsKey(slug), [])).length === 0) await setKv(docsKey(slug), list)
  }
}
