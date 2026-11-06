import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './medapp.css'
import { MenuBackdrop, MenuButton, MenuHead, useSideMenu } from './mobile'
import { BackButton } from './BackButton'
import { useSession } from '../session'
import { APP_VERSION, useMedDefaults } from './data'
import {
  EmrLiteLogo,
  FileIcon,
  FolderIcon,
  GearIcon,
  GroupGlobe,
  HeaderToolGlyph,
  HomeTabIcon,
  ItemGlobe,
  ModulesTabIcon,
  ReportsTabIcon,
  UsersIcon,
  type HeaderToolKey,
} from './icons'
import {
  ADMIN_MODULE_GROUPS,
  ADMIN_REPORT_ITEMS,
  ADMIN_REPORT_TREE,
  ADMIN_UTILITY_ITEMS,
} from './nav-admin'
import { PURCHASE_MODULE_GROUPS, UTILITY_EXPANDS, moduleGroupOf, type MenuGroup } from './nav'
import HomePage from './pages/HomePage'
import { hashPassword } from '../lib/sha256'
import SyncBadge from './SyncBadge'
import { syncNow } from '../db/sync'
import { chemCode, chemCodeProblem, defaultChemCode, normChemCode } from '../db/seedData'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import type { Branch } from '../db/types'
import { Btn, Dialog } from './ui'
import { useToast } from '../components/ui'
import { toggleFullscreen } from '../lib/fullscreen'
import AdminHomePage from './pages/AdminHomePage'
import AdminReportListPage from './pages/AdminReportListPage'
import ChartsPage from './pages/ChartsPage'
import { ModuleListPage, ModulesEmpty } from './pages/ModulesPage'
import FavouritesPage from './pages/FavouritesPage'
import ReportPage from './pages/ReportPages'
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
import SettingsPage from '../pages/SettingsPage'
import NotificationsPage from '../pages/NotificationsPage'
import MessagesPage from '../pages/MessagesPage'
import StaffPage from '../pages/StaffPage'
import LogsPage from '../pages/LogsPage'
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

/** Header shortcut icons. Each opens the matching screen (title = what it does). */
const HEADER_TOOLS: { k: HeaderToolKey; title: string; to?: string; action?: 'lock' | 'sync' | 'back' | 'forward' | 'fullscreen' }[] = [
  { k: 'clipboard', title: 'Chemists (all branches)', to: '/utilities/chemists' },
  { k: 'alert', title: 'Alerts: low stock & owing', to: '/notifications' },
  { k: 'pos', title: 'Point of Sale (this chemist)', to: '/sell' },
  { k: 'calendar', title: 'Day Shift Open/Close', to: '/shift' },
  { k: 'camera', title: 'Medicines (stock)', to: '/products' },
  { k: 'bell', title: 'Notifications', to: '/notifications' },
  { k: 'refresh', title: 'Sync now', action: 'sync' },
  { k: 'house', title: 'Home', to: '/home' },
  { k: 'exit', title: 'Log Out', action: 'lock' },
  { k: 'redo', title: 'Forward', action: 'forward' },
  { k: 'stop', title: 'Back', action: 'back' },
  { k: 'pdc', title: 'Customers & credit', to: '/customers' },
  { k: 'notepad', title: 'Audit Logs', to: '/logs' },
  { k: 'tools', title: 'Settings', to: '/settings' },
  { k: 'globe', title: 'OffLine/OnLine Synchronization', to: '/utilities/sync' },
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

/** Admin shell: same medapp chrome, admin home (To-Do List), company name + branch centred
 * at the top with the licence dates. */
export default function AdminApp() {
  const { user, lock, branch, branches, branchId, switchBranch } = useSession()
  const toast = useToast()
  const [switching, setSwitching] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const runTool = (t: (typeof HEADER_TOOLS)[number]) => {
    if (t.to) nav(t.to)
    else if (t.action === 'lock') lock()
    else if (t.action === 'sync') void syncNow().then(() => toast('Sync finished'))
    else if (t.action === 'back') nav(-1)
    else if (t.action === 'forward') nav(1)
  }
  const openChemist = async (id: number) => {
    setSwitching(true)
    const r = await switchBranch(id)
    setSwitching(false)
    if (r.warning) toast(r.warning, 'error')
  }
  const defaults = useMedDefaults()
  const nav = useNavigate()
  const path = useLocation().pathname
  const tab = tabOf(path)
  // Phones: the sidebar is a slide-in menu (opens by itself on the bare Modules page).
  const [menuOpen, setMenuOpen] = useSideMenu(path, ['/modules'])
  const [sideW, setSideW] = useState(254)
  const drag = useRef<{ x: number; w: number } | null>(null)

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
  // The purchases dashboard: admin rights, with its own purchases menu first and its own home.
  const purchase = user.role === 'purchase'
  const groups: MenuGroup[] = purchase ? [...PURCHASE_MODULE_GROUPS, ...ADMIN_MODULE_GROUPS.filter((g) => g.label !== 'PURCHASES')] : ADMIN_MODULE_GROUPS
  const noPassword = purchase && user.passHash === hashPassword(user.salt, '')

  return (
    <div className="ma ma-admin">
      {noPassword && (
        <div
          className="ma-noprint"
          style={{ background: '#c62828', color: '#fff', fontSize: 12, fontWeight: 'bold', padding: '5px 12px', cursor: 'pointer' }}
          onClick={() => nav('/utilities/user-management')}
          title="Utilities → User Management → select purchase → Edit Profile → Password"
        >
          ⚠ This account has the admin's rights over every chemist but NO password — anyone who types "purchase" can sign in. Set a password now: Utilities → User Management → purchase.
        </div>
      )}
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
        <div className="ma-brand">
          <div className="ma-company">
            {defaults.companyName}
            {branch && `-${chemCode(branch.number)}`}
          </div>
          <div className="ma-chem-row">
          <label className="ma-chem-switch" title="Open another chemist: every screen then shows that chemist's stock, sales and records">
            Chemist
            <select value={branchId} disabled={switching} onChange={(e) => void openChemist(Number(e.target.value))}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {switchLabel(b)}
                  {b.active ? '' : ' (closed)'}
                </option>
              ))}
            </select>
            {switching && <span>Opening…</span>}
          </label>
          {branch && (
            <button type="button" className="ma-chem-rename" title={`Rename ${chemCode(branch.number)} — the name shown at the top (blank = ${defaultChemCode(branch.number)})`} aria-label="Rename this chemist" onClick={() => setRenaming(true)}>
              ✎
            </button>
          )}
          </div>
          {renaming && branch && <RenameChemist branch={branch} branches={branches} userId={user.id} userName={user.name} onClose={() => setRenaming(false)} />}
        </div>
        <span className="ma-hspacer" />
        <span className="ma-header-tools">
          {HEADER_TOOLS.map((t) => (
            <button
              key={t.k}
              type="button"
              className="ma-ibtn is-bare"
              title={t.title}
              aria-label={t.title}
              onClick={() => runTool(t)}
            >
              <HeaderToolGlyph k={t.k} />
            </button>
          ))}
        </span>
        <div className="ma-header-right">
          <SyncBadge />
          <button type="button" className="ma-ibtn is-bare" title="Messages" onClick={() => nav('/messages')}>
            <HeaderToolGlyph k="envelope" />
          </button>
          <button type="button" className="ma-ibtn is-bare" title="Full screen" onClick={() => void toggleFullscreen()}>
            <HeaderToolGlyph k="windows" />
          </button>
          <div className="ma-emr">
            <EmrLiteLogo />
          </div>
        </div>
      </header>

      <div className="ma-body" style={tab === 'home' || tab === 'charts' ? { paddingLeft: 10 } : undefined}>
        {tab !== 'home' && tab !== 'charts' && (
          <>
            <MenuBackdrop open={menuOpen} onClose={() => setMenuOpen(false)} />
            <aside className={`ma-side${menuOpen ? ' is-open' : ''}`} style={{ width: sideW }}>
              <MenuHead label={TABS.find((t) => t.tab === tab)?.label ?? 'Menu'} onClose={() => setMenuOpen(false)} />
              <Sidebar tab={tab} path={path} groups={groups} />
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
            {tab !== 'home' && tab !== 'charts' && <MenuButton open={menuOpen} onToggle={() => setMenuOpen(!menuOpen)} label="Menu" />}
            <BackButton />
            {TABS.map((t) => (
              <Link key={t.tab} to={`/${t.tab}`} className={`ma-tab${tab === t.tab ? ' is-active' : ''}`}>
                {t.icon}
                {t.label}
              </Link>
            ))}
          </nav>
          <main className="ma-panel">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={purchase ? <HomePage /> : <AdminHomePage />} />
              <Route path="/modules" element={<ModulesEmpty />} />
              <Route path="/modules/favourites" element={<FavouritesPage admin />} />
              <Route path="/modules/:slug" element={<ModuleListPage />} />
              <Route path="/reports" element={<Navigate to="/reports/list/account-statement" replace />} />
              <Route path="/reports/list" element={<Navigate to="/reports/list/account-statement" replace />} />
              <Route path="/reports/list/:slug" element={<AdminReportListPage />} />
              <Route path="/reports/:slug" element={<ReportPage />} />
              <Route path="/charts" element={<AdminHomePage />} />
              <Route path="/charts/view" element={<ChartsPage />} />
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
              <Route path="/staff" element={<Legacy><StaffPage /></Legacy>} />
              <Route path="/logs" element={<Legacy><LogsPage /></Legacy>} />
              <Route path="/settings" element={<Legacy><SettingsPage /></Legacy>} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

/* ── Sidebars ──────────────────────────────────────────────────────────── */
function Sidebar({ tab, path, groups }: { tab: Tab; path: string; groups: MenuGroup[] }) {
  if (tab === 'modules') return <ModulesSidebar path={path} groups={groups} />
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
        <UsersIcon />
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
          {ADMIN_REPORT_TREE.map((r) => (
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
      {ADMIN_REPORT_ITEMS.map((r) => (
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
      {ADMIN_UTILITY_ITEMS.map((u) => {
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

/** Chemist switch entry: the code, and the name when it says something more. */
function switchLabel(b: Branch): string {
  const code = chemCode(b.number)
  const same = (x: string) => x.replace(/\s+/g, '').toUpperCase()
  return !b.name || same(b.name) === same(code) || same(b.name) === same(defaultChemCode(b.number)) ? code : `${code} - ${b.name}`
}

/**
 * The ✎ next to the Chemist switch: rename the chemist shown at the top
 * ("SUBGEO CHEMIST LTD-SUBGEO10" → "…-KAWANGWARE"). Blank = the default
 * SUBGEO<number> / HQ. Same rules as Utilities → Chemists.
 */
function RenameChemist({ branch, branches, userId, userName, onClose }: { branch: Branch; branches: Branch[]; userId?: number; userName?: string; onClose: () => void }) {
  const toast = useToast()
  const [code, setCode] = useState(branch.code ?? '')
  const others = branches.filter((b) => b.id !== branch.id)
  const problem = chemCodeProblem(code, branch.number, others)
  const label = normChemCode(code) || defaultChemCode(branch.number)
  const save = async () => {
    if (problem) return toast(problem, 'error')
    const before = chemCode(branch.number)
    await db.branches.update(branch.id!, { code: normChemCode(code) || undefined })
    await logActivity('settings', `Chemist ${label} renamed`, { detail: `${before} → ${label}`, userId, userName })
    void syncNow()
    toast(`Now shown as ${label}`)
    onClose()
  }
  return (
    <Dialog
      title={`Rename ${chemCode(branch.number)}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Btn onClick={() => void save()}>Save</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </>
      }
    >
      <div className="ma-form" style={{ gridTemplateColumns: '120px 1fr', rowGap: 8 }}>
        <span className="ma-label ma-bold-label">Shown at the top as</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="ma-input"
            autoFocus
            style={{ width: 190, fontWeight: 'bold', color: '#c00' }}
            value={code}
            maxLength={24}
            placeholder={defaultChemCode(branch.number)}
            aria-label="Chemist name shown at the top"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <Btn onClick={() => setCode('')} title={`Back to ${defaultChemCode(branch.number)}`}>
            Use {defaultChemCode(branch.number)}
          </Btn>
        </span>
        <span />
        <span className="ma-label" style={{ fontSize: 10, color: problem ? '#c62828' : '#555', whiteSpace: 'normal' }}>
          {problem ?? `The header will read “…-${label}”. Also used on reports, receipts and the Chemist list. Chemist No. ${branch.number} and the cashier password stay the same.`}
        </span>
      </div>
    </Dialog>
  )
}

