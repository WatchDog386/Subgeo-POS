import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, ArrowLeft, Search } from 'lucide-react'

// ---------------------------------------------------------------------------
// Low-level pieces shared by ERP pages: the filterable pick lists with the
// left/right move buttons (classic medapp report style), striped result
// tables and the "| N rows retrieved |" counter.
// ---------------------------------------------------------------------------

export function SearchResultNote({
  count,
  className = '',
}: {
  count: number
  className?: string
}) {
  return (
    <div className={`text-right text-xs font-semibold text-slate-500 ${className}`}>
      |&nbsp;{count} {count === 1 ? 'row' : 'rows'} retrieved&nbsp;|
    </div>
  )
}

function ListPicker({
  title,
  items,
  selected,
  onSelect,
  render,
  query,
  onQuery,
}: {
  title: string
  items: string[]
  selected: string[]
  onSelect: (next: string[]) => void
  render?: (item: string) => ReactNode
  query?: string
  onQuery?: (q: string) => void
}) {
  const shown = useMemo(
    () => (query && query.trim() ? items.filter((i) => i.toLowerCase().includes(query.trim())) : items),
    [items, query],
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-sm border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-slate-300 bg-slate-100 px-2 py-1.5">
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          value={query ?? ''}
          onChange={(e) => onQuery?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          placeholder="Search…"
        />
      </div>
      <div className="border-b border-slate-300 bg-gradient-to-b from-slate-50 to-slate-200 px-2 py-1 text-[13px] font-bold text-slate-600">
        {title}
      </div>
      <div className="erp-scroll max-h-64 min-h-[8rem] flex-1 overflow-auto">
        <ul>
          {shown.map((item, i) => {
            const isOn = selected.includes(item)
            return (
              <li key={item}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect(isOn ? selected.filter((x) => x !== item) : [...selected, item])
                  }
                  className={`w-full px-2 py-1 text-left text-[15px] transition ${
                    isOn ? 'bg-[#f0a848] text-[#1f272b]' : i % 2 ? 'bg-white hover:bg-[#eef2a8]' : 'bg-[#f0ede2] hover:bg-[#eef2a8]'
                  }`}
                >
                  {render ? render(item) : item}
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="py-4 text-center text-xs text-slate-400">empty</li>}
        </ul>
      </div>
    </div>
  )
}

/** Left/right multi-select lists with move buttons between them. */
export function PickTwo({
  title,
  options,
  value,
  onChange,
  render,
}: {
  title: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  render?: (item: string) => ReactNode
}) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const remaining = options.filter((x) => !value.includes(x))
  const rightSel = sel.filter((x) => !remaining.includes(x))
  const leftSel = sel.filter((x) => remaining.includes(x))
  return (
    <div className="flex items-stretch gap-2">
      <ListPicker
        title={title}
        items={remaining}
        selected={leftSel}
        onSelect={(next) => setSel([...next, ...rightSel])}
        render={render}
        query={query}
        onQuery={setQuery}
      />
      <div className="flex flex-col items-center justify-center gap-2 py-2">
        <button
          type="button"
          disabled={leftSel.length === 0}
          onClick={() => {
            onChange([...value, ...leftSel])
            setSel(rightSel)
          }}
          title="Add selected"
          className="rounded-sm bg-amber-500 p-1 text-white shadow enabled:hover:brightness-110 disabled:opacity-40"
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          disabled={value.length === 0}
          onClick={() => {
            onChange([...value, ...remaining])
          }}
          title="Add all"
          className="rounded-full bg-emerald-600 p-1.5 text-white shadow enabled:hover:brightness-110 disabled:opacity-40"
        >
          <ArrowRight size={14} className="rounded-full border border-white/70" />
        </button>
        <button
          type="button"
          disabled={rightSel.length === 0}
          onClick={() => {
            onChange(value.filter((x) => !rightSel.includes(x)))
            setSel(leftSel)
          }}
          title="Remove selected"
          className="rounded-sm bg-orange-600 p-1 text-white shadow enabled:hover:brightness-110 disabled:opacity-40"
        >
          <ArrowLeft size={16} />
        </button>
      </div>
      <ListPicker
        title="Selected"
        items={value}
        selected={rightSel}
        onSelect={(next) => setSel([...next, ...leftSel])}
        render={render}
        query={undefined}
        onQuery={undefined}
      />
    </div>
  )
}

/** Striped medapp-style results table. */
export function ErpTable({
  columns,
  children,
  className = '',
}: {
  columns: { label: string; align?: 'left' | 'right' | 'center' }[]
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`overflow-x-auto rounded-[4px] border border-[#b6b1a8] bg-white shadow-sm ${className}`}>
      <table className="w-full border-collapse text-[12.5px] text-[#2c2a27]">
        <thead>
          <tr className="bg-[#dcdcd2] text-left text-[12px] font-semibold text-[#2c2a27]">
            {columns.map((c) => (
              <th
                key={c.label}
                className={`whitespace-nowrap border-b border-[#b6b1a8] px-2 py-1.5 ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function ErpEmptyRow({ cols }: { cols: number }) {
  return (
    <tr className="bg-white">
      <td colSpan={cols} className="px-2 py-6 text-center text-xs text-slate-400">
        No data for the selected filters
      </td>
    </tr>
  )
}

export function ErpPanel({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-[4px] border border-[#c7ccd0] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6e9ea] bg-white px-3 py-2">
        <h2 className="text-[17px] font-bold text-[#1f272b]">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-3 bg-[#e4e7e9] p-3">{children}</div>
    </section>
  )
}
