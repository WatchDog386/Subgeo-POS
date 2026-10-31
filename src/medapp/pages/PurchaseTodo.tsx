// Purchases dashboard — Home → To-Do List (screenshots 31 Oct 2026):
// three sub-tabs, "To-Do List", "Task To-Do" and "Pending-Completed".
// The rows are the purchasing work of the open chemist: tasks assigned to the
// PURCHASE login, indents still waiting for an LPO, LPOs still waiting for a
// GRN, open purchase orders and medicines at or below their re-order level.
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { syncNow } from '../../db/sync'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { ColumnChart, C as col } from './reportKit'
import { Btn, Check, DateField, Grid, IBtn, Input, Radio, Rows, SearchBar, Select, matches, type Col } from '../ui'
import { ToolGlyph, ZoomInIcon } from '../icons'
import { dmy, parseDmy, useDocs, type DocRecord } from '../data'
import { setTaskStatus, useTasks } from '../tasks'

type Item = {
  id: string
  kind: string
  doc: string
  date?: number
  task: string
  assigner: string
  assignee: string
  status: string
  done: boolean
  /** Where the work is finished (module screen). */
  to?: string
  taskId?: number
}

const COLS: Col[] = [
  col('transaction', 'Transaction', 80),
  col('doc', 'Doc', 40),
  col('docDate', 'Doc Date', 110),
  col('task', 'Task', 100),
  col('assigner', 'Assigner', 100),
  col('assignee', 'Assignee', 100),
  col('status', 'Status', 80),
]
const TODO_COLS: Col[] = [
  col('transaction', 'Transaction', 80),
  col('doc', 'Doc', 40),
  col('docDate', 'Doc Date', 110),
  col('task', 'Task', 100),
  col('assigner', 'Assigner', 100),
  col('assignee', 'Assignee', 100),
  col('status', 'Status', 240),
]

const toRow = (r: Item) => ({
  id: r.id,
  cells: { transaction: r.kind, doc: r.doc, docDate: r.date ? dmy(r.date) : '', task: r.task, assigner: r.assigner, assignee: r.assignee, status: r.status } as Record<string, ReactNode>,
})
const docDate = (d: DocRecord, key: string) => parseDmy(d.values[key] ?? '') ?? d.createdAt

/** Every purchasing item of the open chemist, pending and completed. */
function usePurchaseItems(team: boolean): Item[] {
  const { user, branchCode } = useSession()
  const me = user?.name.toUpperCase() ?? 'PURCHASE'
  const tasks = useTasks()
  const indents = useDocs('purchase-indent')
  const lpos = useDocs('local-purchase-order')
  const grns = useDocs('pur-inv-grn')
  const local = useLiveQuery(async () => {
    const [low, pos, suppliers] = await Promise.all([
      db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).toArray(),
      db.purchaseOrders.filter((p) => p.status !== 'cancelled').toArray(),
      db.suppliers.toArray(),
    ])
    return { low, pos, suppliers: new Map(suppliers.map((s) => [s.id, s.name])) }
  }, [])

  const items: Item[] = []
  for (const t of tasks) {
    if (!team && t.assigneeId !== undefined && t.assigneeId !== user?.id) continue
    const done = t.status === 'COMPLETED'
    items.push({
      id: `t${t.id}`,
      kind: 'TASK',
      doc: t.doc ?? '',
      date: t.createdAt,
      task: t.text,
      assigner: t.assigner,
      assignee: t.assignee,
      status: done ? `DONE ${t.completedAt ? dmy(t.completedAt) : ''}`.trim() : t.due && t.due < Date.now() ? 'OVERDUE' : 'PENDING',
      done,
      taskId: t.id,
    })
  }
  for (const d of indents) {
    const no = d.values.docNo ?? ''
    const lpo = lpos.find((l) => no && l.values.indentNo === no)
    items.push({
      id: `pi${d.id}`,
      kind: 'PURCHASE INDENT',
      doc: no,
      date: docDate(d, 'indentDate'),
      task: `Raise LPO${d.values.purpose ? ` — ${d.values.purpose}` : ''}`,
      assigner: (d.values.indentor || 'SYSTEM').toUpperCase(),
      assignee: me,
      status: lpo ? `LPO ${lpo.values.docNo ?? ''}`.trim() : 'RAISE LPO',
      done: !!lpo,
      to: '/modules/local-purchase-order',
    })
  }
  for (const d of lpos) {
    const no = d.values.docNo ?? ''
    const grn = grns.find((g) => no && g.values.lpoNo === no)
    items.push({
      id: `lpo${d.id}`,
      kind: 'LPO',
      doc: no,
      date: docDate(d, 'poDate'),
      task: `Receive goods${d.values.vendorName ? ` from ${d.values.vendorName}` : ''}`,
      assigner: 'SYSTEM',
      assignee: me,
      status: grn ? `GRN ${grn.values.docNo ?? ''}`.trim() : 'RECEIVE (GRN)',
      done: !!grn,
      to: '/modules/pur-inv-grn',
    })
  }
  for (const p of local?.pos ?? []) {
    const done = p.status === 'received'
    const supplier = p.supplierId !== undefined ? local?.suppliers.get(p.supplierId) : undefined
    items.push({
      id: `po${p.id}`,
      kind: 'PURCHASE ORDER',
      doc: p.poNo,
      date: p.createdAt,
      task: `${p.lines.length} line(s)${supplier ? ` from ${supplier}` : ''} to ${p.status === 'draft' ? 'order' : 'receive'}`,
      assigner: 'SYSTEM',
      assignee: me,
      status: p.status.toUpperCase(),
      done,
      to: '/purchasing',
    })
  }
  for (const p of local?.low ?? []) {
    items.push({
      id: `ro${p.id}`,
      kind: 'RE-ORDER',
      doc: p.sku,
      date: p.updatedAt,
      task: `${p.name} — ${p.stock} left (re-order at ${p.reorderLevel})`,
      assigner: 'SYSTEM',
      assignee: branchCode || me,
      status: p.stock <= 0 ? 'OUT OF STOCK' : 'LOW STOCK',
      done: false,
      to: '/modules/purchase-indent',
    })
  }
  return items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
}

/* ── Section with its three sub-tabs ───────────────────────────────────── */
type Sub = 'todo' | 'task' | 'pending'
const SUBS: { id: Sub; label: string }[] = [
  { id: 'todo', label: 'To-Do List' },
  { id: 'task', label: 'Task To-Do' },
  { id: 'pending', label: 'Pending-Completed' },
]

export default function PurchaseTodo() {
  const [sub, setSub] = useState<Sub>('todo')
  const [picked, setPicked] = useState<string>()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="ma-subtabs" style={{ paddingLeft: 0 }}>
        {SUBS.map((s) => (
          <span
            key={s.id}
            className={`ma-subtab is-white${sub === s.id ? ' is-active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sub === 'todo' && (
          <TodoList
            onPick={(id) => {
              setPicked(id)
              setSub('task')
            }}
          />
        )}
        {sub === 'task' && <TaskToDo initial={picked} onBack={() => setSub('todo')} onSaved={() => setSub('pending')} />}
        {sub === 'pending' && <PendingCompleted />}
      </div>
    </div>
  )
}

/* ── To-Do List ────────────────────────────────────────────────────────── */
function TodoList({ onPick }: { onPick: (id: string) => void }) {
  const [team, setTeam] = useState(false)
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const all = usePurchaseItems(team).filter((r) => !r.done)
  const rows = all.filter((r) => (!kind || r.kind === kind) && matches(q, r.kind, r.doc, r.task, r.assigner, r.assignee, r.status))
  return (
    <div style={{ display: 'flex', padding: '28px 0 12px 18px', gap: 22 }}>
      <div style={{ width: 773, flex: '0 0 auto' }}>
        <Select
          value={kind}
          onChange={setKind}
          options={[{ value: '', label: '' }, ...[...new Set(all.map((r) => r.kind))].map((k) => ({ value: k, label: k }))]}
          width={160}
          round
        />
        <div style={{ margin: '7px 0 0 0' }}>
          <Check checked={team} onChange={setTeam}>
            <span style={{ color: '#3b5323' }}>Show Team Tasks</span>
          </Check>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, marginLeft: 4 }}>
          <SearchBar value={q} onChange={setQ} width={341} />
          <span style={{ marginLeft: 'auto', marginRight: 28 }}>
            <Rows n={rows.length} />
          </span>
        </div>
        <Grid cols={TODO_COLS} rows={rows.map(toRow)} height={266} style={{ marginTop: 3, marginLeft: 4 }} onSelect={(id) => onPick(String(id))} />
        <div className="ma-label" style={{ marginTop: 6, marginLeft: 4 }}>
          Click a row to work on it under Task To-Do.
        </div>
      </div>
      <PurchaseChart />
    </div>
  )
}

const SERIES = [
  { label: 'Indents', color: '#e07a12' },
  { label: 'LPOs', color: '#9fbe4a' },
  { label: 'GRNs', color: '#1a9be6' },
  { label: 'Tasks done', color: '#c9c39a' },
]

/** Purchasing documents raised per day in the chosen period. */
function PurchaseChart() {
  const toast = useToast()
  const now = new Date()
  const [type, setType] = useState('Column Chart')
  const [zoom, setZoom] = useState(1)
  const [from, setFrom] = useState(dmy(new Date(now.getFullYear(), now.getMonth(), 1), '/'))
  const [to, setTo] = useState(dmy(new Date(now.getFullYear(), now.getMonth() + 1, 0), '/'))
  const [range, setRange] = useState({ from, to })
  const indents = useDocs('purchase-indent')
  const lpos = useDocs('local-purchase-order')
  const grns = useDocs('pur-inv-grn')
  const tasks = useTasks()
  const f = parseDmy(range.from)
  const t = parseDmy(range.to)
  const data =
    f === undefined || t === undefined
      ? []
      : Array.from({ length: Math.min(62, Math.round((t - f) / 86_400_000) + 1) }, (_, i) => {
          const d0 = new Date(f).setDate(new Date(f).getDate() + i)
          const d1 = new Date(f).setDate(new Date(f).getDate() + i + 1)
          const n = (list: number[]) => list.filter((x) => x >= d0 && x < d1).length
          return {
            label: dmy(d0).slice(0, 5),
            values: [
              n(indents.map((d) => docDate(d, 'indentDate'))),
              n(lpos.map((d) => docDate(d, 'poDate'))),
              n(grns.map((d) => docDate(d, 'supInvDate'))),
              n(tasks.filter((x) => x.completedAt).map((x) => x.completedAt!)),
            ],
          }
        })
  const view = () => {
    const a = parseDmy(from)
    const b = parseDmy(to)
    if (a === undefined || b === undefined) return toast('Dates must be dd/mm/yyyy', 'error')
    if (b < a) return toast('To date is before From date', 'error')
    setRange({ from, to })
  }
  return (
    <div style={{ flex: 1, minWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -2 }}>
        <span className="ma-label" style={{ fontSize: 12, width: 40 }}>
          Chart
        </span>
        <Select value={type} onChange={setType} options={['Column Chart', 'Line Chart']} width={146} round />
        <IBtn title="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.25))}>
          <ZoomInIcon />
        </IBtn>
        <IBtn title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          <ZoomInIcon minus />
        </IBtn>
        <IBtn title="Print" onClick={() => window.print()}>
          <ToolGlyph k="print" />
        </IBtn>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span className="ma-label" style={{ fontSize: 12, width: 40 }}>
          From
        </span>
        <DateField value={from} onChange={setFrom} />
        <span className="ma-label" style={{ fontSize: 12, margin: '0 6px 0 12px' }}>
          To
        </span>
        <DateField value={to} onChange={setTo} />
        <Btn onClick={view}>View</Btn>
      </div>
      <div style={{ marginTop: 14, border: '1px solid #d6d6d6', background: '#fff', height: 276, overflow: 'auto', maxWidth: 380, padding: '6px 4px' }}>
        {SERIES.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, fontSize: 11, color: '#444' }}>
            <span style={{ width: 11, height: 13, background: s.color, display: 'inline-block' }} />
            {s.label}
          </div>
        ))}
        <ColumnChart data={data} width={Math.max(340, data.length * 26)} height={160} zoom={zoom} type={type} colors={SERIES.map((s) => s.color)} />
      </div>
    </div>
  )
}

/* ── Task To-Do ────────────────────────────────────────────────────────── */
const SHORTCUTS: { label: string; to: string; title: string }[] = [
  { label: 'Adv Pay', to: '/modules/petty-cash-voucher', title: 'Advance payment — Petty Cash Voucher' },
  { label: 'Adv Rec', to: '/reports/list/os-creditor', title: 'Advances received — OS Creditor' },
  { label: 'Fc Adj', to: '/reports/list/account-statement', title: 'Foreign currency / account adjustment — Account Statement' },
]

function TaskToDo({ initial, onBack, onSaved }: { initial?: string; onBack: () => void; onSaved: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const { user } = useSession()
  const pending = usePurchaseItems(true).filter((r) => !r.done)
  const [pick, setPick] = useState(initial ?? '')
  const [shown, setShown] = useState<string | undefined>(initial)
  const [note, setNote] = useState('')
  const [format, setFormat] = useState('SELECT')
  const [print, setPrint] = useState<'' | 'print' | 'draft'>('')
  const [jasper, setJasper] = useState(true)
  const [sms, setSms] = useState(false)
  const item = pending.find((r) => r.id === shown)

  const show = () => {
    if (!pick) return toast('Select a pending item first', 'error')
    setShown(pick)
  }
  const doPrint = () => window.print()
  const save = async () => {
    if (!item) return toast('Select a pending item and press Show', 'error')
    if (print === 'draft') doPrint()
    if (sms) {
      const body = encodeURIComponent(`${item.kind} ${item.doc}: ${item.task} — ${note.trim() || 'done'}`)
      window.open(`sms:?body=${body}`, '_blank')
    }
    if (item.taskId !== undefined) {
      await setTaskStatus(item.taskId, 'COMPLETED', user)
      if (print === 'print') doPrint()
      toast('Task completed')
      setShown(undefined)
      setPick('')
      setNote('')
      onSaved()
      return
    }
    // Documents are completed by raising the next one in the purchase flow.
    if (item.to) nav(item.to)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        void save()
      } else if (e.key === 'F3') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <div style={{ padding: '12px 0 12px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 30 }}>
        <span style={{ width: 110 }} />
        <IBtn title="View" onClick={show}>
          <EyeGlyph />
        </IBtn>
        <IBtn title="Refresh" onClick={() => void syncNow().then(() => toast('Refreshed'))}>
          <RefreshGlyph />
        </IBtn>
        <span style={{ width: 324 }} />
        <span style={{ display: 'flex', gap: 8 }}>
          <Btn title="Stock adjustment" onClick={() => nav('/inventory')}>
            Adjust
          </Btn>
          <Btn title="Price Comparison Statement" onClick={() => nav('/reports/price-comparison')}>
            Product Comp
          </Btn>
        </span>
      </div>
      <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 0 }}>
        <span style={{ width: 2, height: 22, borderLeft: '1px solid #bbb', borderRight: '1px solid #bbb' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Select
          value={pick}
          onChange={setPick}
          options={[{ value: '', label: '' }, ...pending.map((r) => ({ value: r.id, label: `${r.kind} ${r.doc}`.trim() }))]}
          width={128}
          round
        />
        <Btn onClick={show}>Show</Btn>
        <Btn onClick={onBack}>Back (F3)</Btn>
        <Btn onClick={() => void save()}>Save (F2)</Btn>
        {SHORTCUTS.map((s) => (
          <Btn key={s.label} title={s.title} onClick={() => nav(s.to)}>
            {s.label}
          </Btn>
        ))}
        <span style={{ marginLeft: 170, display: 'flex', gap: 14 }}>
          <Check checked={jasper} onChange={setJasper} dark>
            Jasper Print?
          </Check>
          <Check checked={sms} onChange={setSms} dark>
            Send Sms
          </Check>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
        <span style={{ width: 126 }} />
        <Btn title="Outstanding advances" onClick={() => nav('/reports/outstanding')}>
          Advances
        </Btn>
        <span style={{ width: 52 }} />
        <Select value={format} onChange={setFormat} options={['SELECT', 'TASK SHEET', 'PURCHASE LIST']} width={78} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Radio name="pt-print" checked={print === 'print'} onChange={() => setPrint(print === 'print' ? '' : 'print')}>
            Print ?
          </Radio>
          <Radio name="pt-print" checked={print === 'draft'} onChange={() => setPrint(print === 'draft' ? '' : 'draft')}>
            Draft Print ?
          </Radio>
        </div>
      </div>

      {item ? (
        <div style={{ margin: '22px 0 0 2px', maxWidth: 760 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '110px 560px' }}>
            <span className="ma-bold-label">Transaction</span>
            <b>{item.kind}</b>
            <span className="ma-bold-label">Doc</span>
            <span>{item.doc || '—'}</span>
            <span className="ma-bold-label">Doc Date</span>
            <span>{item.date ? dmy(item.date) : '—'}</span>
            <span className="ma-bold-label">Task</span>
            <span>{item.task}</span>
            <span className="ma-bold-label">Assigner</span>
            <span>{item.assigner}</span>
            <span className="ma-bold-label">Assignee</span>
            <span>{item.assignee}</span>
            <span className="ma-bold-label">Status</span>
            <b style={{ color: item.status === 'OVERDUE' || item.status === 'OUT OF STOCK' ? '#c00' : '#2e7d32' }}>{item.status}</b>
            {item.taskId !== undefined && (
              <>
                <span className="ma-bold-label">Remarks</span>
                <Input value={note} onChange={setNote} width={420} placeholder="optional — sent with the SMS" />
              </>
            )}
          </div>
          <div className="ma-label ma-note" style={{ marginTop: 10 }}>
            {item.taskId !== undefined
              ? 'Save (F2) marks this task as completed and moves it to Pending-Completed.'
              : `Save (F2) opens ${item.to?.replace('/modules/', '').replace(/-/g, ' ').toUpperCase()} to complete this item.`}
          </div>
        </div>
      ) : (
        <div className="ma-label" style={{ margin: '22px 0 0 2px' }}>
          {pending.length ? `${pending.length} pending item(s). Pick one from the list and press Show.` : 'Nothing pending.'}
        </div>
      )}
    </div>
  )
}

/* ── Pending-Completed ─────────────────────────────────────────────────── */
function PendingCompleted() {
  const toast = useToast()
  const { user } = useSession()
  const all = usePurchaseItems(true)
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [sel, setSel] = useState<string>()
  const filter = (done: boolean, q: string) => all.filter((r) => r.done === done && matches(q, r.kind, r.doc, r.task, r.assigner, r.assignee, r.status))
  const selected = all.find((r) => r.id === sel)
  return (
    <div style={{ padding: '10px 4px 12px' }}>
      <div style={{ display: 'flex', gap: 14 }}>
        {[
          { title: 'PENDING', rows: filter(false, q1), q: q1, setQ: setQ1 },
          { title: 'COMPLETED', rows: filter(true, q2), q: q2, setQ: setQ2 },
        ].map((g) => (
          <div key={g.title} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', height: 27, marginBottom: 2, gap: 4 }}>
              <SearchBar value={g.q} onChange={g.setQ} width={254} />
              <IBtn title="Refresh" onClick={() => void syncNow()}>
                <RefreshGlyph small />
              </IBtn>
              <b style={{ fontSize: 11, marginLeft: 8 }}>{g.title}</b>
              <span style={{ marginLeft: 'auto', marginRight: 28 }}>
                <Rows n={g.rows.length} />
              </span>
            </div>
            <Grid cols={COLS} rows={g.rows.map(toRow)} height={540} selected={sel} onSelect={(id) => setSel(String(id))} />
          </div>
        ))}
      </div>
      {selected?.taskId !== undefined && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <span className="ma-label">Selected: {selected.task}</span>
          {selected.done ? (
            <Btn onClick={() => void setTaskStatus(selected.taskId!, 'PENDING', user).then(() => toast('Task reopened'))}>Reopen</Btn>
          ) : (
            <Btn onClick={() => void setTaskStatus(selected.taskId!, 'COMPLETED', user).then(() => toast('Task completed'))}>Mark Completed</Btn>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Glyphs ────────────────────────────────────────────────────────────── */
function EyeGlyph() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden>
      <path d="M1 8c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S4 13 1 8z" fill="#fff" stroke="#333" strokeWidth="1.6" />
      <circle cx="11" cy="8" r="4" fill="#333" />
      <circle cx="12.4" cy="6.6" r="1.2" fill="#fff" />
    </svg>
  )
}

function RefreshGlyph({ small }: { small?: boolean }) {
  const s = small ? 16 : 20
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
      <path d="M15.5 7A6.5 6.5 0 0 0 4 6" stroke={small ? '#1d6fc4' : '#888'} strokeWidth="2.4" fill="none" />
      <path d="M4.5 13A6.5 6.5 0 0 0 16 14" stroke={small ? '#1d6fc4' : '#888'} strokeWidth="2.4" fill="none" />
      <path d="M16.5 2.5v5h-5z" fill={small ? '#1d6fc4' : '#888'} />
      <path d="M3.5 17.5v-5h5z" fill={small ? '#1d6fc4' : '#888'} />
    </svg>
  )
}
