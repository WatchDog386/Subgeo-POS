import { useNavigate } from 'react-router-dom'
import { syncNow, useSyncState } from '../db/sync'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (ts: number) => `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}`

/** Header indicator of the link to the company database. Click: sync now. */
export default function SyncBadge() {
  const s = useSyncState()
  const nav = useNavigate()
  const label =
    s.status === 'syncing'
      ? 'Syncing…'
      : s.status === 'idle'
        ? `Online${s.lastSyncAt ? ` · ${hhmm(s.lastSyncAt)}` : ''}`
        : s.status === 'offline'
          ? 'Offline'
          : s.status === 'error'
            ? 'Sync error'
            : 'Not connected'
  const tone = s.status === 'idle' || s.status === 'syncing' ? 'ok' : s.status === 'offline' ? 'warn' : 'bad'
  const title = [
    s.status === 'off' ? 'Signed in without the server (offline). Sales are kept on this till and upload after the next online sign-in.' : '',
    s.error ?? '',
    s.pending ? `${s.pending} change(s) waiting to upload` : 'Everything uploaded',
    'Click to sync now · double-click for details',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <button
      type="button"
      className={`ma-sync is-${tone}`}
      title={title}
      onClick={() => void syncNow()}
      onDoubleClick={() => nav('/utilities/sync')}
    >
      <span className="dot" />
      {label}
      {s.pending > 0 && <span className="n">{s.pending}</span>}
    </button>
  )
}
