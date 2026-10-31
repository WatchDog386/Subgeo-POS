import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeBranchId, db, markRemote, switchBranchDb } from './db/db'
import { logActivity } from './db/logs'
import { HttpError, api, flushPending, setForbiddenHandler, setSyncToken, setUnauthorizedHandler, startSync, stopSync, syncNow, syncToken } from './db/sync'
import { chemCode } from './db/seedData'
import { hashPassword } from './lib/sha256'
import type { Branch, Role, Shift, User } from './db/types'

export type LoginResult = { ok: true } | { ok: false; error: string }

interface SessionValue {
  user: User | null
  shift: Shift | undefined
  /** The chemist whose data is on screen. */
  branch: Branch | undefined
  branchId: number
  /** "CHEM1" for the open chemist. */
  branchCode: string
  /** Every chemist, ordered by number. */
  branches: Branch[]
  /** Changes whenever another chemist's database is opened; screens remount on it. */
  dbEpoch: number
  login: (username: string, password: string) => Promise<LoginResult>
  /** Lock the till: signs the user out and returns to the sign-in page. */
  lock: () => void
  /** Admin only: open another chemist. Resolves false if that chemist is not reachable. */
  switchBranch: (branchId: number) => Promise<{ ok: boolean; warning?: string }>
  can: (action: Permission) => boolean
  restoring: boolean
}

export type Permission = 'refund' | 'discount' | 'inventory' | 'reports' | 'settings' | 'purchasing' | 'users' | 'logs' | 'branches'

export const PERMS: Record<Role, Permission[]> = {
  owner: ['refund', 'discount', 'inventory', 'reports', 'settings', 'purchasing', 'users', 'logs', 'branches'],
  manager: ['refund', 'discount', 'inventory', 'reports', 'purchasing', 'logs'],
  cashier: ['discount'],
  purchase: ['purchasing', 'inventory', 'reports'],
}

/** Minimum password length for new or changed passwords. */
export { PASSWORD_MIN } from './db/staff'

export const ROLE_LABEL: Record<Role, string> = { owner: 'ADMIN', manager: 'MANAGER', cashier: 'CASHIER', purchase: 'PURCHASE' }

type LoginResponse = { token: string; user: User & { id: number }; branches: (Branch & { id: number })[] }

/** Chemist an account works in; the admin keeps the last one opened. */
function homeBranch(user: User, branches: Branch[]): number | undefined {
  if (user.role !== 'owner') return user.branchId
  const open = branches.filter((b) => b.active)
  return (open.find((b) => b.id === activeBranchId) ?? open[0] ?? branches[0])?.id
}

/** Store what the server said about this account and the chemists, unless there are local edits not yet uploaded. */
async function storeServerCopies(user: User, branches: Branch[]) {
  await db.transaction('rw', db.users, db.branches, async (tx) => {
    markRemote(tx)
    const putIfClean = async (table: typeof db.users | typeof db.branches, rec: User | Branch) => {
      const cur = (await table.get(rec.id!)) as { _dirty?: number } | undefined
      if (cur?._dirty !== 1) await (table as typeof db.users).put({ ...(rec as User), _dirty: 0, _ts: 0 } as User)
    }
    await putIfClean(db.users, user)
    for (const b of branches) await putIfClean(db.branches, b)
  })
}

const SessionContext = createContext<SessionValue | null>(null)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [dbEpoch, setDbEpoch] = useState(0)
  /** Kept in memory only, to get a fresh server token after an offline sign-in or a server restart. */
  const password = useRef<string | null>(null)

  const shift = useLiveQuery(() => db.shifts.filter((s) => !s.closedAt).last(), [dbEpoch])
  // Keep the signed-in user live so profile edits (name, photo) show everywhere.
  const liveUser = useLiveQuery(() => (authUser?.id ? db.users.get(authUser.id) : undefined), [authUser?.id, dbEpoch])
  const user = liveUser && liveUser.active ? liveUser : liveUser ? null : authUser
  const branches = useLiveQuery(async () => (await db.branches.toArray()).sort((a, b) => a.number - b.number), [dbEpoch], [] as Branch[])
  const branch = branches.find((b) => b.id === activeBranchId)

  const openBranch = useCallback(async (branchId: number) => {
    if (branchId === activeBranchId) return
    stopSync()
    await switchBranchDb(branchId)
    setDbEpoch((e) => e + 1)
  }, [])

  // Restore the signed-in user across reloads so staff stay in the system.
  useEffect(() => {
    let cancelled = false
    const id = localStorage.getItem('authUserId')
    if (!id) {
      setRestoring(false)
      return
    }
    void (async () => {
      const u = await db.users.get(Number(id))
      if (cancelled) return
      if (u && u.active) {
        if (u.role !== 'owner' && u.branchId && u.branchId !== activeBranchId) await openBranch(u.branchId)
        if (localStorage.getItem('syncTokenUser') !== String(u.id)) setSyncToken(null)
        setAuthUser(u)
      }
      setRestoring(false)
    })()
    return () => {
      cancelled = true
    }
  }, [openBranch])

  // The admin moved this cashier to another chemist while signed in: follow.
  useEffect(() => {
    if (user && user.role !== 'owner' && user.branchId && user.branchId !== activeBranchId) void openBranch(user.branchId)
  }, [user, openBranch])

  // Background sync while someone is signed in (it restarts on every chemist switch).
  useEffect(() => {
    if (!authUser) return
    startSync()
    return () => stopSync()
  }, [authUser, dbEpoch])

  const reauth = useCallback(async (u: User) => {
    if (!password.current) return false
    try {
      const r = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u.username, password: password.current }),
        timeoutMs: 8000,
      })
      if (r.user.id !== u.id) return false
      setSyncToken(r.token)
      localStorage.setItem('syncTokenUser', String(r.user.id))
      void syncNow()
      return true
    } catch {
      return false
    }
  }, [])

  const lock = useCallback(() => {
    if (!user) return
    void logActivity('auth', 'Till locked', { userId: user.id, userName: user.name })
    setAuthUser(null)
    localStorage.removeItem('authUserId')
    password.current = null
    // Upload what's waiting, then end this user's server session — unless
    // someone else has signed in meanwhile (their token must survive).
    const mine = syncToken()
    void (async () => {
      await Promise.race([flushPending(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {})
      if (!mine || syncToken() !== mine) return
      await api('/auth/logout', { method: 'POST', timeoutMs: 5000 }).catch(() => {})
      if (syncToken() !== mine) return
      setSyncToken(null)
      localStorage.removeItem('syncTokenUser')
    })()
  }, [user])

  // Server says the token is no longer valid: get a new one, or sign out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!authUser) return
      void reauth(authUser).then((ok) => {
        if (!ok) {
          setSyncToken(null)
          localStorage.removeItem('syncTokenUser')
        }
      })
    })
    return () => setUnauthorizedHandler(null)
  }, [authUser, reauth])

  // Server refused this chemist: fetch the account as the server has it. If the
  // admin moved this cashier, the effect above then opens the new chemist.
  useEffect(() => {
    setForbiddenHandler(() => {
      void api<{ user: User; branches: Branch[] }>('/auth/me', { timeoutMs: 8000 })
        .then((r) => storeServerCopies(r.user, r.branches))
        .catch(() => {})
    })
    return () => setForbiddenHandler(null)
  }, [])

  // Signed in offline: keep trying to reach the server so sync can start.
  useEffect(() => {
    if (!authUser) return
    const t = setInterval(() => {
      if (!syncToken()) void reauth(authUser)
    }, 30_000)
    return () => clearInterval(t)
  }, [authUser, reauth])

  const login = useCallback(
    async (username: string, pass: string): Promise<LoginResult> => {
      const uname = username.trim().toLowerCase()
      // The purchase dashboard signs in with no password; the server only
      // accepts one from an account whose role is "purchase".
      if (!uname || (!pass && uname !== 'purchase')) return { ok: false, error: 'Enter your user name and password' }
      let u: User | undefined
      try {
        const r = await api<LoginResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: uname, password: pass }),
          timeoutMs: 8000,
        })
        const target = homeBranch(r.user, r.branches)
        if (!target) return { ok: false, error: 'No chemist has been set up yet' }
        await openBranch(target)
        await storeServerCopies(r.user, r.branches)
        setSyncToken(r.token)
        localStorage.setItem('syncTokenUser', String(r.user.id))
        // Bring this chemist's data down before the screens open (bounded, so a slow line can't block sign-in).
        await Promise.race([syncNow(), new Promise((res) => setTimeout(res, 10_000))]).catch(() => {})
        u = (await db.users.get(r.user.id)) ?? r.user
      } catch (e) {
        // Wrong password, disabled account, closed chemist… — the server's answer is final.
        if (e instanceof HttpError && e.status !== 503 && e.status < 500) return { ok: false, error: e.message }
        // Server unreachable: sign in against the copy of the staff list on this till.
        const local = await db.users.where('username').equals(uname).first()
        if (!local || hashPassword(local.salt, pass) !== local.passHash) return { ok: false, error: 'Invalid user name or password' }
        if (!local.active) return { ok: false, error: 'This account is disabled' }
        const allBranches = await db.branches.toArray()
        const target = homeBranch(local, allBranches)
        if (!target) return { ok: false, error: 'This account has no chemist. Ask the admin.' }
        if (local.role !== 'owner' && !allBranches.find((b) => b.id === target)?.active) {
          return { ok: false, error: 'Your chemist is closed or not set. Ask the admin.' }
        }
        await openBranch(target)
        if (localStorage.getItem('syncTokenUser') !== String(local.id)) {
          setSyncToken(null)
          localStorage.removeItem('syncTokenUser')
        }
        u = local
      }
      password.current = pass
      setAuthUser(u)
      localStorage.setItem('authUserId', String(u.id))
      const b = await db.branches.get(activeBranchId)
      await logActivity('auth', 'Signed in', { userId: u.id, userName: u.name, detail: b ? chemCode(b.number) : undefined })
      return { ok: true }
    },
    [openBranch],
  )

  const switchBranch = useCallback(
    async (branchId: number) => {
      if (!user || user.role !== 'owner') return { ok: false, warning: 'Only the admin can switch chemist' }
      if (branchId === activeBranchId) return { ok: true }
      const flushed = await Promise.race([flushPending(), new Promise<boolean>((r) => setTimeout(() => r(false), 10_000))]).catch(() => false)
      const from = branch ? chemCode(branch.number) : ''
      await openBranch(branchId)
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => {})
      return {
        ok: true,
        warning: flushed ? undefined : `Some ${from} changes are not uploaded yet (no connection). They upload when you open ${from} again.`,
      }
    },
    [user, branch, openBranch],
  )

  const can = useCallback((a: Permission) => !!user && (PERMS[user.role] ?? []).includes(a), [user])

  // Auto-lock after 15 minutes without any interaction.
  useEffect(() => {
    if (!user) return
    let timer = window.setTimeout(() => lock(), 15 * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => lock(), 15 * 60_000)
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [user, lock])

  return (
    <SessionContext.Provider
      value={{
        user,
        shift,
        branch,
        branchId: activeBranchId,
        branchCode: branch ? chemCode(branch.number) : '',
        branches,
        dbEpoch,
        login,
        lock,
        switchBranch,
        can,
        restoring,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
