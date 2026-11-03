import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { MEDICINE_LIST } from '../db/medicineList'
import type { MedicineNameRec } from '../db/types'

export interface MedicineNameInputProps {
  value: string
  /** Picked name + the standard group it matched (undefined if free-typed). */
  onChange: (name: string, group: string | undefined) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
}

/** Type-ahead for medicine names: the bundled standard list plus names admins
 * have keyed in before (synced company-wide). Picking an unknown name adds it
 * to the list for future use. */
export function MedicineNameInput({ value, onChange, placeholder, disabled, autoFocus }: MedicineNameInputProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const serverNames = useLiveQuery(() => db.medicineNames.filter((n) => n.active).toArray(), [], [] as MedicineNameRec[])

  const known = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of MEDICINE_LIST) map.set(m.name.toLowerCase(), m.group)
    for (const n of serverNames ?? []) if (n.group) map.set(n.name.toLowerCase(), n.group)
    return map
  }, [serverNames])

  const q = value.trim().toLowerCase()
  const suggestions = useMemo(() => {
    const out: { name: string; group: string | undefined; isNew: boolean }[] = []
    const seen = new Set<string>()
    if (q) {
      const starts: string[] = []
      const contains: string[] = []
      for (const name of known.keys()) {
        if (name.includes(q)) {
          ;(name.startsWith(q) ? starts : contains).push(name)
        }
      }
      for (const name of [...starts, ...contains]) {
        if (seen.has(name)) continue
        seen.add(name)
        out.push({ name, group: known.get(name), isNew: false })
      }
      const exact = seen.has(q)
      if (!exact && q.length >= 2 && out.length < 8) {
        out.push({ name: value.trim(), group: undefined, isNew: true })
      }
    }
    return out.slice(0, 8)
  }, [q, known])

  useEffect(() => {
    if (open) setHighlight(Math.min(highlight, suggestions.length - 1))
  }, [open, suggestions.length, highlight])

  const pick = (item: { name: string; group: string | undefined; isNew: boolean }) => {
    setOpen(false)
    inputRef.current?.focus()
    onChange(item.name, item.group)
    if (item.isNew) {
      void db.medicineNames.add({
        name: item.name.trim(),
        group: item.group ?? '',
        source: 'admin',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') return setOpen(false)
    if (!open && (e.key === 'ArrowDown' || e.key === ' ')) return setOpen(true)
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % suggestions.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = suggestions[highlight]; if (s) pick(s) }
    else setOpen(true)
  }

  const onBlur = () => {
    // Keep the dropdown open a tick so a click on a suggestion can register.
    setTimeout(() => setOpen(false), 120)
  }

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  return (
    <div className="relative" onMouseDown={(e) => e.target === e.currentTarget || e.stopPropagation()}>
      <input
        ref={inputRef}
        className="input w-full border border-hairline rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-400 outline-none disabled:bg-slate-50 disabled:text-slate-500"
        placeholder={placeholder ?? 'Type medicine name…'}
        value={value}
        onChange={(e) => { setOpen(true); onChange(e.target.value, undefined) }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {open && suggestions.length > 0 && (
        <ul ref={listRef} className="absolute z-20 mt-1 w-full max-h-60 overflow-auto border border-hairline rounded-lg bg-white shadow-card">
          {suggestions.map((s, i) => {
            const active = i === highlight
            const label = s.isNew ? `Add “${s.name}” to medicine list` : s.name
            return (
              <li key={s.name + i}
                onClick={() => pick(s)}
                onMouseEnter={() => setHighlight(i)}
                className={`px-3 py-2 text-sm cursor-pointer ${active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <div className="font-medium truncate">{label}</div>
                {!s.isNew && s.group && (
                  <span className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{s.group}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
