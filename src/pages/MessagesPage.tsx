import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Inbox, Pencil, Search, Send, Trash2 } from 'lucide-react'
import { Badge, Empty, Modal, PageHeader, Segmented, useToast, errorText } from '../components/ui'
import { db } from '../db/db'
import { chemCode } from '../db/seedData'
import type { StaffMessage } from '../db/types'
import { useSession } from '../session'

// Internal messages between staff of every chemist. Stored in the synced
// `messages` table, so a message sent at one till shows at every till.

function timeAgo(at: number) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

export default function MessagesPage() {
  const toast = useToast()
  const { user } = useSession()
  const me = user?.id ?? -1
  const all = useLiveQuery(() => db.messages.orderBy('at').reverse().toArray(), [], [] as StaffMessage[])
  const staff = useLiveQuery(() => db.users.filter((u) => u.active).toArray(), [], [])
  const branches = useLiveQuery(() => db.branches.toArray(), [], [])
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [compose, setCompose] = useState(false)
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' })

  const inbox = all.filter((m) => m.fromId !== me && (m.toId === undefined || m.toId === me))
  const sent = all.filter((m) => m.fromId === me)
  const unread = inbox.filter((m) => !m.readBy.includes(me)).length
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (folder === 'inbox' ? inbox : sent).filter(
      (m) => !q || [m.fromName, m.toName, m.subject, m.body].some((v) => v.toLowerCase().includes(q)),
    )
  }, [all, folder, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = visible.find((m) => m.id === selected) ?? visible[0]

  const select = (id: number) => {
    setSelected(id)
    const m = all.find((x) => x.id === id)
    if (m && m.fromId !== me && !m.readBy.includes(me)) void db.messages.update(id, { readBy: [...m.readBy, me] })
  }
  const label = (u: { name: string; branchId?: number }) => {
    const b = branches.find((x) => x.id === u.branchId)
    return `${u.name}${b ? ` (${chemCode(b.number)})` : ' (ADMIN)'}`
  }

  const send = async () => {
    try {
      if (!user?.id) throw new Error('Sign in first.')
      if (!draft.to) throw new Error('Choose who the message is for.')
      if (!draft.subject.trim()) throw new Error('Type a subject, e.g. "Stock count on Friday".')
      if (!draft.body.trim()) throw new Error('Type the message.')
      const to = draft.to === 'ALL' ? undefined : staff.find((u) => String(u.id) === draft.to)
      await db.messages.add({
        fromId: user.id,
        fromName: user.name,
        toId: to?.id,
        toName: to ? label(to) : 'EVERYONE',
        subject: draft.subject.trim(),
        body: draft.body.trim(),
        at: Date.now(),
        readBy: [],
      } as StaffMessage)
      setDraft({ to: '', subject: '', body: '' })
      setCompose(false)
      setFolder('sent')
      toast('Message sent', 'ok')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const remove = async (m: StaffMessage) => {
    if (!confirm('Delete this message for everyone?')) return
    await db.messages.delete(m.id!)
    setSelected(null)
    toast('Message deleted')
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Messages"
        subtitle="Messages between staff of every chemist — they reach the other tills on the next sync"
        actions={
          <button className="btn-primary" onClick={() => setCompose(true)}>
            <Pencil size={16} /> Compose
          </button>
        }
      />

      <div className="flex h-[min(70vh,640px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* List pane — full screen on phones until a message is opened */}
        <div
          className={`min-w-0 flex-col border-r border-slate-200 lg:w-[340px] lg:shrink-0 lg:flex ${
            selected === null ? 'flex w-full' : 'hidden'
          }`}
        >
          <div className="space-y-2.5 border-b border-slate-200 p-3">
            <Segmented
              options={{
                inbox: `Inbox (${inbox.length}${unread ? `, ${unread} new` : ''})`,
                sent: `Sent (${sent.length})`,
              }}
              value={folder}
              onChange={(v) => {
                setFolder(v)
                setSelected(null)
              }}
            />
            <div className="relative">
              <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input
                className="input !py-2 !pl-9 text-sm"
                placeholder="Search messages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <Empty>{folder === 'inbox' ? 'No messages for you yet. Messages other staff send you, or to everyone, appear here.' : 'Nothing sent yet. Press Compose to write to a colleague or to every chemist.'}</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((m) => {
                  const activeId = open?.id
                  const isActive = m.id === activeId
                  const sender = folder === 'inbox' ? m.fromName : m.toName
                  const isNew = folder === 'inbox' && !m.readBy.includes(me)
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => select(m.id!)}
                        className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                          isActive ? 'border-l-[3px] border-brand-500 bg-brand-500/5 pl-[13px]' : 'border-l-[3px] border-transparent pl-[13px]'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm ${isNew ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{sender}</span>
                          <span className="shrink-0 text-xs text-slate-400">{timeAgo(m.at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-slate-600">{m.subject}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">
                          {m.body.split('\n')[0]}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Reading pane */}
        <div className={`min-w-0 flex-1 flex-col lg:flex ${selected === null ? 'hidden lg:flex' : 'flex'}`}>
          {!open ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <Inbox size={16} /> Select a message to read
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
                  onClick={() => setSelected(null)}
                  aria-label="Back to list"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold text-slate-900">{open.subject}</h2>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    From {open.fromName} · To {open.toName}
                  </p>
                </div>
                <Badge tone={open.fromId === me ? 'slate' : 'blue'}>{open.fromId === me ? 'Sent' : 'Inbox'}</Badge>
                {open.fromId === me && (
                  <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="Delete" onClick={() => void remove(open)}>
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {open.body.split(/\n+/).map((p, i) => (
                  <p key={i} className="max-w-2xl text-[15px] leading-relaxed text-slate-700">
                    {p}
                  </p>
                ))}
                <p className="pt-2 text-xs text-slate-400">
                  {new Date(open.at).toLocaleString('en-KE', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {compose && (
        <Modal
          title="Compose message"
          onClose={() => setCompose(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setCompose(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void send()}>
                <Send size={16} /> Send
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="msg-to">
                To
              </label>
              <select id="msg-to" className="input" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}>
                <option value="">Choose a member of staff…</option>
                <option value="ALL">EVERYONE (all chemists)</option>
                {staff
                  .filter((u) => u.id !== me)
                  .map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {label(u)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="msg-subject">
                Subject
              </label>
              <input
                id="msg-subject"
                className="input"
                placeholder="What it is about, e.g. Stock count on Friday"
                value={draft.subject}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="msg-body">
                Message
              </label>
              <textarea
                id="msg-body"
                className="input min-h-36 resize-y"
                placeholder="Write the message. New lines start new paragraphs."
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-400">The message reaches the other tills on their next sync (within a few seconds when they are online).</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
