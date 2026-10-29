import { useState } from 'react'
import { PIN_LENGTH, useSession } from '../session'
import { APP_VERSION, DEFAULTS } from './data'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Medapp login screen: top bar (company centred, no branch), then the red
 * SUBGEO CHEMIST LTD brand centred on the page with the User Name / Pass /
 * Log In row beneath it.
 *
 * Cashier sign-in (every chemist): User Name = "subgeo", Pass = "0000".
 * Owner sign-in: Pass = "1234". */
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
    if (name.trim().toLowerCase() === 'subgeo' && pass === '0000') {
      ok = await login('0000') // cashier PIN
      if (!ok) setMsg('Cashier account not found')
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
        <div className="ma-company ma-company-center">{DEFAULTS.companyName}</div>
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
        <div className="ma-login-brand">SUBGEO CHEMIST LTD</div>
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
              maxLength={PIN_LENGTH}
              onChange={(e) => setPass(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              autoComplete="off"
            />
            <button type="button" className="ma-btn ma-login-btn" onClick={() => void submit()} disabled={busy || pass.length !== PIN_LENGTH}>
              Log In
            </button>
          </div>
        </form>
        {msg && (
          <div className="ma-login-msg" role="alert">
            {msg}
          </div>
        )}
      </div>
    </div>
  )
}
