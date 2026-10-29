import { useState } from 'react'
import { useSession } from '../session'
import { APP_VERSION, DEFAULTS } from './data'
import { db } from '../db/db'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Medapp login screen: grey page, top bar, then User Name / Pass / Log In
 * row, and the red SUBGEO CHEMIST LTD brand centred below the fields.
 *
 * Cashier (every chemist): User Name "subgeo", Pass "0000".
 * Admin: User Name "admin", Pass "subgeo22".
 * Owner: Pass "1234". */
export default function MedLogin() {
  const { login } = useSession()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async () => {
    if (busy || !pass.trim()) return
    setBusy(true)
    setMsg(null)
    let ok = false
    const userName = name.trim().toLowerCase()
    if (userName === 'subgeo' && pass === '0000') {
      ok = await login('0000') // cashier PIN
      if (!ok) setMsg('Cashier account not found')
    } else if (userName === 'admin' && pass === 'subgeo22') {
      try {
        const existing = await db.users.where('pin').equals('subgeo22').filter((u) => u.name.toUpperCase() === 'ADMIN').first()
        if (!existing) {
          await db.users.add({ name: 'ADMIN', pin: 'subgeo22', role: 'owner', active: true })
        }
      } catch {}
      ok = await login('subgeo22')
      if (!ok) setMsg('Admin account not found')
    } else if (pass === '1234') {
      ok = await login('1234') // owner PIN
      if (!ok) setMsg('Owner account not found')
    } else {
      setMsg('Invalid user name or password')
    }
    setBusy(false)
    if (ok) {
      setName('')
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
              autoComplete="off"
              autoFocus
            />
            <label className="ma-login-label" htmlFor="ma-login-pass">
              Pass
            </label>
            <input
              id="ma-login-pass"
              className="ma-input"
              type="password"
              style={{ width: 150 }}
              value={pass}
              onChange={(e) => setPass(e.target.value.slice(0, 32))}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              autoComplete="off"
            />
            <button type="button" className="ma-btn ma-login-btn" onClick={() => void submit()} disabled={busy || pass.length === 0}>
              Log In
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
