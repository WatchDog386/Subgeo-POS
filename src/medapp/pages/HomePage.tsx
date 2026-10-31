import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Customer, Product, Sale, ServiceJob } from '../../db/types'
import { amt, dmy, useFavourites } from '../data'
import { REPORT_ITEMS, REPORT_TREE, TRANSACTIONS, UTILITY_ITEMS, transactionTo } from '../nav'
import { Grid, Rows, SearchBar, Select, type Col } from '../ui'
import { setTaskStatus, tasksFor, useTasks } from '../tasks'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import PurchaseTodo from './PurchaseTodo'

type Section = 'todo' | 'quick' | 'stats' | 'favs' | 'reports' | 'charts' | 'utilities'
const TOP: { id: Section; label: string }[] = [
  { id: 'todo', label: 'To-Do List' },
  { id: 'quick', label: 'Quick Access' },
]
const BOTTOM: { id: Section; label: string }[] = [
  { id: 'stats', label: 'Statistics' },
  { id: 'favs', label: 'Favourite Transactions' },
  { id: 'reports', label: 'Reports' },
  { id: 'charts', label: 'Charts' },
  { id: 'utilities', label: 'Utilities' },
]
const ALL = [...TOP, ...BOTTOM]

/** Home tab (screenshot 11.14.09): stacked accordion, Quick Access open. */
export default function HomePage() {
  const { user } = useSession()
  // The purchases dashboard opens on its To-Do List (To-Do List / Task To-Do /
  // Pending-Completed); every other role opens on Quick Access.
  const purchase = user?.role === 'purchase'
  const [open, setOpen] = useState<Section>(purchase ? 'todo' : 'quick')
  const idx = ALL.findIndex((s) => s.id === open)
  const before = ALL.slice(0, idx + 1)
  const after = ALL.slice(idx + 1)
  return (
    <div style={{ padding: 12, height: '100%', minWidth: 960 }}>
      <div style={{ border: '1px solid #c3c3c3', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {before.map((s) => (
          <button key={s.id} type="button" className="ma-acc-head" onClick={() => setOpen(s.id)}>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', borderBottom: '1px solid #c3c3c3' }}>
          {purchase && open === 'todo' ? <PurchaseTodo /> : <SectionBody id={open} />}
        </div>
        {after.map((s) => (
          <button key={s.id} type="button" className="ma-acc-head" onClick={() => setOpen(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionBody({ id }: { id: Section }) {
  switch (id) {
    case 'todo':
      return <TodoList />
    case 'quick':
      return <QuickAccess />
    case 'stats':
      return <Statistics />
    case 'favs':
      return <FavouriteList />
    case 'reports':
      return <LinkList items={[...REPORT_TREE.map((r) => ({ label: r.label, to: `/reports/list/${r.slug}` })), ...REPORT_ITEMS.map((r) => ({ label: r.label, to: `/reports/${r.slug}` }))]} />
    case 'charts':
      return <LinkList items={[{ label: 'Column Chart', to: '/charts' }]} />
    case 'utilities':
      return <LinkList items={UTILITY_ITEMS.map((u) => ({ label: u.label, to: `/utilities/${u.slug}` }))} />
  }
}

const QCOLS: Col[] = [
  { key: 'module', label: 'Module', width: 160 },
  { key: 'transaction', label: 'Transaction', width: 180 },
  { key: 'role', label: 'Role', width: 100 },
  { key: 'description', label: 'Description', width: 700 },
]

function QuickAccess() {
  const nav = useNavigate()
  const [role, setRole] = useState('SELECT')
  const [q, setQ] = useState('')
  const rows = TRANSACTIONS.filter((t) => role === 'SELECT' || t.role.toUpperCase() === role)
    .filter((t) => !q.trim() || [t.module, t.label, t.role, t.description].some((v) => v.toLowerCase().includes(q.trim().toLowerCase())))
    .map((t, i) => ({ id: i, cells: { module: t.module, transaction: t.label, role: t.role, description: t.description }, to: t.to }))
  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="ma-label" style={{ fontSize: 12 }}>
          Role
        </span>
        <Select value={role} onChange={setRole} options={['SELECT', 'PHARMACY']} width={86} round />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 9 }}>
        <SearchBar value={q} onChange={setQ} width={553} />
        <span style={{ marginLeft: 'auto', marginRight: 28 }}>
          <Rows n={rows.length} />
        </span>
      </div>
      <Grid
        cols={QCOLS}
        rows={rows}
        height={266}
        style={{ marginTop: 3 }}
        onSelect={(id) => {
          const to = rows.find((r) => r.id === id)?.to
          if (to) nav(to)
        }}
      />
    </div>
  )
}

function TodoList() {
  const nav = useNavigate()
  const { user } = useSession()
  const toast = useToast()
  const tasks = tasksFor(useTasks(), user)
  const data = useLiveQuery(async () => {
    const [products, customers, jobs] = await Promise.all([
      db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).toArray(),
      db.customers.filter((c) => c.balance > 0).toArray(),
      db.jobs.filter((j) => j.status !== 'collected').toArray(),
    ])
    return { products, customers, jobs }
  }, [], { products: [] as Product[], customers: [] as Customer[], jobs: [] as ServiceJob[] })
  const rows = [
    ...tasks.map((t) => ({ id: `t${t.id}`, cells: { task: `Task from ${t.assigner}`, detail: `${t.text}${t.doc ? ` (${t.doc})` : ''}${t.due ? ` — due ${dmy(t.due)}` : ''}  [click when done]`, date: dmy(t.createdAt) }, to: `#task:${t.id}` })),
    ...data.products.map((p) => ({ id: `p${p.id}`, cells: { task: 'Re-order Medicine', detail: `${p.name} — ${p.stock} in stock (re-order at ${p.reorderLevel})`, date: dmy(p.updatedAt) }, to: '/reports/reorder' })),
    ...data.customers.map((c) => ({ id: `c${c.id}`, cells: { task: 'Collect Payment', detail: `${c.name.toUpperCase()} owes ${amt(c.balance)}`, date: dmy(c.createdAt) }, to: '/reports/list/os-debtor' })),
    ...data.jobs.map((j) => ({ id: `j${j.id}`, cells: { task: 'Service Request', detail: `${j.jobNo} ${j.customerName} — ${j.status.replace('_', ' ')}`, date: dmy(j.createdAt) }, to: '/modules/service-bill' })),
  ]
  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginRight: 28, marginBottom: 4 }}>
        <Rows n={rows.length} />
      </div>
      <Grid
        cols={[
          { key: 'task', label: 'Task', width: 180 },
          { key: 'detail', label: 'Details', width: 760 },
          { key: 'date', label: 'Date', width: 100 },
        ]}
        rows={rows}
        height={300}
        onSelect={(id) => {
          const to = rows.find((r) => r.id === id)?.to
          if (to?.startsWith('#task:')) {
            const t = tasks.find((x) => `#task:${x.id}` === to)
            if (t && confirm(`Mark this task as completed?\n\n${t.text}`)) void setTaskStatus(t.id, 'COMPLETED', user).then(() => toast('Task completed'))
          } else if (to) nav(to)
        }}
      />
    </div>
  )
}

function Statistics() {
  const s = useLiveQuery(async () => {
    const now = new Date()
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const sales = (await db.sales.where('createdAt').aboveOrEqual(month).toArray()) as Sale[]
    const today = sales.filter((x) => x.createdAt >= day)
    const sum = (list: Sale[]) => list.reduce((t, x) => t + x.total, 0)
    return {
      todayCount: today.filter((x) => !x.refundOf).length,
      todayTotal: sum(today),
      monthTotal: sum(sales),
      products: await db.products.filter((p) => p.trackStock && p.active).count(),
      low: await db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).count(),
      customers: await db.customers.count(),
      owing: (await db.customers.toArray()).reduce((t, c) => t + Math.max(0, c.balance), 0),
      openJobs: await db.jobs.filter((j) => j.status !== 'collected').count(),
    }
  }, [])
  const items: [string, ReactNode][] = s
    ? [
        ["Today's Bills", s.todayCount],
        ["Today's Collection", amt(s.todayTotal)],
        ['This Month Collection', amt(s.monthTotal)],
        ['Medicines In Stock List', s.products],
        ['Medicines Below Re-order Level', s.low],
        ['Parties (Customers)', s.customers],
        ['Outstanding Debtors', amt(s.owing)],
        ['Open Service Requests', s.openJobs],
      ]
    : []
  return (
    <div style={{ padding: '18px 20px' }}>
      <Grid
        cols={[
          { key: 'k', label: 'Statistic', width: 300 },
          { key: 'v', label: 'Value', width: 200, align: 'right' },
        ]}
        rows={items.map(([k, v], i) => ({ id: i, cells: { k, v } }))}
        width={520}
        minRows={8}
      />
    </div>
  )
}

function FavouriteList() {
  const favs = useFavourites().filter((f) => f.home)
  return <LinkList items={favs.map((f) => ({ label: f.label, to: transactionTo(f.label) ?? '/modules/favourites' }))} />
}

function LinkList({ items }: { items: { label: string; to: string }[] }) {
  const nav = useNavigate()
  return (
    <div style={{ padding: '12px 14px', columns: 3, columnGap: 20 }}>
      {items.map((it) => (
        <div key={it.label + it.to} className="ma-side-item" style={{ fontSize: 11, height: 24, padding: '0 6px' }} onClick={() => nav(it.to)}>
          {it.label}
        </div>
      ))}
    </div>
  )
}
