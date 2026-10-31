import { useLiveQuery } from 'dexie-react-hooks'
import { activeBranchId, db } from '../db/db'
import { chemCode } from '../db/seedData'
import type { Customer, DocRecord, Sale, User } from '../db/types'

// ── Legacy header constants ─────────────────────────────────────────────
export const APP_VERSION = '9.5.21'

/** Values the old system kept in "Default Values Management". Editable there
 * (Utilities → Default Values). Nothing here is shop data: when a value has
 * not been set, it comes from the open chemist (its name is the stock
 * location) or the company settings (Settings → shop name). */
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

/** Product name, shown on the sign-in screen before any shop data is loaded. */
export const BRAND_NAME = 'SUBGEO CHEMIST LTD'

/** Generic values used only when nothing else is known. */
export const DEFAULTS: MedDefaults = {
  companyName: '',
  branchCode: '',
  licenceFrom: '',
  licenceTo: '',
  location: '',
  locations: [],
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

/** Values that differ per chemist (stored with that chemist, not company-wide). */
export const CHEMIST_DEFAULT_KEYS = new Set<keyof MedDefaults>(['location', 'locations'])
const CHEMIST_DEFAULTS_KEY = 'medapp:chemist-defaults'

/** Save one default value where it belongs: company-wide, or for the open chemist. */
export async function saveMedDefault<K extends keyof MedDefaults>(key: K, value: MedDefaults[K]): Promise<void> {
  const store = CHEMIST_DEFAULT_KEYS.has(key) ? CHEMIST_DEFAULTS_KEY : 'medapp:defaults'
  await db.transaction('rw', db.kv, async () => {
    const cur = await getKv<Partial<MedDefaults>>(store, {})
    await setKv(store, { ...cur, [key]: value })
  })
}

async function loadDefaults(): Promise<MedDefaults> {
  const [company, chemist, settings, branch] = await Promise.all([
    getKv<Partial<MedDefaults>>('medapp:defaults', {}),
    getKv<Partial<MedDefaults>>(CHEMIST_DEFAULTS_KEY, {}),
    getKv<{ shopName?: string }>('settings', {}),
    db.branches.get(activeBranchId),
  ])
  // Old builds saved per-chemist values company-wide; per-chemist ones win.
  const { location: _l, locations: _ls, branchCode: _b, ...companyOnly } = company
  const stored = { ...companyOnly, ...chemist }
  const clean = Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && v.length === 0)))
  const location = (clean.location as string | undefined) ?? branch?.name?.toUpperCase() ?? ''
  const locations = (clean.locations as string[] | undefined) ?? (location ? [location] : [])
  return {
    ...DEFAULTS,
    companyName: (settings.shopName ?? '').toUpperCase() || BRAND_NAME,
    branchCode: chemCode(branch?.number),
    ...clean,
    location,
    locations: locations.includes(location) || !location ? locations : [location, ...locations],
  }
}

export function useMedDefaults(): MedDefaults {
  return useLiveQuery(loadDefaults, [activeBranchId], { ...DEFAULTS, companyName: BRAND_NAME })
}
export async function getMedDefaults(): Promise<MedDefaults> {
  return loadDefaults()
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

// ── Documents of the transaction screens (quotes, DNs, indents, LPOs, GRNs…) ─
// One synced record per document (db.docs), so two tills never overwrite each other.
export type { DocRecord }

export function useDocs(slug: string): DocRecord[] {
  return useLiveQuery(async () => (await db.docs.where('slug').equals(slug).toArray()).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id), [slug], [] as DocRecord[])
}
export async function getDocs(slug: string): Promise<DocRecord[]> {
  return db.docs.where('slug').equals(slug).toArray()
}
/** Create (no id) or update a document. Returns its id. */
export async function saveDoc(slug: string, values: Record<string, string>, id?: number, userId?: number): Promise<number> {
  const now = Date.now()
  if (id !== undefined) {
    const n = await db.docs.update(id, { values, docNo: values.docNo || undefined, updatedAt: now })
    if (!n) throw new Error('That record no longer exists (deleted on another till?)')
    return id
  }
  return (await db.docs.add({ slug, values, docNo: values.docNo || undefined, createdAt: now, updatedAt: now, createdBy: userId } as DocRecord)) as number
}
export async function deleteDocs(_slug: string, ids: number[]): Promise<void> {
  await db.docs.bulkDelete(ids)
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
export const DEFAULT_FAVOURITES: Favourite[] = []
export function useFavourites(): Favourite[] {
  return useKv<Favourite[]>('medapp:favourites', DEFAULT_FAVOURITES)
}
