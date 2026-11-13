import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useSession } from '../session'
import { APP_VERSION, BRAND_NAME } from './data'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Medapp login screen: grey page, top bar, then User Name / Pass / Log In
 * row, and the red SUBGEO CHEMIST LTD brand centred below the fields.
 *
 * Accounts are created by the admin in Utilities → User Management; each
 * cashier belongs to one chemist (SUBGEO number) and lands in that chemist.
 * Starter accounts: admin / subgeo22 (all chemists), subgeo / 0001 (SUBGEO1),
 * purchase (no password — the Purchases dashboard). */
export default function MedLogin() {
  const { login } = useSession()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Admin and purchase accounts: the browser must never save or fill in their
  // password. Their password box is not a password field to the browser (the
  // dots are drawn by CSS), so it offers neither. Cashiers keep autofill.
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const privileged = useMemo(
    () => new Set(['admin', 'purchase', ...users.filter((u) => u.role === 'owner' || u.role === 'purchase').map((u) => u.username.toLowerCase())]),
    [users],
  )
  const secret = privileged.has(name.trim().toLowerCase())
  // A password the browser filled in for one of these accounts is wiped.
  useEffect(() => {
    if (secret) setPass('')
  }, [secret])

  const submit = async () => {
    if (busy || !name.trim() || !pass) return
    setBusy(true)
    setMsg(null)
    const r = await login(name, pass).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    setBusy(false)
    if (r.ok) {
      setName('')
      setPass('')
    } else {
      setMsg(r.error)
      setPass('')
    }
  }

  return (
    <div className="ma ma-login">
      <header className="ma-header">
        <img className="ma-logo" src="/logo.png" alt="SUBGEO" />
        <span className="ma-version">{APP_VERSION}</span>
        <div className="ma-welcome">
          <UsersIcon />
          <div>
            <div>Welcome</div>
            <div>-</div>
          </div>
        </div>
        <div className="ma-company">{BRAND_NAME}</div>
        <button type="button" className="ma-logout" title="Log Out" aria-label="Log Out" tabIndex={-1} disabled>
          <LogoutIcon />
        </button>
        <div className="ma-header-right">
          <button type="button" className="ma-notes" title="Notifications" tabIndex={-1} disabled>
            <NotepadIcon />
          </button>
          <div className="ma-emr">
            <EmrLiteLogo />
          </div>
        </div>
      </header>

      <div className="ma-login-card">
        <form className="ma-login-form" onSubmit={(e) => e.preventDefault()}>
          <div className="ma-row">
            <label className="ma-login-label" htmlFor="ma-login-name">
              User Name
            </label>
            <input
              id="ma-login-name"
              className="ma-input"
              style={{ width: 150 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('ma-login-pass')?.focus()}
              autoComplete="username"
              autoFocus
            />
            <label className="ma-login-label" htmlFor="ma-login-pass">
              Pass
            </label>
            {secret ? (
              <input
                key="secret"
                id="ma-login-pass"
                className="ma-input"
                style={{ width: 150, WebkitTextSecurity: 'disc' } as React.CSSProperties}
                type="text"
                name="ma-admin-code"
                value={pass}
                onChange={(e) => setPass(e.target.value.slice(0, 64))}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
              />
            ) : (
              <input
                key="pass"
                id="ma-login-pass"
                className="ma-input"
                style={{ width: 150 }}
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value.slice(0, 64))}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                autoComplete="current-password"
              />
            )}
            <button type="button" className="ma-btn ma-login-btn" onClick={() => void submit()} disabled={busy || !name.trim() || !pass}>
              {busy ? 'Signing in…' : 'Log In'}
            </button>
          </div>
        </form>
        {msg && (
          <div className="ma-login-msg" role="alert">
            {msg}
          </div>
        )}
        <div className="ma-login-brand">{BRAND_NAME}</div>
      </div>
    </div>
  )
}
