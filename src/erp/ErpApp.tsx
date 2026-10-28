import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Blocks,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  Star,
  UserRound,
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
import { APP_VERSION, COMPANY_LABEL, LICENSE_PERIOD, type ErpTab } from './config'
import { FAVOURITES, MODULE_GROUPS, REPORT_ITEMS, REPORT_TREE, UTILITY_ITEMS } from './erpNav'

// Layout mirroring the old medapp window: white header with the store banner,
// grey tab strip (Home | Modules | Reports | Charts | Utilities | HelpDocs),
// steel-blue accordion sidebar with Favourites, beige work area.

const TABS: { tab: ErpTab; label: string; icon: typeof LayoutDashboard; bg: string; border: string }[] = [
  { tab: 'home', label: 'Home', icon: LayoutDashboard, bg: '#76b043', border: '#5c8f31' },
  { tab: 'modules', label: 'Modules', icon: Blocks, bg: '#4a9fd8', border: '#2e8fc4' },
  { tab: 'reports', label: 'Reports', icon: BarChart3, bg: '#f2891d', border: '#cc7010' },
  { tab: 'charts', label: 'Charts', icon: PieChart, bg: '#0c8586', border: '#086c70' },
  { tab: 'utilities', label: 'Utilities', icon: Wrench, bg: '#64748b', border: '#475569' },
  { tab: 'helpdocs', label: 'HelpDocs', icon: BookOpen, bg: '#1b3a46', border: '#0f2931' },
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
  variant,
  activePath,
  onNavigate,
}: {
  groups: { label: string; items: { label: string; to: string }[] }[]
  variant: 'groups' | 'stack'
  activePath: string
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

  // Reports tab keeps the medapp look: a "Report List" tree on top, then the
  // rest as a continuous stack of blue rows.
  if (variant === 'stack') {
    return (
      <nav className="erp-scroll min-h-0 flex-1 overflow-y-auto">
        <NavLink
          to="/reports/list"
          className={`block border-b border-[#123c7c] px-3 py-3 text-[14px] font-bold text-white transition ${
            activePath === '/reports/list' || activePath === '/reports' ? 'bg-[#123c7c]' : 'bg-[#1857b0] hover:bg-[#1a5fc0]'
          }`}
          onClick={onNavigate}
        >
          Report List
        </NavLink>
        <div className="border-b-4 border-[#1857b0] bg-white px-2 py-2">
          <div className="flex items-center gap-1.5 px-1 py-1 text-[15px] font-bold text-[#1f272b]">
            <Folder size={15} className="shrink-0 text-amber-500" /> Report List
          </div>
          <ul>
            {REPORT_TREE.items.map((doc) => (
              <li key={doc}>
                <NavLink
                  to="/reports/list"
                  onClick={onNavigate}
                  className="flex items-center gap-1.5 px-5 py-1.5 text-[14px] text-[#2b3337] transition hover:bg-amber-200"
                >
                  <FileText size={14} className="shrink-0 text-slate-400" />
                  <span className="truncate">{doc}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
        <ul>
          {REPORT_ITEMS.filter((r) => r.to !== '/reports/list').map((r) => (
            <li key={r.to}>
              <NavLink
                to={r.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `block border-b border-[#5b93dd] px-3 py-3 text-[13.5px] font-semibold transition ${
                    isActive ? 'bg-white text-[#2e5c9a]' : 'hover:bg-[#1e4e8c] hover:text-white'
                  }`
                }
              >
                {r.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav className="erp-scroll min-h-0 flex-1 overflow-y-auto pb-4">
      {groups.map((group) => {
        const isOpen = open[group.label] ?? true
        return (
          <div key={group.label} className="mb-0">
            <button
              type="button"
              onClick={() => setOpen({ ...open, [group.label]: !isOpen })}
              className="flex w-full items-center gap-2 bg-[#1857b0] px-3 py-3.5 text-left text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-[#1a5fc0]"
            >
              <Globe size={16} className="shrink-0 text-[#9cc0f0]" />
              <span className="truncate">{group.label}</span>
              {isOpen ? <ChevronDown size={14} className="ml-auto shrink-0" /> : <ChevronRight size={14} className="ml-auto shrink-0" />}
            </button>
          {isOpen && (
              <ul className="bg-white py-1">
                {group.items.map((item) => (
                  <li key={item.to + item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to !== '/home'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-4 py-2 text-[15px] text-[#2b3337] transition ${
                          isActive ? 'bg-white font-semibold text-[#2e5c9a]' : 'hover:bg-[#1e4e8c] hover:text-white'
                        }`
                      }
                    >
                      <Globe size={14} className="shrink-0 text-[#2a70d2]" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <div className="mt-0">
        <ul className="bg-white pb-1">
          {FAVOURITES.map((f) => (
            <li key={f.to + f.label}>
              <NavLink
                to={f.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 text-[15px] text-[#2b3337] transition ${
                    isActive ? 'bg-white font-semibold text-[#2e5c9a]' : 'hover:bg-[#1e4e8c] hover:text-white'
                  }`
                }
              >
                <Star size={13} className="shrink-0 text-[#c9a227]" />
                <span className="truncate">{f.label}</span>
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
  const [menuOpen, setMenuOpen] = useState(false)
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
    <div className="flex h-full flex-col bg-white font-sans text-[#2b3337]">
      {/* Header banner: tall clean white strip — logo + version, company,
          and the welcome/user dropdown at the far right. */}
      <header className="flex h-[92px] shrink-0 items-center gap-4 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src="logo.png" alt="SUBGEO" className="h-[72px] w-[72px] shrink-0 object-contain" />
          <span className="text-[17px] font-bold text-slate-700">{APP_VERSION}</span>
        </div>
        <div className="hidden min-w-0 flex-1 text-center md:block">
          <span className="block truncate text-[21px] font-bold tracking-[0.06em] text-slate-800">{COMPANY_LABEL}</span>
          <span className="block font-mono text-[11px] font-semibold text-slate-400">{LICENSE_PERIOD}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-600" title={online ? 'Online' : 'Offline'}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'Online' : 'Offline'}
          </span>

          {/* User dropdown, far right — plain avatar + name, no wrapper box */}
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => setMenuOpen((m) => !m)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                <img src={user.image ?? 'avatar.svg'} alt={user.name} className="h-full w-full object-cover" />
              </span>
              <span className="hidden text-[14px] font-bold text-slate-800 sm:block">{user.name}</span>
              <ChevronDown size={15} className={`text-slate-400 transition ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <div className="truncate text-sm font-bold text-slate-900">{user.name}</div>
                    <div className="text-xs capitalize text-slate-400">{user.role}</div>
                  </div>
                  <NavLink
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    <UserRound size={15} />
                    My profile
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      lock()
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut size={15} />
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition active:scale-95 sm:hidden"
          >
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {navOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 top-[92px] z-30 bg-slate-950/40 sm:hidden"
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Dull-blue sidebar (no dividing line — distinct from the page bg) */}
        <aside
          className={`fixed inset-y-0 left-0 top-[92px] z-40 flex w-64 shrink-0 flex-col bg-[#2e5c9a] shadow-sm transition-transform duration-200 sm:static sm:top-auto sm:z-auto sm:w-60 sm:translate-x-0 sm:shadow-none lg:w-64 ${
            navOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between gap-2 bg-[#123c7c] px-3 py-2 text-white sm:hidden">
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
          <Sidebar
            groups={groups.length ? groups : [{ label: 'DAILY', items: [{ label: 'To-Do & Quick Access', to: '/home' }, { label: 'OTC Medicine Issued/Bill', to: '/sell' }, { label: 'Sales Register', to: '/sales' }, { label: 'Open / Close Shift', to: '/shift' }] }]}
            variant={tab === 'reports' ? 'stack' : 'groups'}
            activePath={path}
            onNavigate={() => setNavOpen(false)}
          />
        </aside>

        {/* Right column: colored tab strip (only over the work area, never
            over the sidebar) plus the white content pane */}
          <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-3 py-2">
            {TABS.map(({ tab: t, label, icon: Icon, bg, border }) => (
              <NavLink
                key={t}
                to={`/${t}`}
                style={{ background: bg, borderColor: border }}
                className={({ isActive }) =>
                  `flex h-12 shrink-0 items-center gap-2 rounded-none border px-6 text-[15px] font-semibold text-white shadow-sm transition ${
                    isActive ? 'brightness-110' : 'hover:brightness-105'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>

          {/* Dull work area, distinct from the sidebar without a divider line */}
          <main className="erp-scroll min-h-0 flex-1 overflow-auto bg-[#f5f6f8]">
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
    </div>
  )
}

