// Company database API: sign-in, till sync and the admin's all-chemists views.
// Storage is the sync_records table (migrations/003_sync.sql): one JSON row per
// till record, scoped to a chemist (branch) or company-wide (scope 0).
import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { sql } from './db'
import { hashPassword } from '../src/lib/sha256'
import { SEED_BRANCH, SEED_PURCHASE, SEED_USERS, chemCode } from '../src/db/seedData'
import { COUNTER_FIELDS, GLOBAL_KV_KEYS, GLOBAL_TABLES, SYNCED_TABLES, isLocalKvKey, isSeqKvKey } from '../src/db/syncSchema'
import type { Branch, Product, Role, StaffMessage, User } from '../src/db/types'
import { LEGACY_DOCS_PREFIX, LEGACY_TASKS_KEY, convertLegacyDocs, convertLegacyTasks } from '../src/db/legacyDemo'
import { ensureRelational, project } from './relational'

type Rec = Record<string, unknown>
type Row = { tbl: string; scope: number; id: string; data: string | null; deleted: number; ts: number; seq: number }
type AuthedUser = User & { id: number }
type AuthedRequest = Request & { user: AuthedUser; token: string }

const GLOBAL = new Set<string>(GLOBAL_TABLES)
const ROLES: Role[] = ['owner', 'manager', 'cashier', 'purchase']
const PULL_LIMIT = 1000

/* ── Record store ────────────────────────────────────────────────────────── */
// Prepared on first use: the tables only exist once migrate() has run at boot.
const prepareAll = () => ({
  get: sql.prepare('SELECT * FROM sync_records WHERE tbl = ? AND scope = ? AND id = ?'),
  upsert: sql.prepare(
    `INSERT INTO sync_records (tbl, scope, id, data, deleted, ts, seq, updated_by, updated_at)
     VALUES (@tbl, @scope, @id, @data, @deleted, @ts, @seq, @updated_by, @updated_at)
     ON CONFLICT(tbl, scope, id) DO UPDATE SET
       data = excluded.data, deleted = excluded.deleted, ts = excluded.ts, seq = excluded.seq,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ),
  nextSeq: sql.prepare("UPDATE sync_meta SET v = v + 1 WHERE k = 'seq' RETURNING v"),
  maxSeq: sql.prepare("SELECT v FROM sync_meta WHERE k = 'seq'"),
  list: sql.prepare('SELECT * FROM sync_records WHERE tbl = ? AND scope = ? AND deleted = 0'),
  pull: sql.prepare(`SELECT * FROM sync_records WHERE seq > ? AND scope IN (0, ?) ORDER BY seq LIMIT ${PULL_LIMIT}`),
})
let prepared: ReturnType<typeof prepareAll> | undefined
const stmt = new Proxy({} as ReturnType<typeof prepareAll>, {
  get: (_t, k: keyof ReturnType<typeof prepareAll>) => (prepared ??= prepareAll())[k],
})

const getRow = (tbl: string, scope: number, id: string | number) => stmt.get.get(tbl, scope, String(id)) as Row | undefined
const parse = (row: Row | undefined): Rec | undefined => (row && !row.deleted && row.data ? (JSON.parse(row.data) as Rec) : undefined)

function writeRow(tbl: string, scope: number, id: string | number, data: Rec | null, ts: number, userId: number | null) {
  const seq = (stmt.nextSeq.get() as { v: number }).v
  stmt.upsert.run({
    tbl,
    scope,
    id: String(id),
    data: data ? JSON.stringify(data) : null,
    deleted: data ? 0 : 1,
    ts,
    seq,
    updated_by: userId,
    updated_at: Date.now(),
  })
  // Keep the relational tables (migrations/004) in step.
  project(tbl, scope, String(id), data)
}

const isLegacyKvKey = (key: string) => key.startsWith(LEGACY_DOCS_PREFIX) || key === LEGACY_TASKS_KEY

/**
 * Old builds kept documents and tasks as one kv list per screen. Turn every
 * such list into one docs/tasks record per entry (stable ids: the tills
 * convert their own copies the same way) and delete the list. Runs on boot and
 * after a push from a till still on an old build, so nothing typed there is lost.
 */
function convertLegacyKv(scope?: number): number {
  const where = scope === undefined ? '' : ' AND scope = ?'
  const rows = sql
    .prepare(`SELECT * FROM sync_records WHERE tbl = 'kv' AND deleted = 0 AND (id LIKE ? OR id = ?)${where}`)
    .all(`${LEGACY_DOCS_PREFIX}%`, LEGACY_TASKS_KEY, ...(scope === undefined ? [] : [scope])) as (Row & { updated_by: number | null })[]
  let n = 0
  for (const row of rows) {
    const value = (JSON.parse(row.data ?? '{}') as Rec).value
    const recs: [string, Rec][] =
      row.id === LEGACY_TASKS_KEY
        ? convertLegacyTasks(value).map((t) => ['tasks', t])
        : convertLegacyDocs(row.id, value).map((d) => ['docs', d as unknown as Rec])
    for (const [t, rec] of recs) {
      const cur = getRow(t, row.scope, rec.id as number)
      if (cur && cur.ts > row.ts) continue // changed (or deleted) on a new till since
      if (cur && !cur.deleted && cur.data === JSON.stringify(rec)) continue
      writeRow(t, row.scope, rec.id as number, rec, row.ts, row.updated_by)
      n++
    }
    writeRow('kv', row.scope, row.id, null, row.ts, row.updated_by)
  }
  return n
}

function listTable<T = Rec>(tbl: string, scope: number): T[] {
  return (stmt.list.all(tbl, scope) as Row[]).map((r) => JSON.parse(r.data!) as T)
}

const users = () => listTable<AuthedUser>('users', 0)
const branches = () => listTable<Branch & { id: number }>('branches', 0).sort((a, b) => a.number - b.number)

function scopeOf(tbl: string, id: string | number, branchId: number): number {
  if (GLOBAL.has(tbl)) return 0
  if (tbl === 'kv' && GLOBAL_KV_KEYS.has(String(id))) return 0
  return branchId
}

function toPulled(row: Row) {
  return {
    t: row.tbl,
    id: row.tbl === 'kv' ? row.id : Number(row.id),
    data: row.deleted || !row.data ? null : (JSON.parse(row.data) as Rec),
    deleted: !!row.deleted,
    ts: row.ts,
  }
}

/** Create the starter admin, CHEM1 cashier and Chemist 1 on a new server.
 * On companies that started before the purchases dashboard, add the passwordless
 * purchase account (server-assigned id and the first open chemist, so no till
 * id can clash). */
export function ensureSeeds(): void {
  sql.transaction(() => {
    // The chemist first: staff accounts point at it.
    if (!(sql.prepare("SELECT 1 FROM sync_records WHERE tbl = 'branches' LIMIT 1").get())) {
      writeRow('branches', 0, SEED_BRANCH.id, SEED_BRANCH as unknown as Rec, 0, null)
    }
    if (!(sql.prepare("SELECT 1 FROM sync_records WHERE tbl = 'users' LIMIT 1").get())) {
      for (const u of SEED_USERS) writeRow('users', 0, u.id, u as unknown as Rec, 0, null)
    } else if (
      !sql
        .prepare("SELECT 1 FROM sync_records WHERE tbl = 'users' AND deleted = 0 AND json_extract(data, '$.username') = 'purchase' LIMIT 1")
        .get()
    ) {
      const next = Number((sql.prepare("SELECT MAX(CAST(id AS INTEGER)) + 1 AS next FROM sync_records WHERE tbl = 'users'").get() as { next: number }).next) || 1
      const home = branches().find((b) => b.active) ?? branches()[0]
      if (home) writeRow('users', 0, next, { ...SEED_PURCHASE, id: next, branchId: home.id } as unknown as Rec, Date.now(), null)
    }
  })()
  ensureRelational()
  sql.transaction(() => convertLegacyKv())()
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */
const failures = new Map<string, { n: number; until: number }>()

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization ?? '')
  const session = m ? (sql.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(m[1]) as { user_id: number; last_seen: number } | undefined) : undefined
  const user = session ? (parse(getRow('users', 0, session.user_id)) as AuthedUser | undefined) : undefined
  if (!m || !session || !user || !user.active) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }
  if (Date.now() - session.last_seen > 60_000) {
    sql.prepare('UPDATE auth_sessions SET last_seen = ? WHERE token = ?').run(Date.now(), m[1])
  }
  ;(req as AuthedRequest).user = user
  ;(req as AuthedRequest).token = m[1]
  next()
}

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthedRequest).user.role !== 'owner') {
    res.status(403).json({ error: 'Admin only' })
    return
  }
  next()
}

/** Owners reach every chemist; everyone else only their own. */
function canAccessBranch(user: AuthedUser, branchId: number): boolean {
  return user.role === 'owner' || user.branchId === branchId
}

function branchParam(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/* ── Write rules ──────────────────────────────────────────────────────────── */
/** Why a change may not be stored, or undefined when it may. */
function denyReason(user: AuthedUser, tbl: string, scope: number, id: string | number, incoming: Rec | null, existing: Rec | undefined): string | undefined {
  if (tbl === 'users' && incoming) {
    const u = incoming as unknown as User
    if (!u.username || !/^[a-z0-9._-]{2,32}$/.test(u.username)) return 'User name must be 2-32 letters/digits'
    if (!u.passHash || !u.salt) return 'User has no password'
    if (!ROLES.includes(u.role)) return `Unknown role "${String(u.role)}"`
    if (u.role !== 'owner' && !branchParam(u.branchId)) return `${u.username} needs a chemist number`
    if (u.branchId && !parse(getRow('branches', 0, u.branchId))) return `Chemist ${u.branchId} does not exist`
    const clash = users().find((x) => x.username === u.username && String(x.id) !== String(id))
    if (clash) return `User name "${u.username}" is already taken`
  }
  if (tbl === 'users') {
    // Never leave the company without an active admin.
    const owners = users().filter((x) => x.role === 'owner' && x.active && String(x.id) !== String(id))
    const stillOwner = incoming && (incoming as unknown as User).role === 'owner' && (incoming as unknown as User).active
    if (owners.length === 0 && !stillOwner) return 'At least one active admin (owner) must remain'
  }
  if (tbl === 'branches' && incoming) {
    const b = incoming as unknown as Branch
    if (!Number.isInteger(b.number) || b.number < 1) return 'Chemist number must be 1 or more'
    const clash = branches().find((x) => x.number === b.number && String(x.id) !== String(id))
    if (clash) return `${chemCode(b.number)} already exists`
  }
  if (user.role === 'owner') return undefined

  if (scope !== 0) return scope === user.branchId ? undefined : 'Not your chemist'
  if (tbl === 'categories' || tbl === 'suppliers') return undefined
  if (tbl === 'messages') {
    const was = existing as unknown as StaffMessage | undefined
    if (!incoming) return was?.fromId === user.id ? undefined : 'You can only delete messages you sent'
    if (!was) return (incoming as unknown as StaffMessage).fromId === user.id ? undefined : 'A message must be sent as yourself'
    if (was.fromId === user.id) return undefined
    // Everyone else may only mark it read.
    const { readBy: _a, ...before } = existing!
    const { readBy: _b, ...after } = incoming
    return JSON.stringify(before) === JSON.stringify(after) ? undefined : 'Only the sender can change a message'
  }
  if (tbl === 'kv') return user.role === 'manager' ? undefined : 'Only the admin or a manager can change shared settings'
  if (tbl === 'users') {
    if (String(id) !== String(user.id) || !incoming || !existing) return 'Only the admin can manage staff'
    for (const k of ['username', 'role', 'branchId', 'active'] as const) {
      if (incoming[k] !== existing[k]) return 'Only the admin can change user name, role, chemist or status'
    }
    return undefined
  }
  return 'Only the admin can change chemists'
}

/* ── Router ───────────────────────────────────────────────────────────────── */
export const syncRouter = Router()

syncRouter.post('/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const key = `${req.ip}|${username}`
  const f = failures.get(key)
  if (f && f.until > Date.now()) {
    res.status(429).json({ error: 'Too many wrong passwords. Try again in a few minutes.' })
    return
  }
  const user = users().find((u) => u.username === username)
  // The purchases dashboard signs in with no password; only accounts whose
  // role is "purchase" and whose hash is an empty-password hash accept it.
  const passwordless =
    password === '' && user?.role === 'purchase' && safeEqual(hashPassword(user.salt, ''), user.passHash)
  if (
    !user ||
    !user.active ||
    !(passwordless || safeEqual(hashPassword(user.salt, password), user.passHash))
  ) {
    const n = (f?.n ?? 0) + 1
    failures.set(key, { n, until: n >= 8 ? Date.now() + 5 * 60_000 : 0 })
    res.status(401).json({ error: user && !user.active ? 'This account is disabled' : 'Invalid user name or password' })
    return
  }
  failures.delete(key)
  if (user.role !== 'owner') {
    const b = user.branchId ? (parse(getRow('branches', 0, user.branchId)) as Branch | undefined) : undefined
    if (!b || !b.active) {
      res.status(403).json({ error: 'Your chemist is closed or not set. Ask the admin.' })
      return
    }
  }
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  sql.prepare('INSERT INTO auth_sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(token, user.id, now, now)
  res.json({ token, user, branches: branches() })
})

syncRouter.post('/auth/logout', requireAuth, (req, res) => {
  sql.prepare('DELETE FROM auth_sessions WHERE token = ?').run((req as AuthedRequest).token)
  res.json({ ok: true })
})

syncRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: (req as AuthedRequest).user, branches: branches() })
})

syncRouter.get('/sync/pull', requireAuth, (req, res) => {
  const user = (req as AuthedRequest).user
  const branchId = branchParam(req.query.branch)
  if (!branchId || !canAccessBranch(user, branchId)) {
    res.status(403).json({ error: 'Not your chemist' })
    return
  }
  let since = Math.max(0, Number(req.query.since) || 0)
  // A cursor from before a server reset: start over.
  if (since > (stmt.maxSeq.get() as { v: number }).v) since = 0
  const rows = stmt.pull.all(since, branchId) as Row[]
  res.json({
    changes: rows.map(toPulled),
    cursor: rows.length ? rows[rows.length - 1].seq : since,
    more: rows.length === PULL_LIMIT,
  })
})

syncRouter.post('/sync/push', requireAuth, (req, res) => {
  const user = (req as AuthedRequest).user
  const branchId = branchParam(req.body?.branchId)
  if (!branchId || !canAccessBranch(user, branchId)) {
    res.status(403).json({ error: 'Not your chemist' })
    return
  }
  const changes = Array.isArray(req.body?.changes) ? (req.body.changes as Rec[]) : []
  const deletes = Array.isArray(req.body?.deletes) ? (req.body.deletes as Rec[]) : []
  const rejected: { t: string; id: string | number; reason: string; current: ReturnType<typeof toPulled> | null }[] = []
  const reject = (t: string, id: string | number, scope: number, reason: string) => {
    const row = getRow(t, scope, id)
    rejected.push({ t, id, reason, current: row ? toPulled(row) : null })
  }

  let legacyPushed = false
  try {
    sql.transaction(() => {
      for (const c of changes) {
        const t = String(c.t)
        const id = c.id as string | number
        const data = c.data as Rec | undefined
        if (!SYNCED_TABLES.includes(t) || id === undefined || id === null || !data || typeof data !== 'object') continue
        if (t === 'kv' && isLocalKvKey(String(id))) continue
        const scope = scopeOf(t, id, branchId)
        const row = getRow(t, scope, id)
        const existing = parse(row)
        const ts = Math.min(Number(c.ts) || 0, Date.now() + 5 * 60_000)
        const why = denyReason(user, t, scope, id, data, existing)
        if (why) {
          reject(t, id, scope, why)
          continue
        }
        // Deleted later than this edit: the delete stands.
        if (row?.deleted && row.ts > ts) continue

        let next: Rec
        if (!existing) {
          // New record: its counters already include every local change.
          next = { ...data }
        } else {
          next = ts >= row!.ts ? { ...data } : { ...existing }
          const deltas = (c.deltas ?? {}) as Record<string, number>
          for (const f of COUNTER_FIELDS[t] ?? []) next[f] = Number(existing[f] ?? 0) + (Number(deltas[f]) || 0)
          if (t === 'kv' && isSeqKvKey(String(id))) next.value = Math.max(Number(existing.value ?? 0), Number(data.value ?? 0))
        }
        writeRow(t, scope, id, next, Math.max(ts, row?.ts ?? 0), user.id)
        if (t === 'kv' && isLegacyKvKey(String(id))) legacyPushed = true
      }
      for (const d of deletes) {
        const t = String(d.t)
        const id = d.id as string | number
        if (!SYNCED_TABLES.includes(t) || id === undefined || id === null) continue
        const scope = scopeOf(t, id, branchId)
        const row = getRow(t, scope, id)
        if (!row || row.deleted) continue
        const why = denyReason(user, t, scope, id, null, parse(row))
        if (why) {
          reject(t, id, scope, why)
          continue
        }
        writeRow(t, scope, id, null, Math.max(Number(d.at) || Date.now(), row.ts), user.id)
      }
      if (legacyPushed) convertLegacyKv(branchId)
    })()
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
    return
  }
  res.json({ ok: true, rejected })
})

/* ── Admin: all chemists ──────────────────────────────────────────────────── */
syncRouter.get('/admin/overview', requireAuth, requireOwner, (req, res) => {
  const dayStart = Number(req.query.dayStart) || new Date().setHours(0, 0, 0, 0)
  const monthStart = Number(req.query.monthStart) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  // dayStart is the till's local midnight, so whole-day steps from it are the till's local days.
  const trendFrom = dayStart - 6 * 86_400_000

  const sales = sql
    .prepare(
      `SELECT scope,
         SUM(CASE WHEN json_extract(data, '$.createdAt') >= @day THEN json_extract(data, '$.total') ELSE 0 END) AS today,
         SUM(CASE WHEN json_extract(data, '$.createdAt') >= @day AND json_extract(data, '$.total') > 0 THEN 1 ELSE 0 END) AS todayCount,
         SUM(CASE WHEN json_extract(data, '$.createdAt') >= @month THEN json_extract(data, '$.total') ELSE 0 END) AS month,
         MAX(json_extract(data, '$.createdAt')) AS lastSale
       FROM sync_records
       WHERE tbl = 'sales' AND deleted = 0 AND json_extract(data, '$.status') != 'voided'
       GROUP BY scope`,
    )
    .all({ day: dayStart, month: monthStart }) as { scope: number; today: number | null; todayCount: number; month: number | null; lastSale: number | null }[]

  const stock = sql
    .prepare(
      `SELECT scope,
         COUNT(*) AS products,
         SUM(CASE WHEN json_extract(data, '$.trackStock') AND json_extract(data, '$.stock') > 0
                  THEN json_extract(data, '$.stock') * json_extract(data, '$.cost') ELSE 0 END) AS stockValue,
         SUM(CASE WHEN json_extract(data, '$.active') AND json_extract(data, '$.trackStock')
                   AND json_extract(data, '$.stock') <= json_extract(data, '$.reorderLevel') THEN 1 ELSE 0 END) AS lowStock,
         SUM(CASE WHEN json_extract(data, '$.trackStock') AND json_extract(data, '$.stock') <= 0 THEN 1 ELSE 0 END) AS outOfStock
       FROM sync_records
       WHERE tbl = 'products' AND deleted = 0
       GROUP BY scope`,
    )
    .all() as { scope: number; products: number; stockValue: number | null; lowStock: number; outOfStock: number }[]

  const owing = sql
    .prepare(
      `SELECT scope, SUM(MAX(json_extract(data, '$.balance'), 0)) AS owing
       FROM sync_records WHERE tbl = 'customers' AND deleted = 0 GROUP BY scope`,
    )
    .all() as { scope: number; owing: number | null }[]

  const openShifts = sql
    .prepare(
      `SELECT scope, json_extract(data, '$.userId') AS userId, json_extract(data, '$.openedAt') AS openedAt
       FROM sync_records WHERE tbl = 'shifts' AND deleted = 0 AND json_extract(data, '$.closedAt') IS NULL`,
    )
    .all() as { scope: number; userId: number; openedAt: number }[]

  const trend = sql
    .prepare(
      `SELECT scope, CAST((json_extract(data, '$.createdAt') - @from) / 86400000 AS INTEGER) AS day,
         SUM(json_extract(data, '$.total')) AS total
       FROM sync_records
       WHERE tbl = 'sales' AND deleted = 0 AND json_extract(data, '$.status') != 'voided'
         AND json_extract(data, '$.createdAt') >= @from
       GROUP BY scope, day`,
    )
    .all({ from: trendFrom }) as { scope: number; day: number; total: number }[]

  const activity = sql
    .prepare('SELECT scope, MAX(updated_at) AS at FROM sync_records WHERE scope > 0 GROUP BY scope')
    .all() as { scope: number; at: number }[]

  const allUsers = users()
  const by = <T extends { scope: number }>(list: T[], scope: number) => list.find((x) => x.scope === scope)
  res.json({
    branches: branches().map((b) => {
      const s = by(sales, b.id)
      const k = by(stock, b.id)
      const shift = openShifts.find((x) => x.scope === b.id)
      return {
        ...b,
        code: chemCode(b.number),
        todaySales: s?.today ?? 0,
        todayCount: s?.todayCount ?? 0,
        monthSales: s?.month ?? 0,
        lastSale: s?.lastSale ?? null,
        products: k?.products ?? 0,
        stockValue: k?.stockValue ?? 0,
        lowStock: k?.lowStock ?? 0,
        outOfStock: k?.outOfStock ?? 0,
        owing: by(owing, b.id)?.owing ?? 0,
        openShift: shift ? { by: allUsers.find((u) => u.id === shift.userId)?.name ?? '', at: shift.openedAt } : null,
        staff: allUsers.filter((u) => u.branchId === b.id && u.active).map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role })),
        lastActivity: by(activity, b.id)?.at ?? null,
        trend: Array.from({ length: 7 }, (_, i) => trend.find((t) => t.scope === b.id && t.day === i)?.total ?? 0),
      }
    }),
    trendFrom,
  })
})

/** Medicines of one chemist (for comparing, copying and transfers). */
syncRouter.get('/admin/products', requireAuth, requireOwner, (req, res) => {
  const branchId = branchParam(req.query.branch)
  if (!branchId) {
    res.status(400).json({ error: 'branch is required' })
    return
  }
  res.json(listTable<Product>('products', branchId).sort((a, b) => a.name.localeCompare(b.name)))
})

/** Copy the medicine list of one chemist into another (zero stock; existing SKUs are skipped). */
syncRouter.post('/admin/copy-catalogue', requireAuth, requireOwner, (req, res) => {
  const user = (req as AuthedRequest).user
  const from = branchParam(req.body?.from)
  const to = branchParam(req.body?.to)
  if (!from || !to || from === to || !parse(getRow('branches', 0, to))) {
    res.status(400).json({ error: 'Pick two different chemists' })
    return
  }
  const have = new Set(listTable<Product>('products', to).map((p) => p.sku.toUpperCase()))
  const now = Date.now()
  let added = 0
  sql.transaction(() => {
    for (const p of listTable<Product & { id: number }>('products', from)) {
      if (have.has(p.sku.toUpperCase())) continue
      const id = newServerId()
      writeRow('products', to, id, { ...p, id, stock: 0, createdAt: now, updatedAt: now }, now, user.id)
      have.add(p.sku.toUpperCase())
      added++
    }
    if (added) addLog(to, user, `Medicine list copied from ${branchCode(from)}`, `${added} medicine(s)`)
  })()
  res.json({ ok: true, added })
})

/** Move stock from one chemist to another. Creates the medicine at the receiving chemist if it has none with that SKU. */
syncRouter.post('/admin/transfer', requireAuth, requireOwner, (req, res) => {
  const user = (req as AuthedRequest).user
  const from = branchParam(req.body?.from)
  const to = branchParam(req.body?.to)
  const items = Array.isArray(req.body?.items) ? (req.body.items as { productId: number; qty: number }[]) : []
  if (!from || !to || from === to || !parse(getRow('branches', 0, to))) {
    res.status(400).json({ error: 'Pick two different chemists' })
    return
  }
  if (items.length === 0 || items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) {
    res.status(400).json({ error: 'Enter a whole quantity above 0 for each medicine' })
    return
  }
  const now = Date.now()
  const ref = `TRF-${branchCode(from)}-${branchCode(to)}-${now.toString(36).toUpperCase()}`
  try {
    sql.transaction(() => {
      const dest = listTable<Product & { id: number }>('products', to)
      for (const item of items) {
        const src = parse(getRow('products', from, item.productId)) as (Product & { id: number }) | undefined
        if (!src) throw new Error(`Medicine ${item.productId} not found at ${branchCode(from)}`)
        if (src.trackStock && src.stock < item.qty) throw new Error(`${src.name}: only ${src.stock} in stock at ${branchCode(from)}`)
        writeRow('products', from, src.id, { ...src, stock: src.stock - item.qty, updatedAt: now }, now, user.id)
        writeRow('movements', from, newServerId(), { productId: src.id, change: -item.qty, reason: 'transfer', reference: ref, note: `To ${branchCode(to)}`, userId: user.id, at: now }, now, user.id)

        let target = dest.find((p) => p.sku.toUpperCase() === src.sku.toUpperCase())
        if (target) {
          target = { ...target, stock: target.stock + item.qty, updatedAt: now }
        } else {
          target = { ...src, id: newServerId(), stock: item.qty, createdAt: now, updatedAt: now }
          dest.push(target)
        }
        writeRow('products', to, target.id, target as unknown as Rec, now, user.id)
        writeRow('movements', to, newServerId(), { productId: target.id, change: item.qty, reason: 'transfer', reference: ref, note: `From ${branchCode(from)}`, userId: user.id, at: now }, now, user.id)
      }
      const detail = `${items.length} medicine(s) · ${ref}`
      addLog(from, user, `Stock transferred to ${branchCode(to)}`, detail)
      addLog(to, user, `Stock received from ${branchCode(from)}`, detail)
    })()
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
    return
  }
  res.json({ ok: true, reference: ref })
})

/* ── helpers ──────────────────────────────────────────────────────────────── */
// Same id scheme as the tills (src/db/db.ts genId) so server-made records never clash.
let lastServerId = 0
function newServerId(): number {
  const id = (Date.now() - 1_700_000_000_000) * 4096 + Math.floor(Math.random() * 4096)
  lastServerId = id > lastServerId ? id : lastServerId + 1
  return lastServerId
}

function branchCode(branchId: number): string {
  const b = parse(getRow('branches', 0, branchId)) as Branch | undefined
  return b ? chemCode(b.number) : `#${branchId}`
}

function addLog(scope: number, user: AuthedUser, action: string, detail: string) {
  const id = newServerId()
  writeRow('logs', scope, id, { id, at: Date.now(), kind: 'stock', action, detail, userId: user.id, userName: user.name }, Date.now(), user.id)
}
