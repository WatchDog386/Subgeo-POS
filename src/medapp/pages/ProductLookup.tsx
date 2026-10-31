// "LookUp Box": pick a medicine from the open chemist's list (legacy screenshot:
// Product Name · Product Code · Cost Rate, search by name / code / cost, + new).
import { useMemo, useState } from 'react'
import type { Product } from '../../db/types'
import { Dialog, Radio, SearchBar } from '../ui'

type By = 'name' | 'code' | 'cost'

export function ProductLookup({ products, onPick, onClose, onNew, title = 'LookUp Box' }: { products: Product[]; onPick: (p: Product) => void; onClose: () => void; onNew?: (typed: string) => void; title?: string }) {
  const [q, setQ] = useState('')
  const [by, setBy] = useState<By>('name')
  const [sel, setSel] = useState(0)
  const list = useMemo(() => {
    const t = q.trim().toUpperCase()
    return [...products]
      .filter((p) => {
        if (!t) return true
        if (by === 'code') return p.sku.toUpperCase().includes(t) || (p.barcode ?? '').toUpperCase().includes(t)
        if (by === 'cost') return (p.cost / 100).toFixed(2).startsWith(t.replace(/^0+(?=\d)/, ''))
        return p.name.toUpperCase().includes(t)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, q, by])
  const pick = (p: Product | undefined) => p && onPick(p)
  return (
    <Dialog title={title} onClose={onClose} width={560}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SearchBar
          value={q}
          onChange={(v) => {
            setQ(v)
            setSel(0)
          }}
          width={230}
          autoFocus
          onEnter={() => pick(list[sel])}
        />
        <span className="ma-rows" style={{ marginLeft: 'auto' }}>
          | {list.length}
        </span>
      </div>
      <div
        style={{ height: 280, overflow: 'auto', border: '1px solid #c3c3c3', marginTop: 6, background: '#fff' }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((i) => Math.min(list.length - 1, i + 1))
          else if (e.key === 'ArrowUp') setSel((i) => Math.max(0, i - 1))
          else if (e.key === 'Enter') pick(list[sel])
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead>
            <tr>
              {['Product Name', 'Product Code', 'Cost Rate', 'In Stock'].map((h, i) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#e9e9e9', textAlign: i >= 2 ? 'right' : 'left', padding: '5px 6px', borderBottom: '1px solid #bbb' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 500).map((p, i) => (
              <tr
                key={p.id}
                style={{ background: i === sel ? '#f2dd6b' : i % 2 ? '#fff' : '#f6f5ea', cursor: 'pointer' }}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(p)}
                aria-label={`Pick ${p.name}`}
              >
                <td style={{ padding: '5px 6px' }}>{p.name}</td>
                <td style={{ padding: '5px 6px' }}>{p.sku}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{(p.cost / 100).toFixed(2)}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{p.trackStock ? p.stock : '—'}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={4} style={{ padding: 10, color: '#888' }}>
                  No medicine matches. {onNew ? 'Press + to add it.' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        {onNew && (
          <button type="button" className="ma-ibtn" title="Add a new medicine" aria-label="Add a new medicine" onClick={() => onNew(q.trim())}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <circle cx="9" cy="9" r="8" fill="#43a047" />
              <path d="M9 4.5v9M4.5 9h9" stroke="#fff" strokeWidth="2.2" />
            </svg>
          </button>
        )}
        <Radio name="lk-by" checked={by === 'name'} onChange={() => setBy('name')}>
          Product Name
        </Radio>
        <Radio name="lk-by" checked={by === 'code'} onChange={() => setBy('code')}>
          Product Code
        </Radio>
        <Radio name="lk-by" checked={by === 'cost'} onChange={() => setBy('cost')}>
          Cost Rate
        </Radio>
      </div>
    </Dialog>
  )
}
