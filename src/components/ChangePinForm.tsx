import { useState } from 'react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import { hashPassword, newSalt } from '../lib/sha256'
import { PASSWORD_MIN, useSession } from '../session'
import { errorText, useToast } from './ui'

/** Three-field "change my password" form, shared by Settings → Security and the Profile page. */
export default function ChangePinForm() {
  const { user } = useSession()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const change = async () => {
    try {
      if (!user) throw new Error('No signed-in user')
      if (hashPassword(user.salt, current) !== user.passHash) throw new Error('Current password is wrong')
      if (next.length < PASSWORD_MIN) throw new Error(`New password must be at least ${PASSWORD_MIN} characters`)
      if (next === current) throw new Error('Pick a password you are not using right now')
      if (next !== confirmPin) throw new Error('New password and confirmation do not match')
      const salt = newSalt()
      await db.users.update(user.id!, { salt, passHash: hashPassword(salt, next) })
      await logActivity('user', `Password changed for ${user.name}`, { userId: user.id, userName: user.name })
      toast('Password changed')
      setCurrent('')
      setNext('')
      setConfirmPin('')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (!user) return null

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Current password</label>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label">{`New password (min ${PASSWORD_MIN})`}</label>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="label">Repeat new password</label>
          <input className="input" type="password" autoComplete="new-password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={change} disabled={!current || !next || !confirmPin}>
          Change password
        </button>
      </div>
    </>
  )
}
