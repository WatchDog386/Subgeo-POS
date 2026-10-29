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
