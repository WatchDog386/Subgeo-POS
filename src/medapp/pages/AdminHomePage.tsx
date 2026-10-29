import { useState } from 'react'
import { C } from './reportKit'
import { Grid } from '../ui'
import { At, Canvas, Title } from './layout'
import { FolderIcon, FileIcon } from '../icons'

const COLS = [
  C('transaction', 'Transaction', 110),
  C('doc', 'Doc', 70),
  C('docDate', 'Doc Date', 100),
  C('task', 'Task', 150),
  C('assigner', 'Assigner', 100),
  C('assignee', 'Assignee', 100),
  C('status', 'Status', 80),
]
const EMPTY = Array.from({ length: 20 }, (_, i) => ({ id: i, cells: { transaction: '', doc: '', docDate: '', task: '', assigner: '', assignee: '', status: '' } }))

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ma-tab${active ? ' is-active' : ''}`}
      style={{ height: 26, padding: '0 10px', fontSize: 11, border: '1px solid #c8c8c8', background: active ? '#fff' : '#e8e8e8' }}
    >
      {label}
    </button>
  )
}

function SidePanel({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 6, border: '1px solid #b7b19d', background: '#f6f5ef' }}>
      <div
        className="ma-group-head"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', userSelect: 'none', fontStyle: 'normal' }}
      >
        {title}
      </div>
      {open && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: '#333' }}>
          {items.map((it, i) => (
            <div key={i} style={{ padding: '2px 0', color: '#1a9be6', cursor: 'pointer' }}>
              {it}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminHomePage() {
  const [tab, setTab] = useState<'PENDING' | 'COMPLETED'>('PENDING')
  const [q, setQ] = useState('')

  return (
    <Canvas height={760}>
      <Title x={14} y={30}>
        To-Do List
      </Title>
      <At x={14} y={66}>
        <TabButton active={tab === 'PENDING'} label="To-Do List" onClick={() => setTab('PENDING')} />
        <TabButton active={tab === 'PENDING'} label="Task To-Do" onClick={() => setTab('PENDING')} />
        <TabButton active={tab === 'COMPLETED'} label="Pending-Completed" onClick={() => setTab('COMPLETED')} />
      </At>
      <At x={14} y={106} top>
        <div style={{ width: 492 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, marginBottom: 3 }}>
            <span className="ma-search" style={{ width: 170 }}>
              <span className="ma-search-ico">
                <FolderIcon />
              </span>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            </span>
            <span style={{ marginLeft: 'auto' }} className="ma-label">
              {tab === 'PENDING' ? 'PENDING' : 'COMPLETED'} &nbsp;|&nbsp; 0 rows retrieved |
            </span>
          </div>
          <Grid
            cols={COLS}
            rows={EMPTY}
            height={360}
            width={492}
          />
        </div>
      </At>
      <At x={514} y={106} top>
        <div style={{ width: 492 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, marginBottom: 3 }}>
            <span className="ma-search" style={{ width: 170 }}>
              <span className="ma-search-ico">
                <FileIcon />
              </span>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            </span>
            <span style={{ marginLeft: 'auto' }} className="ma-label">
              COMPLETED &nbsp;|&nbsp; 0 rows retrieved |
            </span>
          </div>
          <Grid cols={COLS} rows={EMPTY} height={360} width={492} />
        </div>
      </At>
      <At x={14} y={496} top>
        <SidePanel title="Quick Access" items={['OTC Medicine Issued/Bill', 'OTC Medicine Isse Return', 'Service Request/Bill', 'Sales Quotation', 'Delivery Note', 'Whole Sale Invoice']} />
      </At>
      <At x={210} y={496} top>
        <SidePanel title="Statistics" items={['Month-Wise Analysis', 'Stock Report', 'Price Comparison Statement', 'Outstanding Report']} />
      </At>
      <At x={390} y={496} top>
        <SidePanel title="Favourite Transactions" items={['Medicine Returns', 'Stock Entry (Opening)', 'Stock Adjust -']} />
      </At>
      <At x={560} y={496} top>
        <SidePanel title="Reports" items={['OS Debtor', 'OS Creditor', 'All Debtor Ageing', 'Cash Collection']} />
      </At>
      <At x={700} y={496} top>
        <SidePanel title="Charts" items={['Month-Wise Analysis', 'ABC Analysis']} />
      </At>
      <At x={830} y={496} top>
        <SidePanel title="Utilities" items={['User Management', 'Data Management', 'Settings']} />
      </At>
    </Canvas>
  )
}
