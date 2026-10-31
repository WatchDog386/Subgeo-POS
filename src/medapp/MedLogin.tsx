import { useState } from 'react'
import { useSession } from '../session'
import { APP_VERSION, DEFAULTS } from './data'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Medapp login screen: grey page, top bar, then User Name / Pass / Log In
 * row, and the red SUBGEO CHEMIST LTD brand centred below the fields.
 *
 * Accounts are created by the admin in Utilities → User Management; each
 * cashier belongs to one chemist (CHEM number) and lands in that chemist.
 * Starter accounts: admin / subgeo22 (all chemists), subgeo / 0000 (CHEM1),
 * purchase (no password — the Purchases dashboard). */
export default function MedLogin() {
  const { login } = useSession()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // The purchases dashboard signs in with no password.
  const passwordless = name.trim().toLowerCase() === 'purchase'

  const submit = async () => {
    if (busy || !name.trim() || (!pass && !passwordless)) return
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
        <div className="ma-company">{DEFAULTS.companyName}</div>
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
            <input
              id="ma-login-pass"
              className="ma-input"
              style={{ width: 150 }}
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value.slice(0, 64))}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              autoComplete="current-password"
              placeholder={passwordless ? '(none)' : undefined}
            />
            <button type="button" className="ma-btn ma-login-btn" onClick={() => void submit()} disabled={busy || !name.trim() || (!pass && !passwordless)}>
              {busy ? 'Signing in…' : 'Log In'}
            </button>
          </div>
        </form>
        {msg && (
          <div className="ma-login-msg" role="alert">
            {msg}
          </div>
        )}
        <div className="ma-login-brand">SUBGEO CHEMIST LTD</div>
      </div>
    </div>
  )
}
