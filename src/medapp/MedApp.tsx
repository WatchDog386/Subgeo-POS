import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './medapp.css'
import { useSession } from '../session'
import { APP_VERSION, useMedDefaults } from './data'
import type { MenuGroup } from './nav'
import {
  EmrLiteLogo,
  FileIcon,
  FolderIcon,
  GearIcon,
  GroupGlobe,
  HomeTabIcon,
  ItemGlobe,
  LogoutIcon,
  ModulesTabIcon,
  NotepadIcon,
  ReportsTabIcon,
  UsersIcon,
} from './icons'
import SyncBadge from './SyncBadge'
import {
  MODULE_GROUPS,
  PURCHASE_MODULE_GROUPS,
  REPORT_ITEMS,
  REPORT_TREE,
  UTILITY_EXPANDS,
  UTILITY_ITEMS,
  moduleGroupOf,
} from './nav'
import HomePage from './pages/HomePage'
import { ModuleListPage, ModulesEmpty } from './pages/ModulesPage'
import FavouritesPage from './pages/FavouritesPage'
import ReportListPage from './pages/ReportListPage'
import ReportPage from './pages/ReportPages'
import ChartsPage from './pages/ChartsPage'
import UtilityPage from './pages/UtilityPages'
import HelpDocsPage, { HELP_DOCS } from './pages/HelpDocsPage'
import SellPage from '../pages/SellPage'
import SalesPage from '../pages/SalesPage'
import InventoryPage from '../pages/InventoryPage'
import PurchasingPage from '../pages/PurchasingPage'
import CustomersPage from '../pages/CustomersPage'
import CustomerDisplayPage from '../pages/CustomerDisplayPage'
import ServicePage from '../pages/ServicePage'
import ShiftPage from '../pages/ShiftPage'
import NotificationsPage from '../pages/NotificationsPage'
import MessagesPage from '../pages/MessagesPage'
import ProfilePage from '../pages/ProfilePage'

type Tab = 'home' | 'modules' | 'reports' | 'charts' | 'utilities' | 'helpdocs'

const TABS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'home', label: 'Home', icon: <HomeTabIcon /> },
  { tab: 'modules', label: 'Modules', icon: <ModulesTabIcon /> },
  { tab: 'reports', label: 'Reports', icon: <ReportsTabIcon /> },
  { tab: 'charts', label: 'Charts', icon: <GearIcon /> },
  { tab: 'utilities', label: 'Utilities', icon: <GearIcon /> },
  { tab: 'helpdocs', label: 'HelpDocs', icon: null },
]

function tabOf(path: string): Tab {
  if (path.startsWith('/home')) return 'home'
  if (path.startsWith('/reports')) return 'reports'
  if (path.startsWith('/charts')) return 'charts'
  if (path.startsWith('/utilities')) return 'utilities'
  if (path.startsWith('/helpdocs')) return 'helpdocs'
  return 'modules'
}

/** POS screens that predate the medapp shell keep their own look inside the panel. */
function Legacy({ children }: { children: ReactNode }) {
  return <div className="h-full bg-mist font-sans text-[14px] leading-normal text-ink-body">{children}</div>
}

export default function MedApp() {
  const { user, lock, branchCode } = useSession()
  const defaults = useMedDefaults()
  const nav = useNavigate()
  const path = useLocation().pathname
  const tab = tabOf(path)
  const [sideW, setSideW] = useState(254)
  const drag = useRef<{ x: number; w: number } | null>(null)
  // The purchases dashboard has its own modules menu; every other role sees the
  // cashier/manager menu.
  const moduleGroups = user?.role === 'purchase' ? PURCHASE_MODULE_GROUPS : MODULE_GROUPS

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return
      setSideW(Math.min(420, Math.max(180, drag.current.w + e.clientX - drag.current.x)))
    }
    const up = () => (drag.current = null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  if (!user) return null

  return (
    <div className="ma">
      <header className="ma-header">
        <img className="ma-logo" src="/logo.png" alt="SUBGEO" />
        <span className="ma-version">{APP_VERSION}</span>
        <div className="ma-welcome">
          <UsersIcon />
          <div>
            <div>Welcome</div>
            <div>{user.name.toUpperCase()}</div>
          </div>
        </div>
        <div className="ma-company">
          {defaults.companyName}
          {branchCode && `-${branchCode}`}
          {(defaults.licenceFrom || defaults.licenceTo) && (
            <div style={{ fontSize: 9, fontWeight: 'normal', marginTop: 2 }}>
              ( {defaults.licenceFrom || '…'} TO {defaults.licenceTo || '…'} )
            </div>
          )}
        </div>
        <button type="button" className="ma-logout" title="Log Out" aria-label="Log Out" onClick={lock}>
          <LogoutIcon />
        </button>
        <div className="ma-header-right">
          <SyncBadge />
          <button type="button" className="ma-notes" title="Notifications" onClick={() => nav('/notifications')}>
            <NotepadIcon />
          </button>
          <div className="ma-emr">
            <EmrLiteLogo />
          </div>
        </div>
      </header>

      <div className="ma-body" style={tab === 'home' ? { paddingLeft: 10 } : undefined}>
        {tab !== 'home' && (
          <>
            <aside className="ma-side" style={{ width: sideW }}>
              <Sidebar tab={tab} path={path} moduleGroups={moduleGroups} />
            </aside>
            <div
              className="ma-split ma-noprint"
              onMouseDown={(e) => {
                drag.current = { x: e.clientX, w: sideW }
                e.preventDefault()
              }}
              title="Drag to resize"
            >
              <span />
            </div>
          </>
        )}

        <div className="ma-main">
          <nav className="ma-tabs ma-noprint">
            {TABS.map((t) => (
              <Link
                key={t.tab}
                to={`/${t.tab}`}
                className={`ma-tab${tab === t.tab ? ' is-active' : ''}`}
              >
                {t.icon}
                {t.label}
              </Link>
            ))}
          </nav>
          <main className="ma-panel">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/dashboard" element={<Navigate to="/home" replace />} />
              <Route path="/modules" element={<ModulesEmpty />} />
              <Route path="/modules/favourites" element={<FavouritesPage />} />
              <Route path="/modules/:slug" element={<ModuleListPage />} />
              <Route path="/reports" element={<Navigate to="/reports/list/account-statement" replace />} />
              <Route path="/reports/list" element={<Navigate to="/reports/list/account-statement" replace />} />
              <Route path="/reports/list/:slug" element={<ReportListPage />} />
              <Route path="/reports/:slug" element={<ReportPage />} />
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/utilities" element={<Navigate to="/utilities/auto-generate" replace />} />
              <Route path="/utilities/:slug" element={<UtilityPage />} />
              <Route path="/helpdocs" element={<Navigate to={`/helpdocs/${HELP_DOCS[0].slug}`} replace />} />
              <Route path="/helpdocs/:slug" element={<HelpDocsPage />} />
              <Route path="/sell" element={<Legacy><SellPage /></Legacy>} />
              <Route path="/sales" element={<Legacy><SalesPage /></Legacy>} />
              <Route path="/products" element={<Legacy><InventoryPage /></Legacy>} />
              <Route path="/inventory" element={<Legacy><InventoryPage /></Legacy>} />
              <Route path="/purchasing" element={<Legacy><PurchasingPage /></Legacy>} />
              <Route path="/customers" element={<Legacy><CustomersPage /></Legacy>} />
              <Route path="/display" element={<Legacy><CustomerDisplayPage /></Legacy>} />
              <Route path="/service" element={<Legacy><ServicePage /></Legacy>} />
              <Route path="/shift" element={<Legacy><ShiftPage /></Legacy>} />
              <Route path="/notifications" element={<Legacy><NotificationsPage /></Legacy>} />
              <Route path="/messages" element={<Legacy><MessagesPage /></Legacy>} />
              <Route path="/profile" element={<Legacy><ProfilePage /></Legacy>} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

/* ── Sidebars ──────────────────────────────────────────────────────────── */
function Sidebar({ tab, path, moduleGroups }: { tab: Tab; path: string; moduleGroups: MenuGroup[] }) {
  if (tab === 'modules') return <ModulesSidebar path={path} groups={moduleGroups} />
  if (tab === 'reports') return <ReportsSidebar path={path} />
  if (tab === 'charts')
    return (
      <div className="ma-side-scroll">
        <button type="button" className="ma-blue is-active">
          Charts List
        </button>
      </div>
    )
  if (tab === 'utilities') return <UtilitiesSidebar path={path} />
  return <HelpSidebar path={path} />
}

function ModulesSidebar({ path, groups }: { path: string; groups: MenuGroup[] }) {
  const nav = useNavigate()
  const activeSlug = path.startsWith('/modules/') ? path.slice('/modules/'.length) : ''
  const [open, setOpen] = useState<string | undefined>(moduleGroupOf(activeSlug, groups)?.label)
  useEffect(() => {
    const g = moduleGroupOf(activeSlug, groups)
    if (g) setOpen(g.label)
  }, [activeSlug, groups])
  return (
    <div className="ma-side-scroll">
      {groups.map((g) => (
        <div key={g.label}>
          <button
            type="button"
            className={`ma-blue${open === g.label ? ' is-active' : ''}`}
            onClick={() => setOpen(open === g.label ? undefined : g.label)}
          >
            <GroupGlobe />
            {g.label}
          </button>
          {open === g.label && (
            <div className="ma-side-list">
              {g.items.map((it) => (
                <NavLink
                  key={it.slug}
                  to={`/modules/${it.slug}`}
                  className={({ isActive }) => `ma-side-item${isActive ? ' is-active' : ''}`}
                >
                  <ItemGlobe />
                  {it.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="ma-blue-gap" />
      <button
        type="button"
        className={`ma-blue${activeSlug === 'favourites' ? ' is-active' : ''}`}
        style={{ paddingLeft: 8 }}
        onClick={() => {
          setOpen(undefined)
          nav('/modules/favourites')
        }}
      >
        FAVOURITES
      </button>
    </div>
  )
}

function ReportsSidebar({ path }: { path: string }) {
  const nav = useNavigate()
  const inList = path.startsWith('/reports/list')
  const [treeOpen, setTreeOpen] = useState(inList)
  useEffect(() => setTreeOpen(inList), [inList])
  return (
    <div className="ma-side-scroll">
      <button
        type="button"
        className="ma-blue"
        onClick={() => {
          if (inList) setTreeOpen(!treeOpen)
          else nav('/reports/list/account-statement')
        }}
      >
        Report List
      </button>
      {treeOpen && (
        <div className="ma-side-list is-tree">
          <div className="ma-tree-root" style={{ cursor: 'pointer' }} onClick={() => setTreeOpen(false)}>
            <span style={{ fontSize: 9 }}>▼</span>
            <FolderIcon />
            Report List
          </div>
          {REPORT_TREE.map((r) => (
            <NavLink
              key={r.slug}
              to={`/reports/list/${r.slug}`}
              className={({ isActive }) => `ma-tree-item${isActive ? ' is-active' : ''}`}
              style={{ paddingLeft: 30 }}
            >
              <FileIcon />
              {r.label}
            </NavLink>
          ))}
        </div>
      )}
      {REPORT_ITEMS.map((r) => (
        <button
          key={r.slug}
          type="button"
          className={`ma-blue${path === `/reports/${r.slug}` ? ' is-active' : ''}`}
          onClick={() => nav(`/reports/${r.slug}`)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function UtilitiesSidebar({ path }: { path: string }) {
  const nav = useNavigate()
  return (
    <div className="ma-side-scroll">
      {UTILITY_ITEMS.map((u) => {
        const active = path === `/utilities/${u.slug}`
        return (
          <div key={u.slug}>
            <button
              type="button"
              className={`ma-blue${active ? ' is-active' : ''}`}
              onClick={() => nav(`/utilities/${u.slug}`)}
            >
              {u.label}
            </button>
            {active && UTILITY_EXPANDS.has(u.slug) && <div className="ma-side-list" />}
          </div>
        )
      })}
    </div>
  )
}

function HelpSidebar({ path }: { path: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="ma-side-scroll">
      <button type="button" className="ma-blue" onClick={() => setOpen(!open)}>
        HelpDocs List
      </button>
      {open && (
        <div className="ma-side-list is-tree">
          <div className="ma-tree-root">
            <span style={{ fontSize: 9 }}>▼</span>
            <FolderIcon />
            HelpDocs
          </div>
          {HELP_DOCS.map((d) => (
            <NavLink
              key={d.slug}
              to={`/helpdocs/${d.slug}`}
              className={() => `ma-tree-item${path === `/helpdocs/${d.slug}` ? ' is-active' : ''}`}
              style={{ paddingLeft: 30 }}
            >
              <FileIcon />
              {d.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
