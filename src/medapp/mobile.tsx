// Phone / small-tablet support for the medapp shells (admin, purchases, cashier).
// The desktop layout is untouched: everything here is either display:none on
// wide screens (see the @media block at the end of medapp.css) or only acts
// when the screen is narrow.
import { useEffect, useState } from 'react'

/** Must match the @media (max-width: …) block in medapp.css. */
export const MOBILE_QUERY = '(max-width: 900px)'

export function isMobile(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches
}

/**
 * The sidebar becomes a slide-in menu on phones. It closes whenever the page
 * changes, and opens by itself on a bare section (e.g. /modules) so the user
 * sees what to pick.
 */
export function useSideMenu(path: string, autoOpenOn: string[]): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(isMobile() && autoOpenOn.includes(path))
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  return [open, setOpen]
}

/** "☰ Menu" — first item of the tab bar on phones; hidden on desktop. */
export function MenuButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`ma-menu-btn${open ? ' is-open' : ''}`} onClick={onToggle} aria-expanded={open} aria-label={`${label} menu`}>
      <span className="bars" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="txt">{label}</span>
    </button>
  )
}

/** Title bar at the top of the slide-in menu (phones only; hidden on desktop). */
export function MenuHead({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="ma-side-head">
      <span>{label}</span>
      <button type="button" onClick={onClose} aria-label="Close menu">
        ×
      </button>
    </div>
  )
}

/** Dark layer behind the open menu; tapping it closes the menu. */
export function MenuBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <div className="ma-side-back" onClick={onClose} aria-hidden />
}

/**
 * iPhones zoom the page into any input whose text is smaller than 16px, and
 * stay zoomed. Stop that on iOS only (pinch-zoom still works there); Android
 * and desktop keep the viewport as it is.
 */
export function preventIosInputZoom(): void {
  if (typeof navigator === 'undefined') return
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!ios) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta && !/maximum-scale/.test(meta.getAttribute('content') ?? '')) meta.setAttribute('content', `${meta.getAttribute('content')}, maximum-scale=1`)
}
