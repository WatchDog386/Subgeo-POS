import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ColumnChart, C as col } from './reportKit'
import { Grid, Rows, SearchBar, Select, Check, DateField, IBtn, Btn, type Col } from '../ui'
import { EyeIcon, FunnelIcon, ToolGlyph, ZoomInIcon } from '../icons'
import {
  ADMIN_FAVOURITE_CATALOGUE,
  ADMIN_HOME_CHART_LINKS,
  ADMIN_HOME_REPORT_LINKS,
  ADMIN_TRANSACTIONS,
} from '../nav-admin'
import { dmy } from '../data'

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
  col('transaction', 'Transaction', 78),
  col('doc', 'Doc', 45),
  col('docDate', 'Doc Date', 155),
  col('task', 'Task', 105),
  col('assigner', 'Assigner', 105),
  col('assignee', 'Assignee', 108),
  col('status', 'Status', 170),
]
const EMPTY_ROWS = Array.from({ length: 20 }, (_, i) => ({ id: i, cells: {} as Record<string, ReactNode> }))

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
      {tab === 'task' && <TaskToDo />}
      {tab === 'pending' && <PendingCompleted />}
    </div>
  )
}

function TodoList() {
  const [team, setTeam] = useState(false)
  const [q, setQ] = useState('')
  const from = dmy(Date.now() - 30 * 86_400_000, '/')
  const to = dmy(Date.now(), '/')
  return (
    <div style={{ display: 'flex', marginTop: 6 }}>
      <div style={{ width: 790 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 30 }}>
          <Select value="" onChange={() => undefined} options={['']} width={150} plain />
        </div>
        <div style={{ margin: '5px 0 0 22px' }}>
          <Check checked={team} onChange={setTeam}>
            <span style={{ color: '#2e7d32' }}>Show Team Tasks</span>
          </Check>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, marginLeft: 30 }}>
          <SearchBar value={q} onChange={setQ} width={365} />
          <span style={{ marginLeft: 90 }}>
            <Rows n={0} />
          </span>
        </div>
        <div style={{ marginTop: 3 }}>
          <Grid cols={TODO_COLS} rows={EMPTY_ROWS} height={272} width={790} fillWidth={false} />
        </div>
      </div>
      <div style={{ flex: 1, marginLeft: 40, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ma-bold-label">Chart</span>
          <Select value="Column Chart" onChange={() => undefined} options={['Column Chart', 'Line Chart']} width={148} plain />
          <IBtn bare title="Zoom in">
            <ZoomInIcon />
          </IBtn>
          <IBtn bare title="Zoom out">
            <ZoomInIcon minus />
          </IBtn>
          <IBtn bare title="Print" onClick={() => window.print()}>
            <ToolGlyph k="print" />
          </IBtn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span className="ma-label">From</span>
          <DateField value={from} onChange={() => undefined} />
          <span className="ma-label">To</span>
          <DateField value={to} onChange={() => undefined} />
          <Btn>View</Btn>
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 14 }}>
          <div style={{ position: 'absolute', left: 2, top: 62, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['#e07a12', '#9fbe4a', '#1a9be6', '#c9c39a'].map((c) => (
              <span key={c} style={{ width: 10, height: 16, background: c }} />
            ))}
          </div>
          <div style={{ marginLeft: 18 }}>
            <ColumnChart data={[]} width={250} height={230} />
          </div>
          <div style={{ width: 14, height: 252, border: '1px solid #c8c8c8', display: 'flex', flexDirection: 'column', marginLeft: 8 }}>
            <span style={{ fontSize: 8, textAlign: 'center', lineHeight: '12px', color: '#555' }}>▲</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 8, textAlign: 'center', lineHeight: '12px', color: '#555' }}>▼</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskToDo() {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ marginLeft: 32, display: 'flex', gap: 8 }}>
          <IBtn lg title="View">
            <EyeIcon />
          </IBtn>
          <IBtn lg title="Refresh">
            <RotateGlyph />
          </IBtn>
        </span>
        <span style={{ marginLeft: 210, display: 'flex', gap: 6 }}>
          <Btn>Adjust</Btn>
          <Btn>Product Comp</Btn>
        </span>
        <span style={{ marginLeft: 210, display: 'flex', gap: 6 }}>
          <Select value="" onChange={() => undefined} options={['']} width={125} plain />
          <Btn>Show</Btn>
          <Btn>
            Back <span style={{ fontSize: 10, color: '#777' }}>(F3)</span>
          </Btn>
          <Btn>
            Save <span style={{ fontSize: 10, color: '#777' }}>(F2)</span>
          </Btn>
          <Btn>Adv Pay</Btn>
          <Btn>Adv Rec</Btn>
          <Btn>Fc Adj</Btn>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 18, marginRight: 120 }}>
          <Check checked onChange={() => undefined} dark>
            <span style={{ color: '#2e7d32' }}>Jasper Print?</span>
          </Check>
          <Check checked={false} onChange={() => undefined} dark>
            <span>Send Sms</span>
          </Check>
        </span>
      </div>
      <div style={{ borderTop: '1px solid #d8d8d8', marginTop: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ marginLeft: 32 }}>
          <Btn>Advances</Btn>
        </span>
        <span style={{ marginLeft: 28 }}>
          <Select value="SELECT" onChange={() => undefined} options={['SELECT']} width={110} />
        </span>
        <span style={{ marginLeft: 28, display: 'flex', gap: 16 }}>
          <label className="ma-radio">
            <input type="radio" name="task-print" defaultChecked />
            <span className="dot" />
            Print ?
          </label>
          <label className="ma-radio">
            <input type="radio" name="task-print" />
            <span className="dot" />
            Draft Print ?
          </label>
        </span>
      </div>
      <div style={{ height: 380 }} />
    </div>
  )
}

function PendingCompleted() {
  return (
    <div style={{ display: 'flex', gap: 40, marginTop: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 27, marginBottom: 2 }}>
          <IBtn bare title="Refresh">
            <RotateGlyph />
          </IBtn>
          <SearchBar value="" onChange={() => undefined} width={190} />
          <span style={{ marginLeft: 'auto' }}>
            <Rows n={0} />
          </span>
        </div>
        <Grid cols={TODO_COLS} rows={EMPTY_ROWS} height={272} fillWidth={false} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 27, marginBottom: 2 }}>
          <IBtn bare title="Refresh">
            <RotateGlyph />
          </IBtn>
          <SearchBar value="" onChange={() => undefined} width={190} />
          <span style={{ marginLeft: 'auto' }}>
            <Rows n={0} />
          </span>
        </div>
        <Grid cols={TODO_COLS} rows={EMPTY_ROWS} height={272} fillWidth={false} />
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

/* ── Statistics ────────────────────────────────────────────────────────── */
function Statistics() {
  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IBtn lg title="Refresh" onClick={() => window.location.reload()}>
          <RotateGlyph />
        </IBtn>
        <IBtn lg title="Filter">
          <FunnelIcon />
        </IBtn>
      </div>
      <div className="ma-subtabs" style={{ marginTop: 8, paddingRight: 4 }}>
        <span className="ma-subtab is-active">Header</span>
      </div>
      <div style={{ border: '1px solid #c3c3c3', borderTop: 0, height: 300, background: '#fbfaf3' }} />
    </div>
  )
}

/* ── Other sections ────────────────────────────────────────────────────── */
function FavouriteTransactions() {
  return (
    <div style={{ padding: '12px 14px', height: 320 }}>
      {ADMIN_FAVOURITE_CATALOGUE.length === 0 && (
        <div className="ma-label" style={{ color: '#888' }}>
          No favourite transactions
        </div>
      )}
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

function ChartLinks() {
  return (
    <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(170px, 1fr))', columnGap: 12, rowGap: 2 }}>
      {ADMIN_HOME_CHART_LINKS.map((label) => (
        <div key={label} style={{ fontWeight: 700, fontSize: 11, color: '#276b3e', padding: '3px 0' }}>
          {label}
        </div>
      ))}
    </div>
  )
}

function UtilitiesSection() {
  const nav = useNavigate()
  return (
    <div style={{ padding: '10px 14px' }}>
      <Btn onClick={() => nav('/utilities/auto-generate')}>Utilities</Btn>
    </div>
  )
}
