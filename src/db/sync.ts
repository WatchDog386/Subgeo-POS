// Two-way sync between the open chemist database (IndexedDB) and the server
// (SQLite, server/sync.ts). The till keeps working offline; changes queue up
// (_dirty records and outbox tombstones) and upload when the server is back.
//
// One cycle = push local changes, then pull everything newer than the cursor.
import { useSyncExternalStore } from 'react'
import { COUNTER_FIELDS, SYNCED_TABLES, activeBranchId, db, isSeqKvKey, markRemote, onLocalChange, stripMeta } from './db'

export interface SyncState {
  /** off: not signed in to the server (offline sign-in, or no server). */
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt?: number
  pending: number
  error?: string
}

interface Change {
  t: string
  id: string | number
  data: Record<string, unknown>
  ts: number
  deltas?: Record<string, number>
}
interface PulledRecord {
  t: string
  id: string | number
  data: Record<string, unknown> | null
  deleted: boolean
  ts: number
}
interface Rejected {
  t: string
  id: string | number
  reason: string
  current: PulledRecord | null
}

const PUSH_BATCH = 400
const PUSH_BYTES = 4_000_000
const CURSOR_KEY = '_local:syncCursor'

let state: SyncState = { status: 'off', pending: 0 }
const listeners = new Set<() => void>()
function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export function getSyncState(): SyncState {
  return state
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/* ── Auth token (issued by POST /api/auth/login) ─────────────────────────── */
let token: string | null = readToken()
function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem('syncToken') ?? null
  } catch {
    return null
  }
}
export function setSyncToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem('syncToken', t)
    else localStorage.removeItem('syncToken')
  } catch {
    /* ignore */
  }
  setState({ status: t ? 'idle' : 'off', error: undefined })
}
export function syncToken(): string | null {
  return token
}

/** Called when the server answers 401 — the session layer re-signs-in. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Origin of the API; empty = same origin as the app (tests point it at a test server). */
let apiBase = ''
export function setApiBase(base: string) {
  apiBase = base
}

export async function api<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 20_000)
  try {
    const r = await fetch(`${apiBase}/api${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const text = await r.text()
    let body: unknown = undefined
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // Not JSON: the app is being served without the API (static hosting / dev without server).
      throw new HttpError(503, 'Server API not available')
    }
    if (!r.ok) throw new HttpError(r.status, (body as { error?: string } | undefined)?.error ?? `HTTP ${r.status}`)
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

/* ── Push ─────────────────────────────────────────────────────────────────── */
async function countPending(): Promise<number> {
  let n = await db.outbox.count()
  for (const name of SYNCED_TABLES) n += await db.table(name).where('_dirty').equals(1).count()
  return n
}

async function push(branchId: number): Promise<void> {
  for (;;) {
    const changes: Change[] = []
    let bytes = 0
    for (const name of SYNCED_TABLES) {
      if (changes.length >= PUSH_BATCH || bytes >= PUSH_BYTES) break
      const rows = (await db
        .table(name)
        .where('_dirty')
        .equals(1)
        .limit(PUSH_BATCH - changes.length)
        .toArray()) as Record<string, unknown>[]
      for (const r of rows) {
        // Product photos are data URLs; keep each upload well under the 25 MB proxy limit.
        const size = JSON.stringify(r).length
        if (changes.length > 0 && bytes + size > PUSH_BYTES) break
        bytes += size
        const deltas: Record<string, number> = {}
        for (const f of COUNTER_FIELDS[name] ?? []) deltas[f] = Number(r[`_d_${f}`] ?? 0)
        changes.push({
          t: name,
          id: (name === 'kv' ? r.key : r.id) as string | number,
          data: stripMeta(r),
          ts: Number(r._ts ?? 0),
          deltas: COUNTER_FIELDS[name] ? deltas : undefined,
        })
      }
    }
    const queued = await db.outbox.orderBy('seq').limit(PUSH_BATCH).toArray()
    // A record deleted and then written again (restore, re-add) exists now: its delete is moot.
    const tombs: typeof queued = []
    const moot: number[] = []
    for (const d of queued) {
      if (SYNCED_TABLES.includes(d.t) && (await db.table(d.t).get(d.id)) === undefined) tombs.push(d)
      else moot.push(d.seq!)
    }
    if (moot.length) await db.outbox.bulkDelete(moot)
    if (changes.length === 0 && tombs.length === 0) {
      if (moot.length) continue
      return
    }

    const res = await api<{ ok: true; rejected: Rejected[] }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({ branchId, changes, deletes: tombs.map((d) => ({ t: d.t, id: d.id, at: d.at })) }),
      timeoutMs: 60_000,
    })

    // Clear the dirty flags of what the server took. A record edited again
    // while the upload was in flight keeps its flag (its _ts moved on).
    const tables = [...SYNCED_TABLES.map((n) => db.table(n)), db.outbox]
    await db.transaction('rw', tables, async (tx) => {
      markRemote(tx)
      for (const c of changes) {
        const table = db.table(c.t)
        const cur = (await table.get(c.id)) as Record<string, unknown> | undefined
        if (!cur) continue
        const patch: Record<string, unknown> = {}
        for (const [f, d] of Object.entries(c.deltas ?? {})) patch[`_d_${f}`] = Number(cur[`_d_${f}`] ?? 0) - d
        if (Number(cur._ts ?? 0) === c.ts) patch._dirty = 0
        await table.update(c.id, patch)
      }
      await db.outbox.bulkDelete(tombs.map((t) => t.seq!))
      for (const r of res.rejected ?? []) await applyRecord(r.current ?? { t: r.t, id: r.id, data: null, deleted: true, ts: 0 }, true)
    })
    if (res.rejected?.length) {
      setState({ error: `Server refused ${res.rejected.length} change(s): ${res.rejected[0].reason}` })
    }
  }
}

/* ── Pull ─────────────────────────────────────────────────────────────────── */
/** Write one server record into the local database (inside a remote transaction). */
async function applyRecord(rec: PulledRecord, force = false): Promise<void> {
  if (!SYNCED_TABLES.includes(rec.t)) return
  const table = db.table(rec.t)
  const local = (await table.get(rec.id)) as Record<string, unknown> | undefined
  if (rec.deleted || !rec.data) {
    if (local) await table.delete(rec.id)
    return
  }
  const counters = COUNTER_FIELDS[rec.t] ?? []
  const data = rec.data
  if (local && local._dirty === 1 && !force) {
    // Local edits win until uploaded, but counters re-base on the server value.
    const patch: Record<string, unknown> = {}
    for (const f of counters) patch[f] = Number(data[f] ?? 0) + Number(local[`_d_${f}`] ?? 0)
    if (rec.t === 'kv' && isSeqKvKey(String(rec.id))) {
      patch.value = Math.max(Number(local.value ?? 0), Number(data.value ?? 0))
    }
    if (Object.keys(patch).length) await table.update(rec.id, patch)
    return
  }
  const next: Record<string, unknown> = { ...data, _dirty: 0, _ts: rec.ts }
  for (const f of counters) {
    const pending = force ? 0 : Number(local?.[`_d_${f}`] ?? 0)
    next[f] = Number(data[f] ?? 0) + pending
    next[`_d_${f}`] = pending
  }
  if (rec.t === 'kv' && isSeqKvKey(String(rec.id)) && local && Number(local.value ?? 0) > Number(data.value ?? 0)) {
    // Never move a document counter backwards; upload the higher value.
    next.value = local.value
    next._dirty = 1
  }
  await table.put(next)
}

async function pull(branchId: number): Promise<void> {
  for (;;) {
    const cursor = Number((await db.kv.get(CURSOR_KEY))?.value ?? 0)
    const res = await api<{ changes: PulledRecord[]; cursor: number; more: boolean }>(
      `/sync/pull?branch=${branchId}&since=${cursor}`,
      { timeoutMs: 60_000 },
    )
    if (res.changes.length) {
      const tables = SYNCED_TABLES.map((n) => db.table(n))
      await db.transaction('rw', tables, async (tx) => {
        markRemote(tx)
        for (const rec of res.changes) await applyRecord(rec)
        await db.kv.put({ key: CURSOR_KEY, value: res.cursor })
      })
    } else if (res.cursor !== cursor) {
      await db.kv.put({ key: CURSOR_KEY, value: res.cursor })
    }
    if (!res.more) return
  }
}

/* ── Engine ──────────────────────────────────────────────────────────────── */
let running: Promise<void> | null = null
let rerun = false

/** Run one push + pull now (or right after the one in progress). */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      await cycle()
    } while (rerun)
  })().finally(() => {
    running = null
  })
  return running
}

async function cycle(): Promise<void> {
  if (!token) {
    setState({ status: 'off', pending: await countPending().catch(() => 0) })
    return
  }
  const branchId = activeBranchId
  setState({ status: 'syncing' })
  try {
    await push(branchId)
    // The admin may have switched chemist mid-cycle; the next cycle handles the new one.
    if (branchId === activeBranchId) await pull(branchId)
    setState({ status: 'idle', lastSyncAt: Date.now(), pending: await countPending(), error: state.error?.startsWith('Server refused') ? state.error : undefined })
  } catch (e) {
    const pending = await countPending().catch(() => state.pending)
    if (e instanceof HttpError && e.status === 401) {
      setState({ status: 'error', pending, error: 'Signed out by the server — sign in again' })
      onUnauthorized?.()
    } else if (e instanceof HttpError && e.status !== 503) {
      setState({ status: 'error', pending, error: e.message })
    } else {
      setState({ status: 'offline', pending, error: undefined })
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null

/** Start background sync: every 15 s, and 1.5 s after any local change. */
export function startSync(): void {
  stopSync()
  unsubscribe = onLocalChange(() => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow(), 1500)
  })
  timer = setInterval(() => void syncNow(), 15_000)
  const online = () => void syncNow()
  window.addEventListener('online', online)
  const prevUnsub = unsubscribe
  unsubscribe = () => {
    prevUnsub()
    window.removeEventListener('online', online)
  }
  void syncNow()
}

export function stopSync(): void {
  if (timer) clearInterval(timer)
  if (debounce) clearTimeout(debounce)
  unsubscribe?.()
  timer = null
  debounce = null
  unsubscribe = null
}

/** Upload everything waiting before e.g. switching chemist. Resolves false if it couldn't. */
export async function flushPending(): Promise<boolean> {
  if (!token) return (await countPending()) === 0
  await syncNow()
  return (await countPending()) === 0
}
