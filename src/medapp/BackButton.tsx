// "◀ Back" at the start of the tab bar, on every page of every dashboard.
//   1. an open pop-up closes (as with Esc);
//   2. an entry screen (GRN, bill, Medicine…) goes back to its list (as Back (F3));
//   3. otherwise the previous page, or Home when there is none.
import { useLocation, useNavigate } from 'react-router-dom'

/** Entry screens listen for this (see useEntryKeys) and call preventDefault when they handle it. */
export const BACK_EVENT = 'ma:back'

const openDialog = () => document.querySelector('.ma-modal, [role="dialog"]')

export function BackButton() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const page = () => {
    const ev = new Event(BACK_EVENT, { cancelable: true })
    window.dispatchEvent(ev)
    if (ev.defaultPrevented) return
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) nav(-1)
    else if (pathname !== '/home') nav('/home')
  }
  const back = () => {
    if (openDialog()) {
      const esc = { key: 'Escape', code: 'Escape', bubbles: true }
      window.dispatchEvent(new KeyboardEvent('keydown', esc))
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', esc))
      // A pop-up that doesn't close on Esc: leave the page instead.
      window.setTimeout(() => openDialog() && page(), 80)
      return
    }
    page()
  }
  return (
    <button type="button" className="ma-back-btn" onClick={back} title="Back (closes a pop-up, leaves an entry screen, or goes to the previous page)" aria-label="Back">
      <span aria-hidden>◀</span> Back
    </button>
  )
}
