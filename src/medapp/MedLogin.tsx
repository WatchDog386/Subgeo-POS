import { useState } from 'react'
import { PIN_LENGTH, useSession } from '../session'
import { APP_VERSION, DEFAULTS } from './data'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Old medapp login screen: header chrome at top, then the User Name / Pass /
 * Log In block arranged horizontally right below the bar. Authenticates via
 * the seeded 4-digit PIN (1234 owner / 0000 cashier). The company name is
 * centred in the top bar without the branch suffix. */
export default function MedLogin() {
  const { login } = useSession()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setMsg(null)
    const ok = await login(pass)
    setBusy(false)
    if (!ok) setMsg('Invalid pin. Enter your 4 digit password.')
    else {
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

      <div className="ma-login-bar">
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
            <button type="button" className="ma-btn ma-login-btn" onClick={() => void submit()} disabled={busy}>
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
