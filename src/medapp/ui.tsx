import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CalendarIcon,
  GreenArrow,
  LookupIcon,
  OrangeArrow,
  SearchLens,
  ToolGlyph,
  type ToolKey,
} from './icons'
import { dmy, parseDmy } from './data'

/* ── Buttons ───────────────────────────────────────────────────────────── */
export function Btn({
  children,
  onClick,
  disabled,
  style,
  round,
  pill,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  style?: CSSProperties
  round?: boolean
  pill?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      className={`ma-btn${round ? ' is-round' : ''}${pill ? ' is-pill' : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={title}
    >
      {children}
    </button>
  )
}

export function IBtn({
  children,
  onClick,
  title,
  lg,
  bare,
  style,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  lg?: boolean
  bare?: boolean
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`ma-ibtn${lg ? ' is-lg' : ''}${bare ? ' is-bare' : ''}`}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  )
}

export function ToolBtn({ k, title, onClick }: { k: ToolKey; title: string; onClick?: () => void }) {
  return (
    <IBtn title={title} onClick={onClick}>
      <ToolGlyph k={k} />
    </IBtn>
  )
}

/* ── Inputs ────────────────────────────────────────────────────────────── */
export function Input({
  value,
  onChange,
  width,
  grey,
  type = 'text',
  placeholder,
  readOnly,
  onEnter,
  style,
  autoFocus,
  inputRef,
}: {
  value: string
  onChange?: (v: string) => void
  width?: number | string
  grey?: boolean
  type?: string
  placeholder?: string
  readOnly?: boolean
  onEnter?: () => void
  style?: CSSProperties
  autoFocus?: boolean
  inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <input
      ref={inputRef}
      className={`ma-input${grey ? ' is-grey' : ''}`}
      style={{ width, ...style }}
      type={type}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.()
      }}
    />
  )
}

let suggestSeq = 0
/** Free text input that suggests values already used (no fixed list): the
 * placeholder says what to type, the suggestions come from the shop's data. */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  width = 140,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder: string
  width?: number
  onEnter?: () => void
}) {
  const [id] = useState(() => `ma-suggest-${++suggestSeq}`)
  const list = [...new Set(suggestions.map((x) => x.trim()).filter(Boolean))].sort()
  return (
    <>
      <input
        className="ma-input"
        style={{ width }}
        value={value}
        list={id}
        placeholder={placeholder}
        title={placeholder}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      <datalist id={id}>
        {list.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  )
}

export type Opt = string | { value: string; label: string }
const optValue = (o: Opt) => (typeof o === 'string' ? o : o.value)
const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label)

/** Beige legacy dropdown. */
export function Select({
  value,
  onChange,
  options,
  width = 120,
  round,
  plain,
  disabled,
  style,
}: {
  value: string
  onChange?: (v: string) => void
  options: Opt[]
  width?: number
  round?: boolean
  plain?: boolean
  disabled?: boolean
  style?: CSSProperties
}) {
  return (
    <span
      className={`ma-select${round ? ' is-round' : ''}${plain ? ' is-plain' : ''}${disabled ? ' is-disabled' : ''}`}
      style={{ width, ...style }}
    >
      <select value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}>
        {options.map((o) => (
          <option key={optValue(o)} value={optValue(o)}>
            {optLabel(o)}
          </option>
        ))}
      </select>
    </span>
  )
}

/** dd/mm/yyyy text field with the little calendar grid that opens a picker. */
export function DateField({
  value,
  onChange,
  width = 66,
}: {
  value: string
  onChange: (v: string) => void
  width?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const ts = parseDmy(value)
  const iso = ts !== undefined ? new Date(ts).toISOString().slice(0, 10) : ''
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, position: 'relative' }}>
      <input
        className="ma-input"
        style={{ width }}
        value={value}
        placeholder=""
        onChange={(e) => onChange(e.target.value)}
      />
      <span
        style={{ position: 'relative', display: 'inline-flex', cursor: 'pointer' }}
        title="Select date"
        onClick={() => {
          const el = ref.current
          if (!el) return
          try {
            el.showPicker()
          } catch {
            el.focus()
          }
        }}
      >
        <CalendarIcon />
        <input
          ref={ref}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={iso}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split('-').map(Number)
            if (y && m && d) onChange(dmy(new Date(y, m - 1, d), '/'))
          }}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: 14, height: 13, border: 0, padding: 0 }}
        />
      </span>
    </span>
  )
}

/** Text field with the orange lookup magnifier; opens a pick list. */
export function LookupField({
  value,
  onChange,
  options,
  width = 140,
  title = 'Select',
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  width?: number
  title?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Input value={value} onChange={onChange} width={width} />
      <button type="button" className="ma-lookup" title="Lookup" onClick={() => setOpen(true)}>
        <LookupIcon />
      </button>
      {open && (
        <PickList
          title={title}
          options={options}
          onClose={() => setOpen(false)}
          onPick={(v) => {
            onChange(v)
            setOpen(false)
          }}
        />
      )}
    </span>
  )
}

export function PickList({
  title,
  options,
  onPick,
  onClose,
}: {
  title: string
  options: string[]
  onPick: (v: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog title={title} onClose={onClose}>
      <SearchBar value={q} onChange={setQ} width={300} autoFocus />
      <div className="ma-listbox" style={{ height: 260, width: 300, marginTop: 6 }}>
        {list.length === 0 && <div className="li" style={{ color: '#888', cursor: 'default' }}>No records</div>}
        {list.map((o) => (
          <div key={o} className="li" onDoubleClick={() => onPick(o)} onClick={() => onPick(o)}>
            {o}
          </div>
        ))}
      </div>
    </Dialog>
  )
}

/** Blue magnifier tile + filter input. */
export function SearchBar({
  value,
  onChange,
  width = 450,
  autoFocus,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  width?: number
  autoFocus?: boolean
  onEnter?: () => void
}) {
  return (
    <span className="ma-search" style={{ width }}>
      <span className="ma-search-ico">
        <SearchLens />
      </span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        aria-label="Search"
      />
    </span>
  )
}

export function Rows({ n }: { n: number }) {
  return <span className="ma-rows">| {n} rows retrieved |</span>
}

export function Radio({
  checked,
  onChange,
  children,
  name,
}: {
  checked: boolean
  onChange: () => void
  children: ReactNode
  name?: string
}) {
  return (
    <label className="ma-radio">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="dot" />
      {children}
    </label>
  )
}

export function Check({
  checked,
  onChange,
  children,
  dark,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children?: ReactNode
  dark?: boolean
}) {
  return (
    <label className={`ma-check${dark ? ' is-dark' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" />
      {children}
    </label>
  )
}

/* ── Grid ──────────────────────────────────────────────────────────────── */
export interface Col {
  key: string
  label: string
  width: number
  align?: 'right'
}
export type Row = { id: string | number; cells: Record<string, ReactNode> }

export function Grid({
  cols,
  rows,
  height,
  width,
  checkbox,
  yellowCheckHeader,
  checked,
  onCheck,
  selected,
  onSelect,
  onOpen,
  minRows,
  compact,
  fillWidth = true,
  style,
}: {
  cols: Col[]
  rows: Row[]
  height?: number
  width?: number | string
  checkbox?: boolean
  yellowCheckHeader?: boolean
  checked?: Set<string | number>
  onCheck?: (id: string | number) => void
  selected?: string | number
  onSelect?: (id: string | number) => void
  onOpen?: (id: string | number) => void
  minRows?: number
  compact?: boolean
  fillWidth?: boolean
  style?: CSSProperties
}) {
  const rowH = compact ? 23 : 28
  const fill = Math.max(0, (minRows ?? (height ? Math.ceil((height - 34) / rowH) : 0)) - rows.length)
  const total = cols.reduce((s, c) => s + c.width, 0) + (checkbox ? 20 : 0)
  return (
    <div className={`ma-grid${compact ? ' is-compact' : ''}`} style={{ height, width, ...style }}>
      <table style={{ width: fillWidth ? '100%' : total, minWidth: total }}>
        <colgroup>
          {checkbox && <col style={{ width: 20 }} />}
          {cols.map((c, i) => (
            <col key={c.key} style={{ width: fillWidth && i === cols.length - 1 ? undefined : c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {checkbox && <th className={`chk${yellowCheckHeader ? ' is-yellow' : ''}`} />}
            {cols.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'r' : undefined} title={c.label}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={`is-data${selected === r.id ? ' is-selected' : ''}`}
              onClick={() => onSelect?.(r.id)}
              onDoubleClick={() => onOpen?.(r.id)}
            >
              {checkbox && (
                <td className="chk">
                  <span
                    className={`cbox${checked?.has(r.id) ? ' is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCheck?.(r.id)
                    }}
                  />
                </td>
              )}
              {cols.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'r' : undefined}>
                  {r.cells[c.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
          {Array.from({ length: fill }, (_, i) => (
            <tr key={`f${i}`}>
              {checkbox && <td className="chk" />}
              {cols.map((c) => (
                <td key={c.key} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Thin scroll strip drawn under legacy grids. */
export function HScroll({ thumb = 0.5 }: { thumb?: number }) {
  return (
    <div className="ma-hscroll ma-noprint">
      <span className="arr">◂</span>
      <span style={{ flex: 1, display: 'flex' }}>
        <span className="thumb" style={{ flex: `0 0 ${Math.round(thumb * 100)}%` }}>
          ||||
        </span>
      </span>
      <span className="arr">▸</span>
    </div>
  )
}

/** Orange single-move arrows and green move-all arrows between two lists. */
export function TransferArrows({
  onRight,
  onLeft,
  onAllRight,
  onAllLeft,
  gap = 18,
}: {
  onRight?: () => void
  onLeft?: () => void
  onAllRight?: () => void
  onAllLeft?: () => void
  gap?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap }}>
      {onRight && (
        <IBtn bare title="Move selected" onClick={onRight}>
          <OrangeArrow dir="right" />
        </IBtn>
      )}
      {onLeft && (
        <IBtn bare title="Remove selected" onClick={onLeft}>
          <OrangeArrow dir="left" />
        </IBtn>
      )}
      {onAllRight && (
        <button type="button" className="ma-ibtn is-bare" style={{ width: 36, height: 36 }} title="Move all" onClick={onAllRight}>
          <GreenArrow dir="right" />
        </button>
      )}
      {onAllLeft && (
        <button type="button" className="ma-ibtn is-bare" style={{ width: 36, height: 36 }} title="Remove all" onClick={onAllLeft}>
          <GreenArrow dir="left" />
        </button>
      )}
    </div>
  )
}

/** Dialog window in the old blue-titlebar style. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="ma-modal-back" onMouseDown={onClose}>
      <div className="ma-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ma-modal-head">
          <span>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ma-modal-body">{children}</div>
        {footer && <div className="ma-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Two-list chooser (left = available, right = chosen) used across reports. */
export function useTransfer<T extends string | number>(all: T[]) {
  const [chosen, setChosen] = useState<T[]>([])
  const [pickLeft, setPickLeft] = useState<T | undefined>()
  const [pickRight, setPickRight] = useState<T | undefined>()
  const available = all.filter((a) => !chosen.includes(a))
  return {
    available,
    chosen,
    pickLeft,
    pickRight,
    setPickLeft,
    setPickRight,
    right: () => {
      if (pickLeft !== undefined && !chosen.includes(pickLeft)) setChosen([...chosen, pickLeft])
      setPickLeft(undefined)
    },
    left: () => {
      if (pickRight !== undefined) setChosen(chosen.filter((c) => c !== pickRight))
      setPickRight(undefined)
    },
    allRight: () => setChosen([...all]),
    allLeft: () => setChosen([]),
    setChosen,
  }
}

/** Filter helper for the search bars above grids. */
export function matches(q: string, ...vals: (string | number | undefined)[]): boolean {
  if (!q.trim()) return true
  const s = q.trim().toLowerCase()
  return vals.some((v) => v !== undefined && String(v).toLowerCase().includes(s))
}
