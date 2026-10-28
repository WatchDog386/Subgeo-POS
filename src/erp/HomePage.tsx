import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { ShoppingCart, Receipt, Users, Package, Truck, Wrench, Wallet } from 'lucide-react'
import { ErpPanel, ErpTable } from './piLists'
import { money, moneyShort } from '../lib/money'

// Home page mirroring the old medapp: To-Do list cards, a Quick Access table
// with a role filter, and the bottom strip (Statistics / Favourite
// Transactions / Reports / Charts / Utilities).

interface QuickAccessRow {
  module: string
  transaction: string
  role: string
  description: string
  to: string
  icon: typeof ShoppingCart
}

const QUICK_ACCESS: QuickAccessRow[] = [
  { module: 'Retail Sales', transaction: 'OTC Medicine Issued/Bill', role: 'All', description: 'Counter sale at the pharmacy till', to: '/sell', icon: ShoppingCart },
  { module: 'Retail Sales', transaction: 'OTC Medicine Issue Return', role: 'Manager', description: 'Refunds / credit notes for OTC bills', to: '/sales', icon: Receipt },
  { module: 'Retail Sales', transaction: 'Service Request/Bill', role: 'All', description: 'Patient care services and billing', to: '/service', icon: Wrench },
  { module: 'Whole Sales', transaction: 'Whole Sale Invoice', role: 'Manager', description: 'Institution / wholesale invoicing', to: '/sales', icon: Receipt },
  { module: 'Pharmacy Purchases', transaction: 'Local Purchase Order', role: 'Manager', description: 'Raise POs and receive GRN stock', to: '/purchasing', icon: Truck },
  { module: 'Pharmacy Purchases', transaction: 'Party Master', role: 'Manager', description: 'Customers, suppliers and parties', to: '/customers', icon: Users },
  { module: 'Pharmacy Purchases', transaction: 'Medicines Master', role: 'Manager', description: 'Products, prices and reorder levels', to: '/products', icon: Package },
  { module: 'Administration', transaction: 'Shift Reconciliation', role: 'Cashier', description: 'Open, close and count a till shift', to: '/shift', icon: Wallet },
]

export default function ErpHomePage() {
  const nav = useNavigate()
  const [roleFilter, setRoleFilter] = useState<'All' | 'Manager' | 'Cashier'>('All')

  const products = useLiveQuery(() => db.products.toArray(), [])
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const jobs = useLiveQuery(() => db.jobs.toArray(), [])
  const pos = useLiveQuery(() => db.purchaseOrders.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])

  const lowStock = useMemo(() => (products ?? []).filter((p) => p.trackStock && p.stock <= p.reorderLevel), [products])

  const todos = useMemo(() => {
    const list: { label: string; detail: string; to: string }[] = []
    if (lowStock.length > 0)
      list.push({ label: 'Medicines below reorder level', detail: `${lowStock.length} item(s) need restocking`, to: '/inventory' })
    const pendingPos = (pos ?? []).filter((p) => p.status === 'ordered' || p.status === 'partial')
    if (pendingPos.length > 0)
      list.push({ label: 'Purchase orders awaiting GRN', detail: `${pendingPos.length} PO(s) pending receipt`, to: '/purchasing' })
    const openJobs = (jobs ?? []).filter((j) => j.status === 'open' || j.status === 'in_progress' || j.status === 'waiting_parts')
    if (openJobs.length > 0)
      list.push({ label: 'Service requests in progress', detail: `${openJobs.length} service job(s) active`, to: '/service' })
    const owing = (customers ?? []).filter((c) => c.balance > 0)
    if (owing.length > 0)
      list.push({ label: 'Parties with outstanding balance', detail: `${owing.length} account(s) — ${money(owing.reduce((s, c) => s + c.balance, 0))}`, to: '/reports/receivables' })
    if (list.length === 0) list.push({ label: 'All clear', detail: 'Nothing pending — start with a new OTC bill', to: '/sell' })
    return list
  }, [lowStock, pos, jobs, customers])

  const today = new Date().toDateString()
  const todaySales = (sales ?? []).filter((s) => s.status === 'completed' && new Date(s.createdAt).toDateString() === today)
  const todayTotal = todaySales.reduce((s, sale) => s + sale.total, 0)
  const todayBills = todaySales.length

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <ErpPanel title="To-Do List">
          <ul className="space-y-2">
            {todos.map((t) => (
              <li key={t.label}>
                <Link
                  to={t.to}
                  className="block rounded-sm border border-slate-300 bg-[#f2f4f5] px-3 py-2 text-[13px] shadow-sm transition hover:bg-amber-200"
                >
                  <div className="font-semibold text-slate-800">{t.label}</div>
                  <div className="text-slate-500">{t.detail}</div>
                </Link>
              </li>
            ))}
          </ul>
        </ErpPanel>

        <ErpPanel title="Quick Access" actions={
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-slate-500">Role</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-[13px]"
            >
              <option>All</option>
              <option>Manager</option>
              <option>Cashier</option>
            </select>
          </div>
        }>
          <ul className="space-y-1">
            {QUICK_ACCESS.filter((q) => roleFilter === 'All' || q.role === roleFilter).map((q) => (
              <li key={q.transaction}>
                <button
                  type="button"
                  onClick={() => nav(q.to)}
                  className="flex w-full items-center gap-2.5 rounded-sm border border-slate-200 bg-white px-3 py-2 text-left text-[13px] shadow-sm transition hover:border-[#3b74b8] hover:bg-sky-50"
                >
                  <q.icon size={16} className="shrink-0 text-[#3b74b8]" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{q.transaction}</span>
                  <span className="hidden shrink-0 text-slate-400 sm:block">{q.module}</span>
                </button>
              </li>
            ))}
          </ul>
        </ErpPanel>

        <ErpPanel title="Today at a Glance">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-sm border border-slate-300 bg-white p-3 shadow-sm">
              <div className="text-[13px] font-bold text-[#5d676c]">OTC Bills Today</div>
              <div className="text-2xl font-bold text-slate-800">{todayBills}</div>
            </div>
            <div className="rounded-sm border border-slate-300 bg-white p-3 shadow-sm">
              <div className="text-[13px] font-bold text-[#5d676c]">Collections Today</div>
              <div className="text-2xl font-bold text-slate-800">{moneyShort(todayTotal)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Link to="/reports/stock" className="rounded-sm border border-slate-300 bg-white p-3 shadow-sm transition hover:bg-sky-50">
              <div className="text-[13px] font-bold text-[#5d676c]">Stock Value</div>
              <div className="text-2xl font-bold text-slate-800">{moneyShort((products ?? []).reduce((s, p) => s + p.stock * p.cost, 0))}</div>
            </Link>
            <Link to="/reports/receivables" className="rounded-sm border border-slate-300 bg-white p-3 shadow-sm transition hover:bg-sky-50">
              <div className="text-[13px] font-bold text-[#5d676c]">Outstanding A/C</div>
              <div className="text-2xl font-bold text-slate-800">{moneyShort((customers ?? []).reduce((s, c) => s + c.balance, 0))}</div>
            </Link>
          </div>
        </ErpPanel>
      </div>

      <ErpTable
        columns={[
          { label: 'Module' },
          { label: 'Transaction' },
          { label: 'Role' },
          { label: 'Description' },
        ]}
      >
        {QUICK_ACCESS.map((q, i) => (
          <tr
            key={q.transaction}
            className={`cursor-pointer border-b border-slate-100 transition hover:bg-sky-50 ${i % 2 ? 'bg-white' : 'bg-[#f2f4f5]'}`}
            onClick={() => nav(q.to)}
          >
            <td className="px-2 py-1.5">{q.module}</td>
            <td className="px-2 py-1.5 font-semibold text-slate-700">{q.transaction}</td>
            <td className="px-2 py-1.5">{q.role}</td>
            <td className="px-2 py-1.5 text-slate-500">{q.description}</td>
          </tr>
        ))}
      </ErpTable>
    </div>
  )
}
