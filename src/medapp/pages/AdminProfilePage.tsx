import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { chemCode } from '../../db/seedData'
import { PASSWORD_MIN, saveStaff } from '../../db/staff'
import { syncNow } from '../../db/sync'
import { hashPassword } from '../../lib/sha256'
import type { Branch, User } from '../../db/types'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { Btn, Input } from '../ui'

const ROLE_LABEL: Record<string, string> = { owner: 'ADMIN', manager: 'MANAGER', cashier: 'CASHIER', purchase: 'PURCHASE' }

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ma-group" style={{ marginBottom: 12 }}>
      <div className="ma-group-head">{title}</div>
      <div style={{ padding: '10px 12px' }}>{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ma-label" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span>{label}</span>
      <span>{children}</span>
    </label>
  )
}

/** Save an existing account with its details unchanged except the given ones. */
function update(u: User, change: { name?: string; email?: string; phone?: string; password?: string }, actor: User) {
  return saveStaff(
    {
      id: u.id,
      username: u.username,
      name: change.name ?? u.name,
      email: change.email ?? u.email,
      phone: change.phone ?? u.phone,
      about: u.about,
      password: change.password,
      role: u.role,
      branchId: u.branchId,
      active: u.active,
    },
    actor,
  )
}

/**
 * The signed-in admin's own profile: details, their own password, and (for
 * the admin) a new password for each chemist's sign-in accounts.
 */
export default function AdminProfilePage() {
  const { user, branches } = useSession()
  const toast = useToast()
  const me = useLiveQuery(() => (user?.id ? db.users.get(user.id) : undefined), [user?.id])
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const [name, setName] = useState<string>()
  const [email, setEmail] = useState<string>()
  const [phone, setPhone] = useState<string>()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [chemPass, setChemPass] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  const isAdmin = me?.role === 'owner'
  const chemAccounts = useMemo(() => {
    const byBranch = new Map<number, Branch>(branches.map((b) => [b.id!, b]))
    return users
      .filter((u) => u.branchId !== undefined && byBranch.has(u.branchId) && (u.role === 'cashier' || u.role === 'manager'))
      .map((u) => ({ u, b: byBranch.get(u.branchId!)! }))
      .sort((x, y) => x.b.number - y.b.number || x.u.username.localeCompare(y.u.username))
  }, [users, branches])

  if (!me) return null

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      toast(await fn())
      void syncNow()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveDetails = () =>
    run(async () => {
      await update(me, { name: (name ?? me.name).trim(), email: email ?? me.email ?? '', phone: phone ?? me.phone ?? '' }, me)
      setName(undefined)
      setEmail(undefined)
      setPhone(undefined)
      return 'Your details are saved'
    })

  const savePassword = () =>
    run(async () => {
      if (hashPassword(me.salt, current) !== me.passHash) throw new Error('Your current password is not right')
      if (next.length < PASSWORD_MIN) throw new Error(`The new password needs at least ${PASSWORD_MIN} characters`)
      if (next !== again) throw new Error('The two new passwords are not the same')
      if (next === current) throw new Error('The new password is the same as the current one')
      await update(me, { password: next }, me)
      setCurrent('')
      setNext('')
      setAgain('')
      return 'Your password is changed — use it the next time you sign in'
    })

  const saveChemPassword = (u: User, b: Branch) =>
    run(async () => {
      const pw = (chemPass[u.id!] ?? '').trim()
      if (pw.length < PASSWORD_MIN) throw new Error(`The new password needs at least ${PASSWORD_MIN} characters`)
      await update(u, { password: pw }, me)
      setChemPass((x) => ({ ...x, [u.id!]: '' }))
      return `${chemCode(b.number)}: new password saved for ${u.username}`
    })

  const th: React.CSSProperties = { background: '#e9e9e9', fontSize: 11, textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #bbb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { fontSize: 11, padding: '3px 6px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: 12, maxWidth: 980 }}>
      <div className="ma-title" style={{ marginBottom: 10 }}>
        My Profile
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <Box title="My Details">
          <Row label="User Name">
            <b>{me.username}</b>
          </Row>
          <Row label="Role">{ROLE_LABEL[me.role] ?? me.role.toUpperCase()}</Row>
          <Row label="Works In">{me.branchId ? chemCode(branches.find((b) => b.id === me.branchId)?.number) : 'ALL CHEMISTS'}</Row>
          <Row label="Full Name">
            <Input value={name ?? me.name} onChange={setName} width={220} />
          </Row>
          <Row label="Email">
            <Input value={email ?? me.email ?? ''} onChange={setEmail} width={220} />
          </Row>
          <Row label="Mobile">
            <Input value={phone ?? me.phone ?? ''} onChange={setPhone} width={160} />
          </Row>
          <div style={{ textAlign: 'right' }}>
            <Btn onClick={() => void saveDetails()} disabled={busy || (name === undefined && email === undefined && phone === undefined)}>
              Save Details
            </Btn>
          </div>
        </Box>

        <Box title="Change My Password">
          <Row label="Current Password">
            <Input value={current} onChange={setCurrent} width={180} type="password" />
          </Row>
          <Row label="New Password">
            <Input value={next} onChange={setNext} width={180} type="password" placeholder={`min ${PASSWORD_MIN} characters`} />
          </Row>
          <Row label="New Password Again">
            <Input value={again} onChange={setAgain} width={180} type="password" />
          </Row>
          <div style={{ textAlign: 'right' }}>
            <Btn onClick={() => void savePassword()} disabled={busy || !current || !next || !again}>
              Change Password
            </Btn>
          </div>
        </Box>
      </div>

      {isAdmin && (
        <Box title="Chemist Passwords">
          <p className="ma-label ma-note" style={{ margin: '0 0 8px', fontSize: 11 }}>
            Set a new sign-in password for any chemist&apos;s account. Accounts that share a user name (e.g. <b>subgeo</b>) are told apart by their password, so each
            chemist needs its own. The new password works on every computer after the next sync.
          </p>
          <div style={{ maxHeight: 460, overflow: 'auto', border: '1px solid #c3c3c3', background: '#fff' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Chemist</th>
                  <th style={th}>Name</th>
                  <th style={th}>User Name</th>
                  <th style={th}>Role</th>
                  <th style={th}>New Password</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {chemAccounts.map(({ u, b }) => (
                  <tr key={u.id} style={{ color: u.active && b.active ? undefined : '#999' }}>
                    <td style={{ ...td, fontWeight: 'bold' }}>{chemCode(b.number)}</td>
                    <td style={td}>
                      {b.name}
                      {b.active ? '' : ' (closed)'}
                    </td>
                    <td style={td}>
                      {u.username}
                      {u.active ? '' : ' (disabled)'}
                    </td>
                    <td style={td}>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td style={td}>
                      <Input value={chemPass[u.id!] ?? ''} onChange={(v) => setChemPass((x) => ({ ...x, [u.id!]: v }))} width={140} type="password" placeholder="new password" />
                    </td>
                    <td style={td}>
                      <Btn onClick={() => void saveChemPassword(u, b)} disabled={busy || !(chemPass[u.id!] ?? '').trim()}>
                        Save
                      </Btn>
                    </td>
                  </tr>
                ))}
                {chemAccounts.length === 0 && (
                  <tr>
                    <td style={td} colSpan={6}>
                      No chemist accounts yet — add them in Utilities → User Management.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Box>
      )}
    </div>
  )
}
