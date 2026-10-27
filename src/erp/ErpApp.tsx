import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Blocks,
  BookOpen,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  Star,
  Wrench,
  X,
} from 'lucide-react'
import { useSession } from '../session'
import { useSettings } from '../db/settings'
import LoginPage from '../pages/LoginPage'
import SellPage from '../pages/SellPage'
import SalesPage from '../pages/SalesPage'
import InventoryPage from '../pages/InventoryPage'
import PurchasingPage from '../pages/PurchasingPage'
import CustomersPage from '../pages/CustomersPage'
import CustomerDisplayPage from '../pages/CustomerDisplayPage'
import ServicePage from '../pages/ServicePage'
import ShiftPage from '../pages/ShiftPage'
import SettingsPage from '../pages/SettingsPage'
import NotificationsPage from '../pages/NotificationsPage'
import MessagesPage from '../pages/MessagesPage'
import StaffPage from '../pages/StaffPage'
import LogsPage from '../pages/LogsPage'
import ProfilePage from '../pages/ProfilePage'
import ErpHomePage from './HomePage'
import ErpModulesPage from './ModulesPage'
import ErpReportsPage from './ReportsPage'
import ErpChartsPage from './ChartsPage'
import ErpUtilitiesPage from './UtilitiesPage'
import ErpHelpDocsPage from './HelpDocsPage'
import { APP_VERSION, BRANCH_CODE, COMPANY_LABEL, LICENSE_PERIOD, type ErpTab } from './config'
import { FAVOURITES, MODULE_GROUPS, REPORT_ITEMS, UTILITY_ITEMS } from './erpNav'

// Layout mirroring the old medapp window: white header with the store banner,
// grey tab strip (Home | Modules | Reports | Charts | Utilities | HelpDocs),
// steel-blue accordion sidebar with Favourites, beige work area.

const TABS: { tab: ErpTab; label: string; icon: typeof LayoutDashboard }[] = [
  { tab: 'home', label: 'Home', icon: LayoutDashboard },
  { tab: 'modules', label: 'Modules', icon: Blocks },
  { tab: 'reports', label: 'Reports', icon: BarChart3 },
  { tab: 'charts', label: 'Charts', icon: PieChart },
  { tab: 'utilities', label: 'Utilities', icon: Wrench },
  { tab: 'helpdocs', label: 'HelpDocs', icon: BookOpen },
]

/** Build the accordion groups shown for the active top tab. */
function sidebarFor(tab: ErpTab): { label: string; items: { label: string; to: string }[] }[] {
  if (tab === 'reports') {
    return [
      {
        label: 'REPORTS LIST',
        items: REPORT_ITEMS.map((r) => ({ label: r.label, to: r.to })),
      },
    ]
  }
  if (tab === 'charts') {
    return [
      {
        label: 'CHARTS LIST',
        items: [
          { label: 'Column Chart — Sales by Month', to: '/charts/sales-month' },
          { label: 'Column Chart — Stock by Category', to: '/charts/stock-category' },
          { label: 'Column Chart — Payment Split', to: '/charts/payment-split' },
        ],
      },
    ]
  }
  if (tab === 'utilities') return UTILITY_ITEMS.map((g) => ({ label: g.label, items: g.items.map(({ label, to }) => ({ label, to })) }))
  if (tab === 'modules')
    return MODULE_GROUPS.map((g) => ({
      label: g.label,
      items: g.items.map(({ label }) => ({ label, to: `/modules/${encodeURIComponent(label)}` })),
    }))
  if (tab === 'helpdocs') {
    return [
      {
        label: 'DOCUMENTATION',
        items: [
          { label: 'Product Summary', to: '/helpdocs' },
          { label: 'Transaction Summary', to: '/helpdocs' },
          { label: 'User Guide', to: '/helpdocs' },
          { label: 'Hardware Setup', to: '/helpdocs' },
        ],
      },
    ]
  }
  if (tab === 'home') {
    return []
  }
  return []
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function Sidebar({
  groups,
  onNavigate,
}: {
  groups: { label: string; items: { label: string; to: string }[] }[]
  onNavigate: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => {
    // Start with every accordion open on first mount for a new tab.
    const all: Record<string, boolean> = {}
    for (const g of groups) all[g.label] = true
    setOpen(all)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.label).join('|')])
  return (
    <nav className="erp-scroll min-h-0 flex-1 overflow-y-auto pb-4">
      {groups.map((group) => {
        const isOpen = open[group.label] ?? true
        return (
          <div key={group.label} className="mb-px">
            <button
              type="button"
              onClick={() => setOpen({ ...open, [group.label]: !isOpen })}
              className="flex w-full items-center gap-2 bg-[#27538a] px-3 py-2 text-left text-[12px] font-bold uppercase tracking-wide text-white transition hover:bg-[#21507f]"
            >
              {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
              <span className="truncate">{group.label}</span>
            </button>
            {isOpen && (
              <ul>
                {group.items.map((item) => (
                  <li key={item.to + item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to !== '/home'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `block truncate border-b border-[#3f6da3]/40 px-5 py-2 text-[13px] text-white transition ${
                          isActive ? 'bg-[#f0a848] text-slate-900' : 'hover:bg-[#5d90c9]'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <div className="mt-3">
        <div className="flex items-center gap-2 bg-[#c9a227] px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-900">
          <Star size={14} className="shrink-0 fill-slate-900" /> Favourites
        </div>
        <ul>
          {FAVOURITES.map((f) => (
            <li key={f.to + f.label}>
              <NavLink
                to={f.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `block truncate border-b border-[#3f6da3]/40 px-5 py-2 text-[13px] transition ${
                    isActive ? 'bg-[#f0a848] text-slate-900' : 'text-white hover:bg-[#5d90c9]'
                  }`
                }
              >
                {f.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

export default function ErpApp() {
  const { user, lock } = useSession()
  const settings = useSettings()
  const online = useOnline()
  const path = useLocation().pathname
  const [navOpen, setNavOpen] = useState(false)
  if (!user) return <LoginPage />

  const tab: ErpTab = path.startsWith('/modules')
    ? 'modules'
    : path.startsWith('/reports')
      ? 'reports'
      : path.startsWith('/charts')
        ? 'charts'
        : path.startsWith('/utilities')
          ? 'utilities'
          : path.startsWith('/helpdocs')
            ? 'helpdocs'
            : 'home'
  const groups = sidebarFor(tab)

  return (
    <div className="flex h-full flex-col">
      {/* Header banner: logo, date, welcome, company + license, logout */}
      <header className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-1.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <img src="logo.png" alt="" className="h-9 w-9 shrink-0 object-contain" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-bold text-slate-900">{settings.shopName.toUpperCase()}</div>
            <div className="text-[11px] text-slate-500">Version {APP_VERSION} · {BRANCH_CODE}</div>
          </div>
        </div>
        <div className="hidden text-[12px] text-slate-600 lg:block">
          {new Date().toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div className="hidden text-[12px] text-slate-600 sm:block">
          Welcome <b className="text-slate-800">{user.name.toUpperCase()}</b>
          {user.role !== 'owner' ? '' : ' - (Manager)'}
        </div>
        <div className="hidden text-[12px] leading-tight text-slate-600 xl:block">
          <div className="font-bold text-slate-800">{COMPANY_LABEL}</div>
          <div className="font-mono text-[10px] text-slate-500">{LICENSE_PERIOD}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] text-slate-600" title={online ? 'Online' : 'Offline'}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'On' : 'Off'}
          </span>
          <button
            type="button"
            onClick={lock}
            className="flex items-center gap-1.5 rounded-sm bg-[#c0392b] px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:brightness-110 active:scale-95"
          >
            <LogOut size={14} /> Logout
          </button>
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
            className="rounded-sm bg-[#3b74b8] p-1.5 text-white transition active:scale-95 sm:hidden"
          >
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* Grey tab strip like the old app */}
      <div className="flex shrink-0 gap-px overflow-x-auto border-b border-slate-300 bg-[#7a8288] px-2 pt-1.5">
        {TABS.map(({ tab: t, label, icon: Icon }) => (
          <NavLink
            key={t}
            to={`/${t}`}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-4 py-1.5 text-[13px] font-semibold transition ${
                // eslint-disable-next-line no-unneeded-ternary
                isActive
                  ? 'border-slate-300 bg-[#e2ddd3] text-slate-900'
                  : 'border-[#5e666c] bg-[#9aa1a7] text-white hover:bg-[#8a9096]'
              }`
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </div>

      {navOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[2px] sm:hidden"
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Steel-blue accordion sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-[#3b74b8] shadow-2xl transition-transform duration-200 sm:static sm:z-auto sm:w-60 sm:translate-x-0 sm:shadow-none lg:w-64 ${
            navOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between gap-2 bg-[#27538a] px-3 py-2 text-white sm:hidden">
            <span className="truncate text-sm font-bold">{settings.shopName.toUpperCase()}</span>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="rounded-md p-1 text-white/70 hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
          {groups.length === 0 && (
            <div className="flex items-center gap-2 bg-[#27538a] px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-white">
              QUICK LINKS
            </div>
          )}
          <Sidebar groups={groups.length ? groups : [{ label: 'DAILY', items: [{ label: 'To-Do & Quick Access', to: '/home' }, { label: 'OTC Medicine Issued/Bill', to: '/sell' }, { label: 'Sales Register', to: '/sales' }, { label: 'Open / Close Shift', to: '/shift' }] }]} onNavigate={() => setNavOpen(false)} />
          <div className="border-t border-[#27538a] bg-[#27538a] px-3 py-2 text-[11px] text-white/80">
            {user.name} · <span className="capitalize">{user.role}</span>
          </div>
        </aside>

        {/* Beige work area like the medapp content pane */}
        <main className="erp-scroll min-h-0 flex-1 overflow-auto bg-[#e2ddd3]">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<ErpHomePage />} />
            <Route path="/dashboard" element={<Navigate to="/home" replace />} />
            <Route path="/modules" element={<ErpModulesPage />} />
            <Route path="/modules/:label" element={<ErpModulesPage />} />
            <Route path="/reports" element={<ErpReportsPage />} />
            <Route path="/reports/:slug" element={<ErpReportsPage />} />
            <Route path="/charts" element={<ErpChartsPage />} />
            <Route path="/charts/:slug" element={<ErpChartsPage />} />
            <Route path="/utilities" element={<ErpUtilitiesPage />} />
            <Route path="/utilities/export" element={<ErpUtilitiesPage />} />
            <Route path="/helpdocs" element={<ErpHelpDocsPage />} />
            <Route path="/sell" element={<SellPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/products" element={<InventoryPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/purchasing" element={<PurchasingPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/display" element={<CustomerDisplayPage />} />
            <Route path="/service" element={<ServicePage />} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
