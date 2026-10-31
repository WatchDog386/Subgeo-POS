import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie'
import type {
  Branch,
  Category,
  Customer,
  DocRecord,
  LogEntry,
  ParkedSale,
  Product,
  PurchaseOrder,
  Sale,
  ServiceJob,
  Shift,
  StaffMessage,
  StaffTask,
  StockMovement,
  Supplier,
  User,
} from './types'
import { LEGACY_DOCS_PREFIX, LEGACY_TASKS_KEY, convertLegacyDocs, convertLegacyTasks } from './legacyDemo'
import { BRANCH_TABLES, COUNTER_FIELDS, GLOBAL_KV_KEYS, GLOBAL_TABLES, SYNCED_TABLES, isLocalKvKey, isMetaField, isSeqKvKey } from './syncSchema'

export interface KV {
  key: string
  value: unknown
}

/** A local delete waiting to be uploaded to the server. */
export interface Tombstone {
  seq?: number
  t: string
  id: string | number
  at: number
}

/* ── Sync bookkeeping ─────────────────────────────────────────────────────
 * Every chemist (branch) has its own IndexedDB database on the device, so all
 * screens automatically work on "this chemist's" medicines, sales and stock.
 * Records carry a few underscore fields used by src/db/sync.ts:
 *   _dirty  1 when the record has changes not yet uploaded
 *   _ts     time of the last local change (last-write-wins on the server)
 *   _d_<f>  for counter fields (stock, balance): the change not yet uploaded.
 *           The server adds it to its own value, so a sale at the till and a
 *           stock receipt by the admin never overwrite each other.
 */

export { BRANCH_TABLES, COUNTER_FIELDS, GLOBAL_KV_KEYS, GLOBAL_TABLES, SYNCED_TABLES, isLocalKvKey, isMetaField, isSeqKvKey }

/** Strip sync bookkeeping fields from a record. */
export function stripMeta<T extends object>(rec: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) if (!isMetaField(k)) out[k] = v
  return out as T
}

/** Mark a transaction as applying server data, so the hooks don't treat it as a local edit. */
export function markRemote(tx: Transaction) {
  ;(tx as unknown as { __remote?: boolean }).__remote = true
}
const isRemote = (tx: Transaction | undefined) => !!(tx as unknown as { __remote?: boolean } | undefined)?.__remote

// Globally unique numeric ids so records created on different tills never clash:
// milliseconds since 2023-11 × 4096 + 12 random bits (safe-integer range for ~69 years).
const ID_EPOCH = 1_700_000_000_000
let lastIdMs = 0
let lastIdSeq = 0
export function genId(): number {
  const ms = Date.now() - ID_EPOCH
  if (ms > lastIdMs) {
    lastIdMs = ms
    lastIdSeq = Math.floor(Math.random() * 4096)
  } else if (++lastIdSeq >= 4096) {
    // Same millisecond (or clock went back): keep counting upward, never repeat.
    lastIdMs++
    lastIdSeq = Math.floor(Math.random() * 4096)
  }
  return lastIdMs * 4096 + lastIdSeq
}

/** Listeners told whenever a local change needs uploading (the sync engine). */
const changeListeners = new Set<() => void>()
export function onLocalChange(fn: () => void): () => void {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}
const notifyChange = () => {
  for (const fn of changeListeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** Tables that existed at schema v3 (later versions add docs, tasks, messages). */
const V3_TABLES = new Set(['users', 'branches', 'categories', 'suppliers', 'products', 'customers', 'sales', 'parked', 'movements', 'purchaseOrders', 'shifts', 'jobs', 'logs', 'kv'])

export class PosDB extends Dexie {
  users!: EntityTable<User, 'id'>
  branches!: EntityTable<Branch, 'id'>
  categories!: EntityTable<Category, 'id'>
  suppliers!: EntityTable<Supplier, 'id'>
  products!: EntityTable<Product, 'id'>
  customers!: EntityTable<Customer, 'id'>
  sales!: EntityTable<Sale, 'id'>
  parked!: EntityTable<ParkedSale, 'id'>
  movements!: EntityTable<StockMovement, 'id'>
  purchaseOrders!: EntityTable<PurchaseOrder, 'id'>
  shifts!: EntityTable<Shift, 'id'>
  jobs!: EntityTable<ServiceJob, 'id'>
  logs!: EntityTable<LogEntry, 'id'>
  docs!: EntityTable<DocRecord, 'id'>
  tasks!: EntityTable<StaffTask, 'id'>
  messages!: EntityTable<StaffMessage, 'id'>
  kv!: EntityTable<KV, 'key'>
  outbox!: EntityTable<Tombstone, 'seq'>

  constructor(name = 'subgeo-pos') {
    super(name)
    this.version(1).stores({
      users: '++id, pin, role',
      categories: '++id, name',
      suppliers: '++id, name',
      products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
      customers: '++id, name, phone, plate, balance',
      sales: '++id, &receiptNo, createdAt, customerId, userId, shiftId, status',
      parked: '++id, createdAt',
      movements: '++id, productId, at, reason',
      purchaseOrders: '++id, &poNo, supplierId, status, createdAt',
      shifts: '++id, userId, openedAt, closedAt',
      jobs: '++id, &jobNo, customerId, status, createdAt',
      kv: 'key',
    })
    this.version(2).stores({
      logs: '++id, at, kind, userId',
    })
    // v3: multi-chemist + server sync. Unique indexes become plain indexes:
    // every chemist has its own copy of a SKU, and two tills of one chemist may
    // briefly hand out the same document number while offline — a unique index
    // would make the download fail instead of just showing both.
    this.version(3)
      .stores({
        users: '++id, username, role, branchId, _dirty',
        branches: '++id, number, _dirty',
        categories: '++id, name, _dirty',
        suppliers: '++id, name, _dirty',
        products: '++id, sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active, _dirty',
        customers: '++id, name, phone, plate, balance, _dirty',
        sales: '++id, receiptNo, createdAt, customerId, userId, shiftId, status, _dirty',
        parked: '++id, createdAt, _dirty',
        movements: '++id, productId, at, reason, _dirty',
        purchaseOrders: '++id, poNo, supplierId, status, createdAt, _dirty',
        shifts: '++id, userId, openedAt, closedAt, _dirty',
        jobs: '++id, jobNo, customerId, status, createdAt, _dirty',
        logs: '++id, at, kind, userId, _dirty',
        kv: 'key, _dirty',
        outbox: '++seq',
      })
      .upgrade(async (tx) => {
        markRemote(tx)
        // Pre-sync accounts were PIN-only; the seeded accounts replace them
        // (admin keeps id 1 and the CHEM1 cashier id 2, so old sales still resolve).
        await tx.table('users').clear()
        // Everything already on this till is queued for upload to the server.
        const now = Date.now()
        for (const name of SYNCED_TABLES) {
          // Tables added by later versions don't exist yet at this step.
          if (name === 'users' || name === 'branches' || !V3_TABLES.has(name)) continue
          await tx
            .table(name)
            .toCollection()
            .modify((r: Record<string, unknown>) => {
              if (name === 'kv' && isLocalKvKey(String(r.key))) return
              r._dirty = 1
              r._ts = now
              for (const f of COUNTER_FIELDS[name] ?? []) r[`_d_${f}`] = 0
            })
        }
      })

    // v4: documents, tasks and staff messages get their own tables (one record
    // each) instead of one kv list per screen, which two tills saving at the
    // same time used to overwrite. The old lists are converted with stable ids
    // (the server converts its copy the same way, so nothing doubles up).
    this.version(4)
      .stores({
        docs: '++id, slug, docNo, createdAt, _dirty',
        tasks: '++id, status, assigneeId, createdAt, _dirty',
        messages: '++id, at, toId, fromId, _dirty',
      })
      .upgrade(async (tx) => {
        markRemote(tx)
        const kv = tx.table('kv')
        const rows = (await kv.toArray()) as (KV & { _dirty?: number; _ts?: number })[]
        for (const r of rows) {
          const meta = { _dirty: r._dirty ?? 0, _ts: r._ts ?? 0 }
          if (r.key.startsWith(LEGACY_DOCS_PREFIX)) {
            for (const d of convertLegacyDocs(r.key, r.value)) await tx.table('docs').put({ ...d, ...meta })
            await kv.delete(r.key)
          } else if (r.key === LEGACY_TASKS_KEY) {
            for (const t of convertLegacyTasks(r.value)) await tx.table('tasks').put({ ...t, ...meta })
            await kv.delete(r.key)
          }
        }
      })

    for (const name of SYNCED_TABLES) this.installHooks(name)
  }

  private installHooks(name: string) {
    const table = this.table(name) as Table<Record<string, unknown>, unknown>
    const counters = COUNTER_FIELDS[name] ?? []
    const autoId = name !== 'kv'
    const self = this

    table.hook('creating', function (primKey, obj, trans) {
      if (isRemote(trans)) return undefined
      if (name === 'kv' && isLocalKvKey(String(obj.key))) return undefined
      obj._dirty = 1
      obj._ts = Date.now()
      for (const f of counters) obj[`_d_${f}`] = 0
      this.onsuccess = notifyChange
      if (autoId && (primKey === undefined || primKey === null)) {
        const id = genId()
        obj.id = id
        return id
      }
      return undefined
    })

    table.hook('updating', function (mods, primKey, record, trans) {
      if (isRemote(trans)) return undefined
      const obj = record as Record<string, unknown>
      if (name === 'kv' && isLocalKvKey(String(primKey))) return undefined
      const changed = Object.keys(mods).filter((k) => !isMetaField(k))
      if (changed.length === 0) return undefined
      const extra: Record<string, unknown> = { _dirty: 1, _ts: Date.now() }
      for (const f of counters) {
        const pending = Number(obj[`_d_${f}`] ?? 0)
        if (f in mods) {
          const delta = Number((mods as Record<string, unknown>)[f] ?? 0) - Number(obj[f] ?? 0)
          extra[`_d_${f}`] = pending + (Number.isFinite(delta) ? delta : 0)
        } else {
          extra[`_d_${f}`] = pending
        }
      }
      this.onsuccess = notifyChange
      return extra
    })

    table.hook('deleting', function (primKey, _obj, trans) {
      if (isRemote(trans)) return
      if (name === 'kv' && isLocalKvKey(String(primKey))) return
      const id = primKey as string | number
      // Queue the tombstone only once the delete has really committed.
      trans.on('complete', () => {
        void Dexie.ignoreTransaction(() => self.outbox.add({ t: name, id, at: Date.now() })).then(notifyChange, () => {})
      })
    })
  }
}

/* ── One database per chemist ───────────────────────────────────────────── */

/** CHEM1 keeps the original database name, so data already on a till becomes Chemist 1's. */
export function dbNameFor(branchId: number): string {
  return branchId === 1 ? 'subgeo-pos' : `subgeo-pos-b${branchId}`
}

function storedBranch(): number {
  try {
    const n = Number(globalThis.localStorage?.getItem('activeBranchId'))
    return Number.isInteger(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}

/** Chemist whose database is open. */
export let activeBranchId = storedBranch()
/** The open database. A live binding: switchBranchDb() replaces it. */
export let db = new PosDB(dbNameFor(activeBranchId))

/**
 * Open another chemist's database. Company-wide records (staff, chemists,
 * categories, suppliers, settings) are copied across so the screens work at
 * once; the chemist's own data arrives with the next sync.
 */
export async function switchBranchDb(branchId: number): Promise<void> {
  if (branchId === activeBranchId) return
  const prev = db
  const next = new PosDB(dbNameFor(branchId))
  await next.open()
  for (const name of GLOBAL_TABLES) {
    const rows = (await prev.table(name).toArray()) as Record<string, unknown>[]
    await next.transaction('rw', next.table(name), async (tx) => {
      markRemote(tx)
      for (const r of rows) {
        const mine = (await next.table(name).get(r.id as number)) as Record<string, unknown> | undefined
        if (!mine || Number(mine._ts ?? 0) < Number(r._ts ?? 0)) await next.table(name).put(r)
      }
    })
  }
  const kvRows = await prev.kv.filter((r) => GLOBAL_KV_KEYS.has(r.key)).toArray()
  await next.transaction('rw', next.kv, async (tx) => {
    markRemote(tx)
    for (const r of kvRows) {
      const mine = (await next.kv.get(r.key)) as (KV & { _ts?: number }) | undefined
      if (!mine || Number(mine._ts ?? 0) < Number((r as KV & { _ts?: number })._ts ?? 0)) await next.kv.put(r)
    }
  })
  db = next
  activeBranchId = branchId
  try {
    localStorage.setItem('activeBranchId', String(branchId))
  } catch {
    /* ignore */
  }
  prev.close()
}

/** Remove every row of a table, one by one so the deletes are uploaded too. */
export async function clearSynced(table: Table): Promise<void> {
  const keys = await table.toCollection().primaryKeys()
  await table.bulkDelete(keys)
}
