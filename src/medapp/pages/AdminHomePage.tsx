import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { api, syncNow } from '../../db/sync'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { ColumnChart, C as col } from './reportKit'
import { Grid, Rows, SearchBar, Select, Check, DateField, IBtn, Btn, Input, matches, type Col } from '../ui'
import { FunnelIcon, ToolGlyph, ZoomInIcon } from '../icons'
import { ADMIN_HOME_CHART_LINKS, ADMIN_HOME_REPORT_LINKS, ADMIN_TRANSACTIONS } from '../nav-admin'
import { transactionTo } from '../nav'
import { amt, dmy, parseDmy, useFavourites, useUserMap } from '../data'
import { addTask, deleteTask, setTaskStatus, tasksFor, useTasks, type StaffTask } from '../tasks'

/* ── Admin Home / Charts tab (screenshot 14.40.06 (12), 14.55.52 (4)-(11)) ─ */
type Section = 'todo' | 'quick' | 'stats' | 'favs' | 'reports' | 'charts' | 'utilities'
const ALL: { id: Section; label: string }[] = [
  { id: 'todo', label: 'To-Do List' },
  { id: 'quick', label: 'Quick Access' },
  { id: 'stats', label: 'Statistics' },
  { id: 'favs', label: 'Favourite Transactions' },
  { id: 'reports', label: 'Reports' },
  { id: 'charts', label: 'Charts' },
  { id: 'utilities', label: 'Utilities' },
]
const REPORT_LINK_TO: Record<string, string> = {
  'Account Statement': '/reports/list/account-statement',
  'OS Debtor': '/reports/list/os-debtor',
  'OS Creditor': '/reports/list/os-creditor',
  'All Debtor Ageing': '/reports/list/all-debtor-ageing',
  'All Creditor Ageing': '/reports/list/all-creditor-ageing',
  'Daily Sales Report': '/reports/list/daily-sales',
  'Cash Collection DEBTORS + OTC': '/reports/list/cash-collection',
  'MEDICINE LIST': '/reports/list/medicine-list',
  'Expiary Medicinies Report': '/reports/list/expiry-medicines',
  'OTC MEDICINE ISSUE': '/reports/list/otc-medicine-issue',
}

const TODO_COLS: Col[] = [
  col('transaction', 'Transaction', 120),
  col('doc', 'Doc', 110),
  col('docDate', 'Doc Date', 85),
  col('task', 'Task', 260),
  col('assigner', 'Assigner', 80),
  col('assignee', 'Assignee', 80),
  col('status', 'Status', 120),
]

type TodoRow = { id: string; cells: Record<string, ReactNode>; to?: string; branchId?: number; text: string; kind: string }

/** Home tab AND Charts tab land on the same screen. */
export default function AdminHomePage() {
  const [open, setOpen] = useState<Section>('todo')
  return (
    <div style={{ height: '100%', minWidth: 960, display: 'flex', flexDirection: 'column' }}>
      {ALL.map((s) => (
        <div key={s.id}>
          {open === s.id ? (
            <div className="ma-subtabs" style={{ paddingLeft: 4 }}>
              <span className="ma-subtab is-active">{s.label}</span>
            </div>
          ) : (
            <button type="button" className="ma-acc-head" style={{ textAlign: 'left' }} onClick={() => setOpen(s.id)}>
              {s.label}
            </button>
          )}
          {open === s.id && (
            <div style={{ flex: 1, minHeight: 420, overflow: 'auto' }}>
              <SectionBody id={s.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SectionBody({ id }: { id: Section }) {
  switch (id) {
    case 'todo':
      return <TodoSection />
    case 'quick':
      return <QuickAccess />
    case 'stats':
      return <Statistics />
    case 'favs':
      return <FavouriteTransactions />
    case 'reports':
      return <ReportLinks />
    case 'charts':
      return <ChartLinks />
    case 'utilities':
      return <UtilitiesSection />
  }
}

/* ── To-Do List section ────────────────────────────────────────────────── */
function TodoSection() {
  const [tab, setTab] = useState('todo')
  return (
    <div style={{ padding: '6px 14px 12px' }}>
      <div className="ma-subtabs" style={{ paddingLeft: 0 }}>
        <span className={`ma-subtab${tab === 'todo' ? ' is-active' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setTab('todo')}>
          To-Do List
        </span>
        <span className={`ma-subtab${tab === 'task' ? ' is-active' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setTab('task')}>
          Task To-Do
        </span>
        <span className={`ma-subtab${tab === 'pending' ? ' is-active' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setTab('pending')}>
          Pending-Completed
        </span>
      </div>
      {tab === 'todo' && <TodoList />}
      {tab === 'task' && <TaskToDo onBack={() => setTab('todo')} onSaved={() => setTab('pending')} />}
      {tab === 'pending' && <PendingCompleted />}
    </div>
  )
}

/** Work waiting in the open chemist (and, with "Show Team Tasks", in every chemist). */
function useTodoRows(team: boolean): TodoRow[] {
  const { branchCode, branchId } = useSession()
  const users = useUserMap()
  const tasks = useTasks()
  const local = useLiveQuery(async () => {
    const dayStart = new Date().setHours(0, 0, 0, 0)
    const [low, owing, jobs, pos, shifts, pending] = await Promise.all([
      db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).toArray(),
      db.customers.filter((c) => c.balance > 0).toArray(),
      db.jobs.filter((j) => j.status !== 'collected').toArray(),
      db.purchaseOrders.filter((p) => p.status === 'draft' || p.status === 'ordered' || p.status === 'partial').toArray(),
      db.shifts.filter((x) => !x.closedAt && x.openedAt < dayStart).toArray(),
      db.sales.where('_dirty').equals(1).count(),
    ])
    return { low, owing, jobs, pos, shifts, pending }
  }, [])
  const [team_, setTeam] = useState<{ code: string; id: number; name: string; lowStock: number; outOfStock: number; openShift: { by: string; at: number } | null }[]>([])
  useEffect(() => {
    if (!team) return
    let cancel = false
    api<{ branches: typeof team_ }>(`/admin/overview?dayStart=${new Date().setHours(0, 0, 0, 0)}`)
      .then((r) => !cancel && setTeam(r.branches))
      .catch(() => !cancel && setTeam([]))
    return () => {
      cancel = true
    }
  }, [team])

  const rows: TodoRow[] = []
  const add = (kind: string, id: string, doc: string, date: number | undefined, task: string, status: string, to: string, extra?: Partial<TodoRow> & { assigner?: string; assignee?: string }) =>
    rows.push({
      id,
      kind,
      to,
      text: `${kind} ${doc} ${task} ${status}`,
      branchId: extra?.branchId,
      cells: { transaction: kind, doc, docDate: date ? dmy(date) : '', task, assigner: extra?.assigner ?? 'SYSTEM', assignee: extra?.assignee ?? branchCode, status },
    })
  for (const t of tasksFor(tasks, null)) add('TASK', `t${t.id}`, t.doc ?? '', t.createdAt, t.text, t.due && t.due < Date.now() ? 'OVERDUE' : 'PENDING', '#tasks', { assigner: t.assigner, assignee: t.assignee })
  for (const s of local?.shifts ?? []) add('DAY SHIFT', `s${s.id}`, `${branchCode}`, s.openedAt, `Shift opened by ${users.get(s.userId)?.name ?? '?'} not closed`, 'CLOSE SHIFT', '/shift')
  for (const p of local?.pos ?? []) add('PURCHASE', `po${p.id}`, p.poNo, p.createdAt, `${p.lines.length} line(s) to ${p.status === 'draft' ? 'order' : 'receive'}`, p.status.toUpperCase(), '/purchasing')
  for (const p of local?.low ?? []) add('RE-ORDER', `p${p.id}`, p.sku, p.updatedAt, `${p.name} — ${p.stock} left (re-order at ${p.reorderLevel})`, p.stock <= 0 ? 'OUT OF STOCK' : 'LOW STOCK', '/reports/reorder')
  for (const c of local?.owing ?? []) add('DEBTOR', `c${c.id}`, c.phone ?? '', c.createdAt, `${c.name.toUpperCase()} owes ${amt(c.balance)}`, 'COLLECT', '/customers')
  for (const j of local?.jobs ?? []) add('SERVICE', `j${j.id}`, j.jobNo, j.createdAt, `${j.customerName} — ${j.complaint}`, j.status.replace('_', ' ').toUpperCase(), '/service')
  if (local?.pending) add('SYNC', 'sync', branchCode, Date.now(), `${local.pending} bill(s) not uploaded yet`, 'WAITING', '/utilities/sync')
  if (team) {
    for (const b of team_) {
      if (b.id === branchId) continue
      if (b.lowStock) add('RE-ORDER', `tb${b.id}l`, b.code, undefined, `${b.name}: ${b.lowStock} medicine(s) low, ${b.outOfStock} out of stock`, 'LOW STOCK', '/reports/reorder', { branchId: b.id, assignee: b.code })
      if (b.openShift && b.openShift.at < new Date().setHours(0, 0, 0, 0)) add('DAY SHIFT', `tb${b.id}s`, b.code, b.openShift.at, `${b.name}: shift by ${b.openShift.by} not closed`, 'CLOSE SHIFT', '/shift', { branchId: b.id, assignee: b.code })
    }
  }
  return rows
}

function TodoList() {
  const nav = useNavigate()
  const toast = useToast()
  const { switchBranch } = useSession()
  const [team, setTeam] = useState(false)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('ALL')
  const all = useTodoRows(team)
  const rows = all.filter((r) => (kind === 'ALL' || r.kind === kind) && matches(q, r.text))
  const open = async (id: string | number) => {
    const r = rows.find((x) => x.id === id)
    if (!r?.to) return
    if (r.to === '#tasks') return toast('Assigned task — mark it done under Pending-Completed')
    if (r.branchId) {
      const res = await switchBranch(r.branchId)
      if (res.warning) toast(res.warning, 'error')
    }
    nav(r.to)
  }
  return (
    <div style={{ display: 'flex', marginTop: 6 }}>
      <div style={{ width: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 30, gap: 8 }}>
          <Select value={kind} onChange={setKind} options={['ALL', ...new Set(all.map((r) => r.kind))]} width={150} plain />
          <span className="ma-label">Click a row to open it</span>
        </div>
        <div style={{ margin: '5px 0 0 22px' }}>
          <Check checked={team} onChange={setTeam}>
            <span style={{ color: '#2e7d32' }}>Show Team Tasks (all chemists)</span>
          </Check>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, marginLeft: 30 }}>
          <SearchBar value={q} onChange={setQ} width={365} />
          <span style={{ marginLeft: 'auto' }}>
            <Rows n={rows.length} />
          </span>
        </div>
        <div style={{ marginTop: 3 }}>
          <Grid cols={TODO_COLS} rows={rows} height={272} width={860} fillWidth={false} onSelect={(id) => void open(id)} />
        </div>
      </div>
      <SalesChart />
    </div>
  )
}

/** Daily takings of the open chemist between two dates. */
function SalesChart() {
  const [type, setType] = useState('Column Chart')
  const [zoom, setZoom] = useState(1)
  const [from, setFrom] = useState(dmy(Date.now() - 6 * 86_400_000, '/'))
  const [to, setTo] = useState(dmy(Date.now(), '/'))
  const [range, setRange] = useState({ from, to })
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const f = parseDmy(range.from)
    const t = parseDmy(range.to)
    if (f === undefined || t === undefined) return []
    const sales = await db.sales.where('createdAt').between(f, t + 86_400_000, true, false).toArray()
    const days = Math.min(62, Math.round((t - f) / 86_400_000) + 1)
    return Array.from({ length: days }, (_, i) => {
      const d0 = new Date(f).setDate(new Date(f).getDate() + i)
      const d1 = new Date(f).setDate(new Date(f).getDate() + i + 1)
      const v = sales.filter((s) => s.createdAt >= d0 && s.createdAt < d1 && s.status !== 'voided').reduce((x, s) => x + s.total, 0)
      return { label: dmy(d0).slice(0, 5), values: [v / 100] }
    })
  }, [range.from, range.to], [])
  const view = () => {
    const f = parseDmy(from)
    const t = parseDmy(to)
    if (f === undefined || t === undefined) return toast('Dates must be dd/mm/yyyy', 'error')
    if (t < f) return toast('To date is before From date', 'error')
    setRange({ from, to })
  }
  return (
    <div style={{ flex: 1, marginLeft: 30, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ma-bold-label">Chart</span>
        <Select value={type} onChange={setType} options={['Column Chart', 'Line Chart']} width={148} plain />
        <IBtn bare title="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.25))}>
          <ZoomInIcon />
        </IBtn>
        <IBtn bare title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          <ZoomInIcon minus />
        </IBtn>
        <IBtn bare title="Print" onClick={() => window.print()}>
          <ToolGlyph k="print" />
        </IBtn>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span className="ma-label">From</span>
        <DateField value={from} onChange={setFrom} />
        <span className="ma-label">To</span>
        <DateField value={to} onChange={setTo} />
        <Btn onClick={view}>View</Btn>
      </div>
      <div style={{ marginTop: 14, overflowX: 'auto', maxWidth: 420 }}>
        <ColumnChart data={data} width={300} height={240} zoom={zoom} type={type} />
        <div className="ma-label">Daily sales (KES), this chemist</div>
      </div>
    </div>
  )
}

/** Assign a task to someone at the open chemist. */
function TaskToDo({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const { user, branchCode } = useSession()
  const toast = useToast()
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const { branchId } = useSession()
  const staff = users.filter((u) => u.active && (u.role === 'owner' || u.branchId === branchId))
  const [text, setText] = useState('')
  const [doc, setDoc] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState(dmy(Date.now() + 86_400_000, '/'))
  const save = async () => {
    try {
      const a = staff.find((u) => String(u.id) === assignee)
      const d = due.trim() ? parseDmy(due) : undefined
      if (due.trim() && d === undefined) throw new Error('Due date must be dd/mm/yyyy')
      await addTask({ text, doc: doc.trim() || undefined, due: d === undefined ? undefined : d + 86_400_000 - 1, assignerId: user?.id, assigner: user?.name ?? '', assigneeId: a?.id, assignee: a?.name ?? `ALL ${branchCode}` })
      toast('Task saved')
      setText('')
      setDoc('')
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
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
    <div style={{ marginTop: 12, marginLeft: 32 }}>
      <div className="ma-form" style={{ gridTemplateColumns: '120px 420px' }}>
        <span className="ma-bold-label">Chemist</span>
        <b style={{ color: '#c00' }}>{branchCode}</b>
        <span className="ma-bold-label">Task</span>
        <Input value={text} onChange={setText} width={418} placeholder="e.g. Count the syrups shelf and post the stock-take" />
        <span className="ma-bold-label">Doc / Ref</span>
        <Input value={doc} onChange={setDoc} width={160} placeholder="optional" />
        <span className="ma-bold-label">Assign To</span>
        <Select value={assignee} onChange={setAssignee} options={[{ value: '', label: `EVERYONE AT ${branchCode}` }, ...staff.map((u) => ({ value: String(u.id), label: `${u.name} (${u.username})` }))]} width={260} />
        <span className="ma-bold-label">Due Date</span>
        <DateField value={due} onChange={setDue} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, marginLeft: 120 }}>
        <Btn onClick={onBack}>
          Back <span style={{ fontSize: 10, color: '#777' }}>(F3)</span>
        </Btn>
        <Btn onClick={() => void save()}>
          Save <span style={{ fontSize: 10, color: '#777' }}>(F2)</span>
        </Btn>
      </div>
      <div className="ma-label ma-note" style={{ marginTop: 10 }}>
        The task shows on the assignee's Home → To-Do List at {branchCode} until it is marked completed.
      </div>
    </div>
  )
}

const TASK_COLS: Col[] = [col('task', 'Task', 210), col('doc', 'Doc', 70), col('due', 'Due', 80), col('assigner', 'Assigner', 80), col('assignee', 'Assignee', 90), col('status', 'Status', 120)]

function PendingCompleted() {
  const tasks = useTasks()
  const { user } = useSession()
  const toast = useToast()
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [sel, setSel] = useState<number>()
  const row = (t: StaffTask) => ({
    id: t.id,
    cells: {
      task: t.text,
      doc: t.doc ?? '',
      due: t.due ? dmy(t.due) : '',
      assigner: t.assigner,
      assignee: t.assignee,
      status: t.status === 'COMPLETED' ? `DONE ${t.completedAt ? dmy(t.completedAt) : ''}` : t.due && t.due < Date.now() ? 'OVERDUE' : 'PENDING',
    },
  })
  const pending = tasks.filter((t) => t.status === 'PENDING' && matches(q1, t.text, t.doc, t.assignee))
  const done = tasks.filter((t) => t.status === 'COMPLETED' && matches(q2, t.text, t.doc, t.assignee))
  const selected = tasks.find((t) => t.id === sel)
  const act = async (fn: () => Promise<void>, msg: string) => {
    await fn()
    setSel(undefined)
    toast(msg)
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <span className="ma-label">{selected ? `Selected: ${selected.text}` : 'Select a task'}</span>
        <Btn disabled={selected?.status !== 'PENDING'} onClick={() => selected && void act(() => setTaskStatus(selected.id, 'COMPLETED', user), 'Task completed')}>
          Mark Completed
        </Btn>
        <Btn disabled={selected?.status !== 'COMPLETED'} onClick={() => selected && void act(() => setTaskStatus(selected.id, 'PENDING', user), 'Task reopened')}>
          Reopen
        </Btn>
        <Btn disabled={!selected} onClick={() => selected && confirm('Delete this task?') && void act(() => deleteTask(selected.id), 'Task deleted')}>
          Delete
        </Btn>
      </div>
      <div style={{ display: 'flex', gap: 30 }}>
        {[
          { title: 'Pending', list: pending, q: q1, setQ: setQ1 },
          { title: 'Completed', list: done, q: q2, setQ: setQ2 },
        ].map((g) => (
          <div key={g.title} style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', height: 27, marginBottom: 2, gap: 6 }}>
              <span className="ma-bold-label">{g.title}</span>
              <IBtn bare title="Sync now" onClick={() => void syncNow()}>
                <RotateGlyph />
              </IBtn>
              <SearchBar value={g.q} onChange={g.setQ} width={190} />
              <span style={{ marginLeft: 'auto' }}>
                <Rows n={g.list.length} />
              </span>
            </div>
            <Grid cols={TASK_COLS} rows={g.list.map(row)} height={272} fillWidth={false} selected={sel} onSelect={(id) => setSel(Number(id))} />
          </div>
        ))}
      </div>
    </div>
  )
}

function RotateGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M14 6a6 6 0 1 0 1 5" stroke="#3c4f60" strokeWidth="2.2" fill="none" />
      <path d="M15 1.5v5h-5" fill="#3c4f60" />
    </svg>
  )
}

/* ── Quick Access ──────────────────────────────────────────────────────── */
const QCOLS: Col[] = [
  col('module', 'Module', 168),
  col('transaction', 'Transaction', 205),
  col('role', 'Role', 100),
  col('description', 'Description', 500),
]

function QuickAccess() {
  const nav = useNavigate()
  const [role, setRole] = useState('SELECT')
  const [q, setQ] = useState('')
  const rows = ADMIN_TRANSACTIONS.filter((t) => role === 'SELECT' || t.role.toUpperCase() === role)
    .filter((t) => !q.trim() || [t.module, t.label, t.role, t.description].some((v) => v.toLowerCase().includes(q.trim().toLowerCase())))
    .map((t, i) => ({ id: i, cells: { module: t.module, transaction: t.label, role: t.role, description: t.description }, to: t.to }))
  return (
    <div style={{ padding: '14px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="ma-label" style={{ fontSize: 12 }}>
          Role
        </span>
        <Select value={role} onChange={setRole} options={['SELECT', 'ADMIN']} width={168} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 9 }}>
        <SearchBar value={q} onChange={setQ} width={560} />
        <span style={{ marginLeft: 'auto', marginRight: 28 }}>
          <Rows n={rows.length} />
        </span>
      </div>
      <Grid
        cols={QCOLS}
        rows={rows}
        height={275}
        style={{ marginTop: 3 }}
        onSelect={(id) => {
          const to = rows.find((r) => r.id === id)?.to
          if (to) nav(to)
        }}
      />
    </div>
  )
}

/* ── Statistics: every chemist at a glance ─────────────────────────────── */
type Overview = { id: number; code: string; name: string; active: boolean; todaySales: number; todayCount: number; monthSales: number; stockValue: number; lowStock: number; owing: number; openShift: { by: string } | null }

function Statistics() {
  const [rows, setRows] = useState<Overview[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [tick, setTick] = useState(0)
  const nav = useNavigate()
  useEffect(() => {
    let cancel = false
    const now = new Date()
    api<{ branches: Overview[] }>(`/admin/overview?dayStart=${new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()}&monthStart=${new Date(now.getFullYear(), now.getMonth(), 1).getTime()}`)
      .then((r) => {
        if (cancel) return
        setRows(r.branches)
        setErr(null)
      })
      .catch((e) => !cancel && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      cancel = true
    }
  }, [tick])
  const list = (rows ?? []).filter((r) => showClosed || r.active)
  const sum = (k: 'todaySales' | 'todayCount' | 'monthSales' | 'stockValue' | 'lowStock' | 'owing') => list.reduce((s, r) => s + r[k], 0)
  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IBtn lg title="Refresh" onClick={() => setTick((t) => t + 1)}>
          <RotateGlyph />
        </IBtn>
        <IBtn lg title={showClosed ? 'Hide closed chemists' : 'Show closed chemists'} onClick={() => setShowClosed((v) => !v)}>
          <FunnelIcon />
        </IBtn>
        <span className="ma-label">{err ? `Live figures unavailable (${err})` : 'All chemists, live from the company database'}</span>
        <Btn style={{ marginLeft: 'auto' }} onClick={() => nav('/utilities/chemists')}>
          Open Chemists Page
        </Btn>
      </div>
      <div className="ma-subtabs" style={{ marginTop: 8, paddingRight: 4 }}>
        <span className="ma-subtab is-active">Header</span>
      </div>
      <Grid
        cols={[col('code', 'Chemist', 70), col('name', 'Name', 170), col('today', "Today's Sales", 110, 'right'), col('bills', 'Bills', 60, 'right'), col('month', 'Month Sales', 120, 'right'), col('stock', 'Stock Value', 120, 'right'), col('low', 'Low Stock', 80, 'right'), col('owing', 'Debtors', 110, 'right'), col('shift', 'Shift', 130)]}
        rows={[
          ...list.map((r) => ({ id: r.id, cells: { code: r.code, name: r.name + (r.active ? '' : ' (CLOSED)'), today: amt(r.todaySales), bills: r.todayCount, month: amt(r.monthSales), stock: amt(r.stockValue), low: r.lowStock, owing: amt(r.owing), shift: r.openShift ? `Open · ${r.openShift.by}` : 'Closed' } })),
          { id: 'total', cells: { code: <b>TOTAL</b>, today: <b>{amt(sum('todaySales'))}</b>, bills: <b>{sum('todayCount')}</b>, month: <b>{amt(sum('monthSales'))}</b>, stock: <b>{amt(sum('stockValue'))}</b>, low: <b>{sum('lowStock')}</b>, owing: <b>{amt(sum('owing'))}</b> } },
        ]}
        height={300}
      />
    </div>
  )
}

/* ── Other sections ────────────────────────────────────────────────────── */
function FavouriteTransactions() {
  const nav = useNavigate()
  const favs = useFavourites().filter((f) => f.home)
  return (
    <div style={{ padding: '12px 14px', minHeight: 120, columns: 3, columnGap: 20 }}>
      {favs.length === 0 && (
        <div className="ma-label" style={{ color: '#888' }}>
          No favourite transactions — add them in Modules → FAVOURITES
        </div>
      )}
      {favs.map((f) => (
        <div
          key={f.label}
          className="ma-side-item"
          style={{ fontSize: 11, height: 24, padding: '0 6px' }}
          onClick={() => nav(ADMIN_TRANSACTIONS.find((t) => t.label === f.label)?.to ?? transactionTo(f.label) ?? '/modules/favourites')}
        >
          {f.label}
        </div>
      ))}
    </div>
  )
}

function ReportLinks() {
  const nav = useNavigate()
  return (
    <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(170px, 1fr))', columnGap: 12, rowGap: 2 }}>
      {ADMIN_HOME_REPORT_LINKS.map((label) => (
        <div
          key={label}
          style={{ fontWeight: 700, fontSize: 11, color: '#276b3e', cursor: 'pointer', padding: '3px 0' }}
          onClick={() => nav(REPORT_LINK_TO[label] ?? '/reports/list/account-statement')}
        >
          {label}
        </div>
      ))}
    </div>
  )
}

/** Each legacy chart name opens the Charts screen on the matching data set. */
const CHART_DATASET: Record<string, string> = {
  'OP VISIT REGISTER_DOCTOR': 'SERVICES',
  'OP VISIT REGISTER_DEPARTMENT': 'SERVICES',
  'LAB TEST': 'SERVICES',
  'SERVICE CHART': 'SERVICES',
  'MEDICINE COMPARISON': 'STOCK',
  'MEDICINE GROUP': 'STOCK',
  'MEDICINE PURCHASE': 'PURCHASES',
}

function ChartLinks() {
  const nav = useNavigate()
  return (
    <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(170px, 1fr))', columnGap: 12, rowGap: 2 }}>
      <div style={{ fontWeight: 700, fontSize: 11, color: '#276b3e', padding: '3px 0', cursor: 'pointer' }} onClick={() => nav('/charts/view?ds=SALES')}>
        SALES CHART
      </div>
      {ADMIN_HOME_CHART_LINKS.map((label) => (
        <div key={label} style={{ fontWeight: 700, fontSize: 11, color: '#276b3e', padding: '3px 0', cursor: 'pointer' }} onClick={() => nav(`/charts/view?ds=${CHART_DATASET[label] ?? 'SALES'}`)}>
          {label}
        </div>
      ))}
    </div>
  )
}

function UtilitiesSection() {
  const nav = useNavigate()
  return (
    <div style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
      <Btn onClick={() => nav('/utilities/chemists')}>Chemists (Branches)</Btn>
      <Btn onClick={() => nav('/utilities/user-management')}>User Management</Btn>
      <Btn onClick={() => nav('/utilities/sync')}>OffLine/OnLine Sync</Btn>
      <Btn onClick={() => nav('/utilities/auto-generate')}>All Utilities</Btn>
    </div>
  )
}
