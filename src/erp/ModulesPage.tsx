import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Eye, Filter, ChevronRight } from 'lucide-react'
import { db } from '../db/db'
import type { Sale, ServiceJob, Customer, Supplier } from '../db/types'
import { ErpPanel, ErpEmptyRow } from './piLists'
import { money } from '../lib/money'
import { MODULE_GROUPS } from './erpNav'

// Modules screen mirroring the old medapp: after picking a transaction from
// the sidebar, the work area shows the document list with the toolbar
// (New, View, Find, Filter), the medapp columns and the orange quick-actions
// strip at the bottom.

type ModuleKind =
  | 'otc-bill' | 'otc-return' | 'service' | 'invoice' | 'party' | 'services-master' | 'lpo'

const ITEMS: Record<string, { kind: ModuleKind; title: string }> = {
  'OTC Medicine Issued/Bill': { kind: 'otc-bill', title: 'OTC Medicine Issued/Bill' },
  'OTC Medicine Issue Return': { kind: 'otc-return', title: 'OTC Medicine Issue Return' },
  'Service Request/Bill': { kind: 'service', title: 'Service Request/Bill' },
  'Sales Quotation': { kind: 'invoice', title: 'Sales Quotation' },
  'Delivery Note': { kind: 'invoice', title: 'Delivery Note' },
  'Credit Note': { kind: 'otc-return', title: 'Credit Note' },
  'Whole Sale Invoice': { kind: 'invoice', title: 'Whole Sale Invoice' },
  'Credit Note - Direct Invoice': { kind: 'invoice', title: 'Credit Note - Direct Invoice' },
  'Final Bill Receipt': { kind: 'invoice', title: 'Final Bill Receipt' },
  'Party Master': { kind: 'party', title: 'Party Master' },
  'Services Master': { kind: 'services-master', title: 'Services Master' },
  'Local Purchase Order / GRN': { kind: 'lpo', title: 'Local Purchase Order / GRN' },
}

export default function ErpModulesPage() {
  const { label: slug } = useParams()
  return slug ? <ErpModules label={decodeURIComponent(slug)} /> : <AllModulesOverview />
}

function ErpModules({ label }: { label: string }) {
  const nav = useNavigate()
  const sales = useLiveQuery(() => db.sales.orderBy('createdAt').reverse().limit(12).toArray(), [])
  const jobs = useLiveQuery(() => db.jobs.orderBy('createdAt').reverse().limit(12).toArray(), [])
  const party = useLiveQuery(
    async () => {
      const [customers, suppliers] = await Promise.all([db.customers.toArray(), db.suppliers.toArray()])
      return [...customers, ...suppliers]
    },
    [],
  )

  // Route param decoded above drives the active module document screen.
  const active = ITEMS[label] ?? ITEMS['OTC Medicine Issued/Bill']
  const docPrefix =
    active.kind === 'service' ? 'CHPL-SVC' : active.kind === 'invoice' ? 'CHPL-WS' : active.kind === 'lpo' ? 'CHPL-PO' : 'CHPL-OTC'

  return (
    <div className="space-y-3">
      <ErpPanel
        title={active.title}
        actions={
          <>
            <button type="button" onClick={() => nav(active.kind === 'service' ? '/service' : active.kind === 'party' ? '/customers' : active.kind === 'services-master' ? '/products' : active.kind === 'lpo' ? '/purchasing' : '/sell')} className="flex items-center gap-1 rounded-none min-h-[56px] border border-[#5c8f31] bg-[#76b043] px-6 text-[17px] font-bold text-white shadow-sm transition hover:bg-[#6da53c] active:scale-95">
              <Plus size={14} /> New
            </button>
            <button type="button" onClick={() => nav(active.kind === 'service' ? '/service' : active.kind === 'party' ? '/customers' : active.kind === 'services-master' ? '/products' : active.kind === 'lpo' ? '/purchasing' : '/sales')} className="flex items-center gap-1 rounded-none min-h-[56px] border border-[#969ea4] bg-gradient-to-b from-[#d3d9dc] to-[#bcc3c8] px-6 text-[17px] font-bold text-[#333b3f] shadow-sm transition hover:brightness-105">
              <Eye size={14} /> View
            </button>
            <button type="button" className="flex items-center gap-1 rounded-none min-h-[56px] border border-[#969ea4] bg-gradient-to-b from-[#d3d9dc] to-[#bcc3c8] px-6 text-[17px] font-bold text-[#333b3f] shadow-sm transition hover:brightness-105">
              <Filter size={14} /> Filter
            </button>
          </>
        }
      >
        <div className="min-h-[26rem] space-y-2">
          {active.kind === 'service' ? (
            <ModuleJobs jobs={jobs ?? []} />
          ) : active.kind === 'party' ? (
            <ModuleParty parties={party ?? []} />
          ) : (
            <ModuleSales
              sales={sales ?? []}
              kind={active.kind}
              title={active.title}
              prefix={docPrefix}
            />
          )}
        </div>
      </ErpPanel>
    </div>
  )
}

function ModuleSales({
  sales,
  kind,
  title,
  prefix,
}: {
  sales: Sale[]
  kind: ModuleKind
  title: string
  prefix: string
}) {
  const nav = useNavigate()
  const rows = sales.filter((s) => (kind === 'otc-return' ? s.status === 'refunded' || s.status === 'partially_refunded' : kind === 'invoice' ? s.status === 'completed' && s.customerId !== undefined : s.status === 'completed'))
  return (
    <div className="overflow-x-auto rounded-none border border-slate-300 bg-white shadow-sm">
      <table className="w-full border-collapse text-[15px] text-[#2b3337]">
        <thead>
          <tr className="bg-[#dcdcd2] text-left text-[14px] font-semibold text-[#2c2a27]">
            <th className="border-b border-slate-300 px-2 py-1.5">Bill No</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Date</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Patient Category</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Payable By</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Narration</th>
            <th className="border-b border-slate-300 px-2 py-1.5 text-right">Bill Amount</th>
            <th className="border-b border-slate-300 px-2 py-1.5">User Name</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <ErpEmptyRow cols={7} />
          ) : (
            rows.map((s, i) => (
              <tr
                key={s.id}
                onClick={() => nav('/sales')}
                className={`cursor-pointer border-b border-[#d6d2c8] transition hover:bg-[#eef2a8] ${i % 2 ? 'bg-white' : 'bg-[#f0ede2]'}`}
              >
                <td className="px-3 py-2 font-mono text-[14px]">{prefix}-{String(s.id ?? 0).padStart(3, '0')}</td>
                <td className="px-2 py-1.5">{new Date(s.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td className="px-2 py-1.5">OTC CLIENTS</td>
                <td className="px-2 py-1.5">{s.payments[0] ? (s.payments[0].method === 'account' ? 'CREDIT ACCOUNT' : s.payments[0].method.toUpperCase()) : 'CASH'}</td>
                <td className="px-2 py-1.5 text-slate-500">{s.note ?? title}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(s.total, '')}</td>
                <td className="px-2 py-1.5">{s.userId}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-1 border-t border-slate-300 bg-[#e4e7e9] px-2 py-1.5 text-slate-600">
        {['Delete', 'New', 'Edit', 'View', 'Copy', 'Print', 'Export'].map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => nav(a === 'New' ? '/sell' : '/sales')}
            className="rounded-none bg-gradient-to-b from-[#f6b352] to-[#e08c1a] px-2.5 py-1 text-[11px] font-bold text-slate-900 shadow-sm transition hover:brightness-105 active:scale-95"
          >
            {a}
          </button>
        ))}
        <span className="ml-auto text-[11px] font-semibold">| {rows.length} rows retrieved |</span>
      </div>
    </div>
  )
}

function ModuleJobs({ jobs }: { jobs: ServiceJob[] }) {
  const nav = useNavigate()
  if (jobs.length === 0) {
    return (
      <div className="rounded-none border border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
        No service requests yet.
        <button type="button" onClick={() => nav('/service')} className="mx-1 font-bold text-[#3b74b8] underline">
          Raise one
        </button>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-none border border-slate-300 bg-white shadow-sm">
      <table className="w-full border-collapse text-[15px] text-[#2b3337]">
        <thead>
          <tr className="bg-[#dcdcd2] text-left text-[14px] font-semibold text-[#2c2a27]">
            <th className="border-b border-slate-300 px-2 py-1.5">Request No</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Party</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Service Request</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Status</th>
            <th className="border-b border-slate-300 px-2 py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j, i) => (
            <tr key={j.id} onClick={() => nav('/service')} className={`cursor-pointer border-b border-[#d6d2c8] transition hover:bg-[#eef2a8] ${i % 2 ? 'bg-white' : 'bg-[#f0ede2]'}`}>
              <td className="px-3 py-2 font-mono text-[14px]">{j.jobNo}</td>
              <td className="px-2 py-1.5">{j.customerName}</td>
              <td className="px-2 py-1.5">{j.complaint}</td>
              <td className="px-2 py-1.5 capitalize">{j.status.replace('_', ' ')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(j.labour + j.lines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0), '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModuleParty({ parties }: { parties: (Customer | Supplier)[] }) {
  const nav = useNavigate()
  return (
    <div className="overflow-x-auto rounded-none border border-slate-300 bg-white shadow-sm">
      <table className="w-full border-collapse text-[15px] text-[#2b3337]">
        <thead>
          <tr className="bg-[#dcdcd2] text-left text-[14px] font-semibold text-[#2c2a27]">
            <th className="border-b border-slate-300 px-2 py-1.5">Party Code</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Party Name</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Phone</th>
            <th className="border-b border-slate-300 px-2 py-1.5">Email</th>
          </tr>
        </thead>
        <tbody>
          {parties.length === 0 ? (
            <ErpEmptyRow cols={4} />
          ) : (
            parties.map((p, i) => (
              <tr key={p.id} onClick={() => nav('/customers')} className={`cursor-pointer border-b border-[#d6d2c8] transition hover:bg-[#eef2a8] ${i % 2 ? 'bg-white' : 'bg-[#f0ede2]'}`}>
                <td className="px-3 py-2 font-mono text-[14px]">{p.id ? `PTY${String(p.id).padStart(4, '0')}` : '—'}</td>
                <td className="px-2 py-1.5 font-semibold">{p.name}</td>
                <td className="px-2 py-1.5">{p.phone ?? '—'}</td>
                <td className="px-2 py-1.5">{p.email ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ModulePickerCard({ label }: { label: string }) {
  const nav = useNavigate()
  return (
    <button
      type="button"
      onClick={() => nav(`/modules/${encodeURIComponent(label)}`)}
      className="flex w-full items-center justify-between rounded-none border border-[#c7ccd0] bg-white px-3 py-2.5 text-left text-[15px] font-semibold text-[#2b3337] shadow-sm transition hover:border-[#969ea4] hover:bg-[#f3f4f5]"
    >
      {label}
      <ChevronRight size={16} className="text-slate-400" />
    </button>
  )
}

export function AllModulesOverview() {
  return (
    <div className="space-y-4">
      {MODULE_GROUPS.map((g) => (
        <ErpPanel key={g.label} title={g.label}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((it) => (
              <ModulePickerCard key={it.label} label={it.label} />
            ))}
          </div>
        </ErpPanel>
      ))}
    </div>
  )
}
