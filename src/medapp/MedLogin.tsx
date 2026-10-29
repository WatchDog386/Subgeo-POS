import { useState } from 'react'
import { PIN_LENGTH, useSession } from '../session'
import { APP_VERSION, DEFAULTS } from './data'
import { EmrLiteLogo, LogoutIcon, NotepadIcon, UsersIcon } from './icons'

/** Old medapp login screen: header form (User Name / Pass / Log In) and the
 * red Rockwell brand text on grey. Authenticates with the 4-digit PIN (the
 * User Name field is informational only, matching the legacy behaviour). */
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
    else setName('')
    setPass('')
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
        <div className="ma-company">
          <b>
            {DEFAULTS.companyName} - {DEFAULTS.branchCode}
          </b>
          <small>
            ( {DEFAULTS.licenceFrom} TO {DEFAULTS.licenceTo} )
          </small>
        </div>
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

      <form className="ma-login-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="ma-login-name">User Name</label>
        <input id="ma-login-name" className="ma-input" style={{ width: 115, height: 24 }} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
        <label htmlFor="ma-login-pass">Pass</label>
        <input
          id="ma-login-pass"
          className="ma-input"
          type="password"
          style={{ width: 103, height: 24 }}
          value={pass}
          maxLength={PIN_LENGTH}
          onChange={(e) => setPass(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          autoComplete="off"
        />
        <button type="button" className="ma-btn" onClick={() => void submit()} disabled={busy}>
          Log In
        </button>
      </form>

      {msg && (
        <div className="ma-login-msg" role="alert">
          {msg}
        </div>
      )}

      <div className="ma-login-brand">SUBGEO CHEMIST LTD</div>
    </div>
  )
}
