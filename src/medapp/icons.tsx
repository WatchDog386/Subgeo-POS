// Hand-drawn SVG versions of the legacy medapp icons. Sizes and colours are
// matched to the screenshots of the old EMR-lite 9.5.21 install.

type P = { size?: number; className?: string }

/** Two people (orange + blue) shown next to "Welcome". */
export function UsersIcon({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <circle cx="11" cy="9" r="5" fill="#c9862b" />
      <path d="M2 24c0-6 4-9 9-9s9 3 9 9z" fill="#7a9a2a" />
      <circle cx="19" cy="12" r="5" fill="#f2a43a" stroke="#c97a14" strokeWidth=".6" />
      <path d="M10 28c0-6 4-9 9-9s9 3 9 9z" fill="#3c7fc4" stroke="#24578e" strokeWidth=".6" />
      <path d="M17 19l2 4 2-4" fill="#fff" />
    </svg>
  )
}

/** Grey door with the red "exit" arrow. */
export function LogoutIcon({ size = 36 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      <defs>
        <linearGradient id="ma-door" x1="0" x2="1">
          <stop offset="0" stopColor="#6b6b6b" />
          <stop offset=".5" stopColor="#b9b9b9" />
          <stop offset="1" stopColor="#7d7d7d" />
        </linearGradient>
      </defs>
      <rect x="6" y="3" width="15" height="30" fill="url(#ma-door)" stroke="#444" strokeWidth=".8" />
      <path d="M6 3l10 3v27l-10-0z" fill="#8f8f8f" stroke="#444" strokeWidth=".6" />
      <circle cx="14" cy="19" r="1" fill="#222" />
      <path d="M33 19l-8-7v4h-7v6h7v4z" fill="#e01b1b" stroke="#8b0b0b" strokeWidth=".8" />
    </svg>
  )
}

/** Notepad with a little yellow star in the corner. */
export function NotepadIcon({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 32" aria-hidden>
      <rect x="4" y="4" width="20" height="25" fill="#fff" stroke="#6f6f6f" />
      <rect x="6" y="6" width="20" height="25" fill="#fbfbfb" stroke="#6f6f6f" />
      <path d="M6 6h20v3H6z" fill="#e8e8e8" />
      <circle cx="25" cy="5" r="4" fill="#ffe14a" stroke="#d4a90a" strokeWidth=".6" />
    </svg>
  )
}

/** Stylised "EMR-lite" product mark (top-right of the header). */
export function EmrLiteLogo() {
  return (
    <svg width="84" height="26" viewBox="0 0 84 26" aria-label="EMR-lite">
      <text x="2" y="21" fontFamily="'Comic Sans MS','Segoe Print',cursive" fontSize="22" fontWeight="bold" fill="#3fae2a" fontStyle="italic">
        Ɛ
      </text>
      <text x="15" y="21" fontFamily="'Comic Sans MS','Segoe Print',cursive" fontSize="22" fontWeight="bold" fill="#f5d10f" fontStyle="italic">
        M
      </text>
      <text x="33" y="21" fontFamily="'Comic Sans MS','Segoe Print',cursive" fontSize="19" fontWeight="bold" fill="#f5d10f" fontStyle="italic">
        )
      </text>
      <text x="40" y="18" fontFamily="'Cooper Black','Georgia',serif" fontSize="15" fontWeight="bold" fill="#3b3fb0">
        -lite
      </text>
    </svg>
  )
}

/* ── Tab icons ─────────────────────────────────────────────────────────── */
export function HomeTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2l7 6h-2v6H9v-4H7v4H3V8H1z" fill="#fff" stroke="#555" strokeWidth="1" strokeLinejoin="round" />
      <rect x="11" y="3" width="2" height="3" fill="#777" />
    </svg>
  )
}
export function ModulesTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#3d78b8" />
      <rect x="1.5" y="2.5" width="13" height="2.5" fill="#6aa5e0" />
      <path d="M4 7.5h8M4 9.5h8M4 11.5h5" stroke="#3d78b8" />
    </svg>
  )
}
export function ReportsTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="1.5" width="11" height="13" fill="#fff" stroke="#3d78b8" />
      <path d="M2 4h2M2 7h2M2 10h2M2 13h2" stroke="#555" strokeWidth="1.2" />
      <path d="M6 5h6M6 7.5h6M6 10h4" stroke="#3d78b8" />
    </svg>
  )
}
export function GearIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5l1 1.8 2-.5.4 2 1.9.8-.7 1.9 1.3 1.5-1.6 1.2.2 2-2 .2-.9 1.8-1.6-1.1L6.4 14.5l-.9-1.8-2-.2.2-2L2.1 9.3l1.3-1.5-.7-1.9 1.9-.8.4-2 2 .5z"
        fill="#d9d9d9"
        stroke="#777"
        strokeWidth=".8"
      />
      <circle cx="8" cy="8" r="2.4" fill="#fff" stroke="#777" strokeWidth=".8" />
    </svg>
  )
}

/* ── Sidebar icons ─────────────────────────────────────────────────────── */
/** Multicolour globe on the blue group buttons (RETAIL SALES etc). */
export function GroupGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="8" fill="#2f8f2f" stroke="#1d5e1d" strokeWidth=".6" />
      <path d="M9 1a8 8 0 0 1 8 8H9z" fill="#e23a2a" />
      <path d="M9 9h8a8 8 0 0 1-8 8z" fill="#f2c514" />
      <path d="M1 9a8 8 0 0 1 8-8v8z" fill="#47a836" />
      <ellipse cx="7" cy="6" rx="3" ry="1.6" fill="#fff" opacity=".45" />
    </svg>
  )
}
/** Little globe with a person, used for module transactions. */
export function ItemGlobe() {
  return (
    <svg width="15" height="17" viewBox="0 0 15 17" aria-hidden>
      <circle cx="7.5" cy="6.5" r="6" fill="#58a9e8" stroke="#2a6fae" strokeWidth=".8" />
      <path d="M3 5c2 1 3-1 5 0s2 3 4 2" stroke="#2f8f2f" strokeWidth="1.4" fill="none" />
      <circle cx="7.5" cy="13" r="2" fill="#555" />
      <path d="M4 17c0-2.5 1.5-3.5 3.5-3.5S11 14.5 11 17z" fill="#666" />
    </svg>
  )
}
export function FileIcon() {
  return (
    <svg width="12" height="15" viewBox="0 0 12 15" aria-hidden>
      <path d="M1 .5h7l3.5 3.5v10.5H1z" fill="#fff" stroke="#555" />
      <path d="M8 .5V4h3.5" fill="#eee" stroke="#555" />
    </svg>
  )
}
export function FolderIcon() {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" aria-hidden>
      <path d="M.5 2.5h5l1.5 1.5h8.5v8.5H.5z" fill="#f7d36b" stroke="#a7801a" />
      <path d="M.5 5.5h15v7H.5z" fill="#fbe39a" stroke="#a7801a" />
    </svg>
  )
}

/* ── Toolbar icons ─────────────────────────────────────────────────────── */
/** Search tile icon: blue lens with red handle. */
export function SearchLens({ size = 22 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <circle cx="12.5" cy="9" r="7" fill="#cfe8fb" stroke="#1d5ea8" strokeWidth="1.6" />
      <ellipse cx="11" cy="7" rx="3.5" ry="2" fill="#fff" opacity=".8" />
      <path d="M7.5 14l-5.5 6" stroke="#c22121" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
/** Yellow/orange lookup magnifier beside text fields. */
export function LookupIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
      <circle cx="9" cy="6" r="4.3" fill="#fff6c8" stroke="#c98a07" strokeWidth="1.5" />
      <path d="M6 9.2L1.8 13.4" stroke="#c98a07" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
export function CalendarIcon() {
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" aria-hidden>
      <rect x=".5" y=".5" width="13" height="12" fill="#fff" stroke="#666" />
      <rect x=".5" y=".5" width="13" height="3" fill="#9a9a9a" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => <rect key={`${r}-${c}`} x={2 + c * 3} y={5 + r * 2.5} width="2" height="1.6" fill="#666" />),
      )}
    </svg>
  )
}
/** Blue cross "+" (New). */
export function PlusIcon({ size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M7 1.5h6v5.5h5.5v6H13v5.5H7V13H1.5V7H7z" fill="#3a9ae6" stroke="#1d5ea8" strokeWidth="1" />
      <path d="M8 2.5h4v3H8z" fill="#bfe1fb" opacity=".8" />
    </svg>
  )
}
export function EyeIcon({ size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M1 10c3-5 15-5 18 0-3 5-15 5-18 0z" fill="#fff" stroke="#222" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="3.6" fill="#333" />
      <circle cx="9" cy="9" r="1.1" fill="#fff" />
    </svg>
  )
}
/** Magnifier with "=" lines (Find). */
export function FindIcon({ size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx="11.5" cy="8.5" r="6.5" fill="#fff" stroke="#1d5ea8" strokeWidth="1.6" />
      <path d="M8.5 7h6M8.5 10h6" stroke="#1d5ea8" strokeWidth="1.5" />
      <path d="M6.5 13.5l-5 5" stroke="#1d5ea8" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
export function FunnelIcon({ size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M2 2.5h16l-6 7.5v7l-4 1.5V10z" fill="#d6d6d6" stroke="#444" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4 3.5h12" stroke="#fff" />
    </svg>
  )
}
export function MagnifierIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="9.5" cy="6.5" r="4.5" fill="#e9f4fd" stroke="#2f6fb4" strokeWidth="1.3" />
      <path d="M6.3 9.7L2 14" stroke="#7a7a7a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
/** Orange-handled magnifier used on the report toolbar. */
export function ZoomGlass({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <circle cx="10" cy="10" r="7" fill="#dcecf8" stroke="#5f6d78" strokeWidth="1.8" />
      <ellipse cx="8.5" cy="8" rx="3" ry="2" fill="#fff" />
      <path d="M15 15l8 8" stroke="#e07a12" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
export function StampIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M6 2h6v3l-1 4h-4l-1-4z" fill="#a0522d" stroke="#5a2c12" strokeWidth=".8" />
      <rect x="2" y="9" width="14" height="4" rx="1" fill="#c56a3a" stroke="#5a2c12" strokeWidth=".8" />
      <rect x="1.5" y="13" width="15" height="2.5" fill="#888" stroke="#444" strokeWidth=".6" />
    </svg>
  )
}
export function SortIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M5 16V3M2 6l3-3 3 3" stroke="#111" strokeWidth="1.6" fill="none" />
      <text x="10" y="8" fontSize="6" fontFamily="Verdana" fill="#1d5ea8">
        A
      </text>
      <text x="10" y="15" fontSize="6" fontFamily="Verdana" fill="#1d5ea8">
        Z
      </text>
    </svg>
  )
}
/** Orange square arrow (transfer / paging). */
export function OrangeArrow({ dir = 'right', size = 22 }: P & { dir?: 'left' | 'right' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <defs>
        <linearGradient id={`ma-or-${dir}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc86b" />
          <stop offset=".5" stopColor="#ff9a2a" />
          <stop offset="1" stopColor="#ea7a0c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="20" height="20" rx="4" fill={`url(#ma-or-${dir})`} stroke="#c56a08" />
      <g transform={dir === 'left' ? 'translate(22 0) scale(-1 1)' : undefined}>
        <path d="M5 9h6V5.5l6 5.5-6 5.5V13H5z" fill="#fff" />
      </g>
    </svg>
  )
}
/** Big glossy green round arrow (transfer all). */
export function GreenArrow({ dir = 'right', size = 34 }: P & { dir?: 'left' | 'right' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden>
      <defs>
        <radialGradient id={`ma-gr-${dir}`} cx=".4" cy=".3" r=".8">
          <stop offset="0" stopColor="#b7f07a" />
          <stop offset=".55" stopColor="#4cbf28" />
          <stop offset="1" stopColor="#1f7d12" />
        </radialGradient>
      </defs>
      <circle cx="17" cy="17" r="15.5" fill={`url(#ma-gr-${dir})`} stroke="#1a3d10" strokeWidth="1.6" />
      <g transform={dir === 'left' ? 'translate(34 0) scale(-1 1)' : undefined}>
        <path d="M8 14.5h10V9l9 8-9 8v-5.5H8z" fill="#fff" stroke="#2a5d1a" strokeWidth=".6" />
      </g>
    </svg>
  )
}
/** Small round green "+" used to add ageing periods. */
export function AddCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="#6cc04a" stroke="#2f7d1c" />
      <path d="M8 4.5v7M4.5 8h7" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}
export function ZoomInIcon({ minus }: { minus?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="7" cy="7" r="5" fill="#fff" stroke={minus ? '#c22121' : '#2f8f2f'} strokeWidth="1.4" />
      <path d={minus ? 'M4.5 7h5' : 'M4.5 7h5M7 4.5v5'} stroke={minus ? '#c22121' : '#2f8f2f'} strokeWidth="1.5" />
      <path d="M10.5 10.5l4 4" stroke="#7a5a2a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
export function OpenFolderIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      <path d="M.5 2h5l1.5 1.5h7v2H3l-2.5 7z" fill="#e7b73a" stroke="#8a6a12" strokeWidth=".8" />
      <path d="M3 5.5h12.5L13 13H.5z" fill="#f8d36b" stroke="#8a6a12" strokeWidth=".8" />
    </svg>
  )
}
export function EditDocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2 1.5h8l3 3v10H2z" fill="#fff" stroke="#666" />
      <path d="M5 12l1-3 6-6 2 2-6 6z" fill="#f2a43a" stroke="#8a4a0a" strokeWidth=".7" />
    </svg>
  )
}
/** Large "approve" sheet icon on the Exception report. */
export function ApproveSheetIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <path d="M4 3h14l4 4v16H4z" fill="#fff" stroke="#666" />
      <path d="M7 9h10M7 12h10M7 15h7" stroke="#9fb4c8" />
      <path d="M8 18l4 4 9-12" stroke="#2f6fb4" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}
export function CheckGreenIcon() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
      <path d="M1 6l4 4 8-9" stroke="#2f9e1f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/* Bottom grid toolbar glyphs (mail, add, list, note, chat, edit, globe,
   excel, copy, print, scanner, fax, download, docs, link, stack). */
export type ToolKey =
  | 'mail' | 'add' | 'list' | 'note' | 'chat' | 'edit' | 'globe' | 'excel' | 'copy'
  | 'print' | 'scanner' | 'fax' | 'download' | 'docs' | 'link' | 'stack' | 'copyAll' | 'printAll' | 'columns'

export function ToolGlyph({ k }: { k: ToolKey }) {
  switch (k) {
    case 'mail':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="4" width="14" height="10" fill="#fff" stroke="#3d78b8" />
          <path d="M2 4l7 6 7-6" stroke="#3d78b8" fill="none" />
        </svg>
      )
    case 'add':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="6.5" fill="#6cc04a" stroke="#2f7d1c" />
          <circle cx="9" cy="9" r="4" fill="#bff0a8" opacity=".5" />
          <path d="M9 5.5v7M5.5 9h7" stroke="#2f7d1c" strokeWidth="1.8" />
        </svg>
      )
    case 'list':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="3" y="2" width="12" height="14" fill="#fff" stroke="#1d5ea8" />
          <path d="M5 5h8M5 7.5h8M5 10h8M5 12.5h8" stroke="#1d5ea8" />
        </svg>
      )
    case 'note':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M2 4l9-2 5 11-9 3z" fill="#ffe46b" stroke="#b08a0a" />
          <path d="M5 6l6-1.5M6 9l6-1.5M7 12l5-1.2" stroke="#b08a0a" strokeWidth=".8" />
        </svg>
      )
    case 'chat':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="3" width="14" height="10" rx="4" fill="#48b04a" stroke="#246e25" />
          <path d="M6 13l-1 3 4-3" fill="#48b04a" stroke="#246e25" />
          <path d="M5 8h8" stroke="#fff" strokeWidth="1.6" />
        </svg>
      )
    case 'edit':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M3 15l1-4 8-8 3 3-8 8z" fill="#2f7fd8" stroke="#123f75" strokeWidth=".8" />
          <path d="M3 15l1-4 3 3z" fill="#f7d8a8" />
        </svg>
      )
    case 'globe':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="7" fill="#58a9e8" stroke="#1d5ea8" />
          <path d="M4 7c2 1 3-1 5 0s2 3 5 2M5 12c2 0 3 1 6 0" stroke="#3a9a2a" strokeWidth="1.6" fill="none" />
          <path d="M2 9h14" stroke="#f2c514" />
        </svg>
      )
    case 'excel':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="2" width="14" height="14" fill="#2e7d32" stroke="#1b4d1e" />
          <text x="4" y="13" fontSize="9" fontWeight="bold" fill="#fff" fontFamily="Verdana">
            X
          </text>
          <path d="M11 5h3M11 8h3M11 11h3" stroke="#bfe5c0" />
        </svg>
      )
    case 'copy':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="3" y="2" width="9" height="11" fill="#fff" stroke="#999" />
          <rect x="6" y="5" width="9" height="11" fill="#fff2c8" stroke="#c98a07" />
        </svg>
      )
    case 'print':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="5" y="2" width="8" height="5" fill="#fff" stroke="#555" />
          <rect x="2" y="7" width="14" height="6" rx="1" fill="#6d6d6d" stroke="#333" />
          <rect x="5" y="11" width="8" height="5" fill="#fff" stroke="#555" />
        </svg>
      )
    case 'scanner':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="1.5" y="6" width="15" height="7" rx="1" fill="#1d5ea8" stroke="#0e2f55" />
          <rect x="3" y="7.5" width="12" height="2" fill="#bfe1fb" />
          <rect x="1.5" y="12" width="15" height="2" fill="#333" />
        </svg>
      )
    case 'fax':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="4" y="2" width="10" height="6" fill="#fff" stroke="#555" />
          <rect x="2" y="8" width="14" height="7" rx="1" fill="#f2a43a" stroke="#8a4a0a" />
          <rect x="4" y="10" width="10" height="2" fill="#1d5ea8" />
        </svg>
      )
    case 'download':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M9 2v9M5.5 7.5L9 11l3.5-3.5" stroke="#2f9e1f" strokeWidth="2" fill="none" />
          <path d="M3 13v2h12v-2" stroke="#2f9e1f" strokeWidth="1.6" fill="none" />
        </svg>
      )
    case 'docs':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="4" width="11" height="12" fill="#fff" stroke="#1d5ea8" />
          <rect x="5" y="2" width="11" height="12" fill="#e4f1fc" stroke="#1d5ea8" />
          <path d="M7 6h7M7 8.5h7M7 11h5" stroke="#1d5ea8" />
        </svg>
      )
    case 'link':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="1.5" y="6" width="9" height="5" rx="2.5" transform="rotate(-40 6 8.5)" fill="none" stroke="#666" strokeWidth="2" />
          <rect x="7.5" y="7" width="9" height="5" rx="2.5" transform="rotate(-40 12 9.5)" fill="none" stroke="#888" strokeWidth="2" />
        </svg>
      )
    case 'stack':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <ellipse cx="9" cy="5" rx="6.5" ry="2.5" fill="#d0d0d0" stroke="#555" />
          <path d="M2.5 5v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5" fill="#bdbdbd" stroke="#555" />
          <path d="M2.5 9v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V9" fill="#a9a9a9" stroke="#555" />
        </svg>
      )
    case 'copyAll':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="3" width="9" height="11" fill="#e4f1fc" stroke="#1d5ea8" />
          <rect x="7" y="6" width="9" height="9" fill="#fff" stroke="#1d5ea8" />
          <path d="M9 9h5M9 11.5h5" stroke="#1d5ea8" />
        </svg>
      )
    case 'printAll':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="5" y="2" width="8" height="4" fill="#fff" stroke="#555" />
          <rect x="2" y="6" width="14" height="7" rx="2" fill="#9a9a9a" stroke="#444" />
          <rect x="5" y="11" width="8" height="5" fill="#fff" stroke="#555" />
        </svg>
      )
    case 'columns':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2" y="2" width="14" height="14" fill="#fff" stroke="#555" />
          <rect x="2" y="2" width="14" height="3" fill="#e07a12" />
          <path d="M7 5v11M12 5v11" stroke="#1d5ea8" />
        </svg>
      )
  }
}

/* ── Admin header toolbar glyphs (legacy 9.5.21 icon strip) ────────────── */
export type HeaderToolKey =
  | 'clipboard'
  | 'alert'
  | 'pos'
  | 'calendar'
  | 'camera'
  | 'bell'
  | 'refresh'
  | 'house'
  | 'exit'
  | 'redo'
  | 'stop'
  | 'pdc'
  | 'notepad'
  | 'tools'
  | 'globe'
  | 'envelope'
  | 'windows'

export function HeaderToolGlyph({ k }: { k: HeaderToolKey }) {
  switch (k) {
    case 'clipboard':
      return (
        <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden>
          <rect x="3" y="2" width="14" height="18" rx="1.5" fill="#fbfbfb" stroke="#8a8a8a" />
          <rect x="7" y="0.5" width="6" height="4" rx="1" fill="#c9c9c9" stroke="#777" />
          <path d="M5.5 7.5h9M5.5 10h9M5.5 12.5h9M5.5 15h6" stroke="#b9c6d4" strokeWidth="1.1" />
        </svg>
      )
    case 'alert':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="8.5" fill="#f7c11c" stroke="#c8880a" />
          <path d="M10 5.2l-.7 6h1.5l-.1-6z" fill="#fff" />
          <circle cx="10" cy="13.6" r="1.1" fill="#fff" />
        </svg>
      )
    case 'pos':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="3" y="2" width="13" height="16" rx="1.5" fill="#f2f2f2" stroke="#6f7f8f" />
          <rect x="5" y="4" width="9" height="4" fill="#9fb4c4" stroke="#5b6b7b" />
          <path d="M5 10.5h3M10 10.5h3M5 13h3M10 13h3" stroke="#5b6b7b" strokeWidth="1.2" />
        </svg>
      )
    case 'calendar':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="2.5" y="3" width="15" height="14.5" rx="1.5" fill="#3c4a56" stroke="#222c33" />
          <rect x="2.5" y="3" width="15" height="4" fill="#2b363f" />
          <rect x="5" y="6" width="10" height="9" fill="#fff" opacity=".9" />
          <path d="M7 3V1.5M13 3V1.5" stroke="#c9d2d8" strokeWidth="1.6" />
        </svg>
      )
    case 'camera':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="2" y="5" width="16" height="12" rx="2" fill="#3c4a56" stroke="#222c33" />
          <rect x="7" y="3" width="6" height="3" rx="1" fill="#3c4a56" stroke="#222c33" />
          <circle cx="10" cy="11" r="3.6" fill="#8aa2b2" stroke="#26323c" />
          <circle cx="10" cy="11" r="1.6" fill="#26323c" />
        </svg>
      )
    case 'bell':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M10 2.5c3.4 0 5 2.4 5 5.4V12l1.6 2.6H3.4L5 12V7.9c0-3 1.6-5.4 5-5.4z" fill="#f2a43a" stroke="#b4702a" />
          <circle cx="10" cy="16.4" r="1.4" fill="#5b3c10" />
        </svg>
      )
    case 'refresh':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M15.8 11.5A6 6 0 1 1 14 5.4" stroke="#2f9e1f" strokeWidth="2.4" fill="none" />
          <path d="M17 2.8v4.4h-4.4" fill="none" stroke="#2f9e1f" strokeWidth="2.2" />
        </svg>
      )
    case 'house':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M10 2L1.8 9.4h2.4V18h4.6v-5h2.4v5h4.6V9.4h2.4z" fill="#39b0a2" stroke="#1d6e64" />
          <path d="M8.4 2h3.2v3.4l-1.6-1.4-1.6 1.4z" fill="#37474f" />
        </svg>
      )
    case 'exit':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="2.5" y="4" width="4" height="12" fill="#d99a9a" stroke="#a03030" />
          <path d="M18 10l-5.5-4.5v3H8v3h4.5v3z" fill="#e01b1b" stroke="#8b0b0b" />
        </svg>
      )
    case 'redo':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M2 14c0-4 3-7 7.5-7h3" fill="none" stroke="#e01b1b" strokeWidth="2.2" />
          <path d="M10 4.5l4 2.5-4 2.5z" fill="#e01b1b" />
          <path d="M8 18c0-3 2.5-5.5 6-5.5h2.5" fill="none" stroke="#e01b1b" strokeWidth="2.2" />
          <path d="M14.5 10l4 2.4-4 2.4z" fill="#e01b1b" />
        </svg>
      )
    case 'stop':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="3.5" y="3.5" width="13" height="13" rx="2" fill="#e01b1b" stroke="#8b0b0b" />
        </svg>
      )
    case 'pdc':
      return (
        <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden>
          <path d="M3 3h13a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H9l-4 3v-3.4A4 4 0 0 1 3 11z" fill="#1e88e5" stroke="#12528f" />
          <rect x="10" y="4.5" width="10" height="5" rx="1" fill="#ffd400" stroke="#c7a600" />
          <text x="15" y="8.4" textAnchor="middle" fontSize="4.4" fontWeight="bold" fill="#1d3d66" fontFamily="Arial">
            PDC
          </text>
        </svg>
      )
    case 'notepad':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="3.5" y="2" width="13" height="16" fill="#1e88e5" stroke="#12528f" />
          <rect x="5.5" y="4" width="9" height="12" fill="#fff" />
          <path d="M6.5 6.5h7M6.5 8.5h7M6.5 10.5h7M6.5 12.5h5" stroke="#1e88e5" strokeWidth=".9" />
          <rect x="16.5" y="4" width="2" height="3" fill="#ffd400" />
        </svg>
      )
    case 'tools':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="1.5" y="12.5" width="15" height="2.2" rx=".6" transform="rotate(-45 9 13.6)" fill="#90caf9" stroke="#1d5ea8" strokeWidth=".8" />
          <path d="M13.5 1.5l4 4-2.2 2.2-4-4z" fill="#1e88e5" stroke="#12528f" strokeWidth=".6" />
          <path d="M2.5 13.5L12 4" stroke="#e8eef5" strokeWidth=".8" />
        </svg>
      )
    case 'globe':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="8" fill="#1e88e5" stroke="#12528f" />
          <ellipse cx="10" cy="10" rx="3.4" ry="8" fill="none" stroke="#dce8f4" strokeWidth="1" />
          <path d="M2.4 10h15.2M3.6 6h12.8M3.6 14h12.8" stroke="#dce8f4" strokeWidth="1" />
        </svg>
      )
    case 'envelope':
      return (
        <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden>
          <rect x="2" y="3" width="20" height="13" rx="1" fill="#fdb813" stroke="#b06e00" />
          <path d="M2.5 3.8l9.5 6.6 9.5-6.6" fill="none" stroke="#b06e00" strokeWidth="1.1" />
          <rect x="20" y="6" width="5" height="9" fill="#fff" stroke="#8a8a8a" />
          <path d="M21.5 8h2M21.5 10h2M21.5 12h2" stroke="#8a8a8a" />
        </svg>
      )
    case 'windows':
      return (
        <svg width="24" height="22" viewBox="0 0 24 22" aria-hidden>
          <rect x="4" y="2" width="14" height="11" fill="#fff" stroke="#8a8a8a" />
          <rect x="6.5" y="7" width="14" height="11" fill="#fff" stroke="#8a8a8a" />
          <rect x="6.5" y="7" width="14" height="2.4" fill="#d8d8d8" />
        </svg>
      )
  }
}
