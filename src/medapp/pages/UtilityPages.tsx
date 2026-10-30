import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { SYNCED_TABLES, db } from '../../db/db'
import { getSyncState, syncNow, useSyncState } from '../../db/sync'
import { exportBackup, restoreBackup } from '../../db/backup'
import { getSettings, saveSettings } from '../../db/settings'
import { logActivity } from '../../db/logs'
import { createPurchaseOrder } from '../../db/purchasing'
import type { Branch, Customer, Product, Role, Sale, ServiceJob, Settings, Supplier, User } from '../../db/types'
import { chemCode } from '../../db/seedData'
import { saveStaff } from '../../db/staff'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { download, downloadCsv, parseCsv } from '../../lib/csv'
import { amt, dmy, getKv, nextDocNo, parseDmy, saveDoc, setKv, useDocs, useKv, useMedDefaults, yy } from '../data'
import { CheckGreenIcon, OrangeArrow, SearchLens } from '../icons'
import { Btn, Check, Dialog, Grid, IBtn, Input, LookupField, matches, PickList, Radio, Rows, SearchBar, Select, TransferArrows, useTransfer, type Col, type Row } from '../ui'
import { At, Canvas, L, Title } from './layout'
import { ResultDialog } from './reportKit'
import ChemistsPage from './ChemistsPage'

const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })
const num = (v: string) => parseFloat(v) || 0
const today = () => dmy(Date.now())

/** Grey group box reused by several utilities. */
function Group({ title, x = 10, y = 44, w = 990, h, children }: { title?: string; x?: number; y?: number; w?: number; h?: number; children: ReactNode }) {
  return (
    <div className="ma-group" style={{ position: 'absolute', left: x, top: y, width: w, height: h }}>
      {title && <div className="ma-group-head">{title}</div>}
      <div style={{ padding: '10px 12px' }}>{children}</div>
    </div>
  )
}

function List({ items, width, height, value, onSelect }: { items: string[]; width: number; height: number; value?: string; onSelect?: (v: string) => void }) {
  const [q, setQ] = useState('')
  const list = items.filter((i) => i.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={{ width }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, marginBottom: 2 }}>
        <span className="ma-search" style={{ width: 84 }}>
          <span className="ma-search-ico">
            <SearchLens size={18} />
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </span>
        <span style={{ marginLeft: 'auto' }} className="ma-label">
          {list.length}
        </span>
      </div>
      <div className="ma-listbox" style={{ height, width }}>
        {list.length === 0 && <div className="li" style={{ color: '#888', cursor: 'default' }}>No records</div>}
        {list.map((i) => (
          <div key={i} className={`li${value === i ? ' is-selected' : ''}`} onClick={() => onSelect?.(i)}>
            {i}
          </div>
        ))}
      </div>
    </div>
  )
}

function useProducts(): Product[] {
  return useLiveQuery(async () => (await db.products.toArray()).filter((p) => p.active && p.trackStock).sort((a, b) => a.name.localeCompare(b.name)), [], [] as Product[])
}

/* ═══════════════════════════════ AUTO GENERATE ════════════════════════════ */
function AutoGenerate() {
  const toast = useToast()
  const products = useProducts()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pick, setPick] = useState<'from' | 'to' | null>(null)
  const shown = products.filter((p) => p.stock <= p.reorderLevel && (!from || p.name.toUpperCase() >= from) && (!to || p.name.toUpperCase() <= to))

  const generate = async () => {
    if (!shown.length) return toast('Nothing to generate', 'error')
    const po = await createPurchaseOrder(shown.map((p) => ({ productId: p.id!, qty: Math.max(1, p.reorderLevel * 2 - p.stock), unitCost: p.cost, received: 0 })))
    await logActivity('stock', `Auto Generate draft ${po?.poNo}`, { detail: `${shown.length} products` })
    toast(`Purchase order ${po?.poNo} drafted`)
  }

  return (
    <Canvas height={620}>
      <Title x={110} y={26}>Auto Generate</Title>
      <At x={14} y={80}>
        <L>From</L>
        <Input value={from} onChange={setFrom} width={186} readOnly />
        <IBtn title="Select" onClick={() => setPick('from')}><OrangeArrow dir="right" /></IBtn>
        <L>To</L>
        <Input value={to} onChange={setTo} width={186} readOnly />
        <IBtn title="Select" onClick={() => setPick('to')}><OrangeArrow dir="right" /></IBtn>
      </At>
      <At x={834} y={80}>
        <Btn style={{ width: 78 }} onClick={() => setPick(null)}>Search</Btn>
      </At>
      <At x={14} y={130}>
        <span className="ma-label">No. of Products : </span>
        {products.length}
      </At>
      <At x={14} y={160} top>
        <Grid
          cols={[C('name', 'Product Name', 380), C('code', 'Product Code', 190), C('stock', 'Qty In Hand', 90, 'right'), C('re', 'Re-Order Lvl', 90, 'right')]}
          rows={shown.map((p) => ({ id: p.id!, cells: { name: p.name, code: p.sku, stock: String(p.stock), re: String(p.reorderLevel) } }))}
          height={310}
          width={760}
        />
      </At>
      <At x={14} y={545}>
        <Btn style={{ width: 85 }} onClick={generate}>Generate</Btn>
      </At>
      {pick && (
        <PickList
          title={pick === 'from' ? 'From Product' : 'To Product'}
          options={products.map((p) => p.name.toUpperCase())}
          onClose={() => setPick(null)}
          onPick={(v) => {
            if (pick === 'from') setFrom(v)
            else setTo(v)
            setPick(null)
          }}
        />
      )}
    </Canvas>
  )
}

/* ═══════════════════════════════ AUTO INDENT ══════════════════════════════ */
function AutoIndent() {
  const toast = useToast()
  const d = useMedDefaults()
  const products = useProducts()
  const [from, setFrom] = useState(dmy(Date.now() - 30 * 864e5))
  const [to, setTo] = useState(today())
  const [shown, setShown] = useState<Row[]>([])
  const soldQty = useLiveQuery(async () => {
    const all = await db.sales.where('createdAt').between(parseDmy(from) ?? 0, (parseDmy(to) ?? Date.now()) + 864e5).toArray()
    const qty = new Map<number, number>()
    for (const s of all.filter((s) => s.status !== 'refunded' && s.status !== 'voided')) {
      for (const l of s.lines) if (l.productId) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty)
    }
    return qty
  }, [from, to])

  const build = () => {
    const sold = soldQty ?? new Map<number, number>()
    setShown(
      products
        .filter((p) => (sold.get(p.id!) ?? 0) > 0 && p.stock <= p.reorderLevel)
        .map((p) => ({ id: p.id!, cells: { name: p.name, sold: String(sold.get(p.id!) ?? 0), stock: String(p.stock), suggest: String(Math.max(1, p.reorderLevel * 2 - p.stock)) } })),
    )
  }

  const generate = async () => {
    if (!shown.length) return toast('Run Show first', 'error')
    const po = await createPurchaseOrder(shown.map((r) => ({ productId: r.id as number, qty: Math.max(1, parseInt(String(r.cells.suggest), 10) || 1), unitCost: products.find((p) => p.id === r.id)?.cost ?? 0, received: 0 })))
    await logActivity('stock', `Auto Indent draft ${po?.poNo}`, { detail: `${shown.length} products, ${from}..${to}` })
    toast(`Purchase order ${po?.poNo} drafted`)
  }

  return (
    <Canvas height={620}>
      <Title x={95} y={26}>Auto Indent</Title>
      <At x={14} y={80}>
        <L>From Date</L>
        <Input value={from} onChange={setFrom} width={70} />
        <L>To Date</L>
        <Input value={to} onChange={setTo} width={70} />
      </At>
      <At x={330} y={80}>
        <L>Location</L>
        <Select value={d.location} onChange={() => {}} options={[d.location]} width={130} disabled />
      </At>
      <At x={14} y={130}>
        <Btn style={{ width: 78 }} onClick={build}>Show</Btn>
      </At>
      <At x={14} y={160} top>
        <Grid cols={[C('name', 'Product Name', 340), C('sold', 'Qty Sold', 90, 'right'), C('stock', 'Qty In Hand', 90, 'right'), C('suggest', 'Suggest Qty', 90, 'right')]} rows={shown} height={320} width={640} />
      </At>
      <At x={14} y={545}>
        <Btn style={{ width: 85 }} onClick={generate}>Generate</Btn>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════════════ DOCUMENT CENTER ══════════════════════════ */
interface ManualDoc {
  name: string
  at: number
  dataUrl: string
}
function DocumentCenter() {
  const toast = useToast()
  const [sno, setSno] = useState('')
  const [find, setFind] = useState('')
  const [manual, setManual] = useState<ManualDoc[]>([])
  const sales = useLiveQuery(() => db.sales.toArray(), [], [] as Sale[])
  const jobs = useLiveQuery(() => db.jobs.toArray(), [], [] as ServiceJob[])

  const lookup = () => {
    const s = sno.trim().toUpperCase()
    void getKv<ManualDoc[]>(`medapp:manual:${s}`, []).then(setManual)
    if (sales.some((x) => x.receiptNo.toUpperCase() === s) || jobs.some((x) => x.jobNo.toUpperCase() === s)) setFind(s)
    else {
      setFind('')
      toast('No System Generated Documents found', 'error')
    }
  }

  const sysRows: Row[] = find
    ? sales.some((x) => x.receiptNo.toUpperCase() === find)
      ? [
          { id: 1, cells: { no: find, type: 'Bill Receipt', on: 'System Generated' } },
          { id: 2, cells: { no: find, type: 'Sales Invoice', on: 'System Generated' } },
        ]
      : [
          { id: 1, cells: { no: find, type: 'Job Card', on: 'System Generated' } },
          { id: 2, cells: { no: find, type: 'Service Invoice', on: 'System Generated' } },
        ]
    : []

  const attach = (file: File) => {
    if (!find) return toast('Lookup a SCM No first', 'error')
    const reader = new FileReader()
    reader.onload = async () => {
      const key = `medapp:manual:${find}`
      const list = await getKv<ManualDoc[]>(key, [])
      const next = [...list, { name: file.name, at: Date.now(), dataUrl: String(reader.result) }]
      await setKv(key, next)
      setManual(next)
    }
    reader.readAsDataURL(file)
  }

  return (
    <Canvas height={640}>
      <Title x={108} y={26}>Document Center</Title>
      <At x={14} y={82}>
        <L>Enter SCM No</L>
        <LookupField value={sno} onChange={setSno} options={[...sales.map((s) => s.receiptNo.toUpperCase()), ...jobs.map((j) => j.jobNo.toUpperCase())]} width={150} title="SCM No" />
        <Btn style={{ width: 100 }} onClick={lookup}>Generate All</Btn>
      </At>
      {find && (
        <>
          <At x={14} y={140}>
            <L bold>System Generated Documents</L>
          </At>
          <At x={14} y={168} top>
            <Grid
              cols={[C('no', 'Doc No', 130), C('type', 'Document Type', 180), C('on', 'Generated On', 160), C('_', '', 80)]}
              rows={sysRows.map((r) => ({ ...r, cells: { ...r.cells, _: <Btn style={{ height: 19 }} onClick={() => window.print()}>Print</Btn> } }))}
              height={92}
              compact
              width={584}
            />
          </At>
          <At x={14} y={290}>
            <L bold>Manual Documents</L>
            <label className="filebtn">
              Browse
              <input type="file" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            </label>
          </At>
          <At x={14} y={318} top>
            <Grid
              cols={[C('name', 'File Name', 314), C('on', 'Uploaded On', 160), C('_', '', 110)]}
              rows={manual.map((m, i) => ({
                id: i,
                cells: {
                  name: m.name,
                  on: dmy(m.at),
                  _: (
                    <>
                      <a className="filebtn" href={m.dataUrl} download={m.name}>Download</a>
                      <Btn
                        style={{ height: 19 }}
                        onClick={async () => {
                          const key = `medapp:manual:${find}`
                          const list = await getKv<ManualDoc[]>(key, [])
                          await setKv(key, list.filter((_, j) => j !== i))
                          setManual(list.filter((_, j) => j !== i))
                        }}
                      >
                        Delete
                      </Btn>
                    </>
                  ),
                },
              }))}
              height={200}
              compact
              width={584}
            />
          </At>
        </>
      )}
    </Canvas>
  )
}

/* ═══════════════════════════════ OTHERS ═══════════════════════════════════ */
function Others() {
  const nav = useNavigate()
  const items: [string, string][] = [
    ['Day Shift Open/Close', '/shift'],
    ['Cash In / Out', '/shift'],
    ['Receipts - Debtors', '/customers'],
    ['Medicine Returns', '/sales'],
    ['Stock Adjust Plus', '/inventory'],
    ['Stock Adjust -', '/inventory'],
    ['Stock Entry (Opening)', '/inventory'],
    ['Audit Logs', '/logs'],
    ['Notifications', '/notifications'],
    ['Settings', '/settings'],
  ]
  return (
    <Canvas height={620}>
      <Title x={52} y={26}>Others</Title>
      <At x={14} y={90} top>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: 320 }}>
          {items.map(([label, to]) => (
            <button key={label} type="button" className="ma-blue is-link" style={{ width: 320 }} onClick={() => nav(to)}>
              {label}
            </button>
          ))}
        </div>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ FORCE TO CLOSE TRANSACTION ═══════════════════════ */
function ForceClose() {
  const toast = useToast()
  const { user } = useSession()
  const [tx, setTx] = useState('')
  const [reason, setReason] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [chk, setChk] = useState<Set<string | number>>(new Set())
  const sups = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])

  const show = async () => {
    if (tx === 'Local Purchase Order') {
      const pos = await db.purchaseOrders.filter((p) => ['draft', 'ordered', 'partial'].includes(p.status)).toArray()
      setRows(
        pos.map((p) => ({
          id: `p${p.id}`,
          cells: {
            no: p.poNo,
            name: sups.find((s) => s.id === p.supplierId)?.name.toUpperCase() ?? '',
            date: dmy(p.createdAt),
            product: ' - ',
            org: String(p.lines.reduce((t, l) => t + l.qty, 0)),
            pending: String(p.lines.reduce((t, l) => t + Math.max(0, l.qty - l.received), 0)),
          },
        })),
      )
    } else if (tx === 'Service Request/Bill') {
      const js = await db.jobs.filter((j) => j.status !== 'collected').toArray()
      setRows(js.map((j) => ({ id: `j${j.id}`, cells: { no: j.jobNo, name: j.customerName.toUpperCase(), date: dmy(j.createdAt), product: j.complaint, org: '1', pending: '1' } })))
    } else setRows([])
  }

  const update = async () => {
    if (!chk.size || !reason) return toast('Select a transaction and the close reason', 'error')
    await logActivity('system', `Force To Close (${tx || 'manual'})`, { detail: `${chk.size} record(s), reason: ${reason}`, userId: user?.id, userName: user?.name })
    for (const id of chk) {
      const n = Number(String(id).slice(1))
      if (String(id).startsWith('p')) {
        const po = await db.purchaseOrders.get(n)
        if (po) await db.purchaseOrders.update(n, { status: 'cancelled', notes: `${po.notes ?? ''} [Force closed: ${reason}]`, updatedAt: Date.now() })
      } else await db.jobs.update(n, { status: 'collected', updatedAt: Date.now() })
    }
    toast(`${chk.size} transaction(s) force closed`)
    setChk(new Set())
    await show()
  }

  return (
    <Canvas height={620}>
      <Title x={168} y={26}>Force To Close Transaction</Title>
      <At x={14} y={80}>
        <Select value={tx} onChange={setTx} options={['', 'Local Purchase Order', 'Service Request/Bill']} width={150} />
        <Btn style={{ width: 84 }} onClick={show}>ShowData</Btn>
      </At>
      <At x={14} y={140} top>
        <Grid
          checkbox
          yellowCheckHeader
          checked={chk}
          onCheck={(id) => {
            const n = new Set(chk)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            setChk(n)
          }}
          cols={[C('no', 'Doc No', 120), C('name', 'Customer Name/Supplier', 200), C('date', 'Doc Date', 90), C('product', 'Product', 160), C('org', 'Org Qty', 70, 'right'), C('pending', 'Pending Qty', 80, 'right')]}
          rows={rows}
          height={300}
          width={760}
        />
      </At>
      <At x={14} y={480}>
        <Select value={reason} onChange={setReason} options={['', 'COMPLETED', 'TRIAGE REQUIRED', 'NO SUCH SUPPLY']} width={140} />
        <Btn style={{ width: 74 }} onClick={update}>Update</Btn>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ REGENERATE LINK TRANSACTION ══════════════════════ */
const LINK_TEMPLATES: { label: string; from: string; to: string; prefix: string }[] = [
  { label: 'SALES QUOTATION -> DELIVERY NOTE', from: 'sales-quotation', to: 'delivery-note', prefix: 'DN' },
  { label: 'SALES QUOTATION -> WHOLE SALE INVOICE', from: 'sales-quotation', to: 'whole-sale-invoice', prefix: 'WSI' },
  { label: 'DELIVERY NOTE -> WHOLE SALE INVOICE', from: 'delivery-note', to: 'whole-sale-invoice', prefix: 'WSI' },
  { label: 'DELIVERY NOTE -> FINAL BILL RECEIPT', from: 'delivery-note', to: 'final-bill-receipt', prefix: 'FBR' },
]
function RegenerateLink() {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const [tpl, setTpl] = useState(LINK_TEMPLATES[0].label)
  const [docNo, setDocNo] = useState('')
  const t = LINK_TEMPLATES.find((x) => x.label === tpl) ?? LINK_TEMPLATES[0]
  const source = useDocs(t.from)
  const found = source.find((s) => (s.values.docNo ?? '').toUpperCase() === docNo.trim().toUpperCase())

  const regenerate = async () => {
    if (!docNo.trim()) return toast('Enter a Doc No', 'error')
    if (!found) return toast('Document not found in the source register', 'error')
    const values: Record<string, string> = {
      ...found.values,
      docNo: await nextDocNo(t.prefix),
      quoteNo: t.from === 'sales-quotation' ? found.values.docNo : found.values.quoteNo ?? found.values.docNo,
      user: user?.name.toUpperCase() ?? found.values.user ?? '',
    }
    if (!values.date) values.date = dmy(Date.now())
    if (!values.location) values.location = d.location
    await saveDoc(t.to, values)
    await logActivity('system', `ReGenerate Link ${found.values.docNo} -> ${values.docNo}`, { detail: t.label, userId: user?.id, userName: user?.name })
    toast(`${values.docNo} created from ${found.values.docNo}`)
  }

  return (
    <Canvas height={640}>
      <Title x={150} y={26}>ReGenerate Link Transaction</Title>
      <At x={626} y={80}>
        <L>Select Template</L>
        <Select value={tpl} onChange={setTpl} options={LINK_TEMPLATES.map((x) => x.label)} width={220} />
      </At>
      <At x={626} y={116}>
        <L>Doc No</L>
        <Input value={docNo} onChange={setDocNo} width={150} />
        <Btn style={{ width: 96 }} onClick={regenerate}>Regenerate</Btn>
      </At>
      <At x={626} y={152}>
        <L>Qty</L>
        <Input value={found?.values.total ?? '1'} width={70} readOnly grey />
        <L>Mapping Field</L>
        <span className="ma-label">docNo / quoteNo / customer / totals</span>
      </At>
      <At x={626} y={188}>
        <L>Based On</L>
        <Select value={t.label} onChange={() => {}} options={[t.label]} width={336} disabled plain />
      </At>
      <At x={14} y={112} top>
        <span className="ma-report-name">{t.from.replace(/-/g, ' ')} list</span>
      </At>
      <At x={14} y={140} top>
        <Grid
          cols={[C('docNo', 'Doc No', 150), C('date', 'Date', 90), C('customer', 'Customer', 210), C('total', 'Amount', 100, 'right')]}
          rows={source.slice(0, 60).map((s) => ({ id: s.id, cells: { docNo: s.values.docNo ?? '', date: s.values.date ?? '', customer: s.values.customer ?? '', total: s.values.total ?? '' } }))}
          height={420}
          width={560}
          onSelect={(id) => setDocNo(source.find((s) => s.id === id)?.values.docNo ?? '')}
          onOpen={regenerate}
        />
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ PAY ROLL AUTOMATION ══════════════════════════════ */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function PayRoll() {
  const toast = useToast()
  const [group, setGroup] = useState('ALL STAFF')
  const [month, setMonth] = useState(String(new Date().getMonth()))
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const pool = users.filter((u) => group === 'ALL STAFF' || u.role === group.toLowerCase())
  const t = useTransfer<number>(pool.map((u) => u.id!))
  const [result, setResult] = useState<{ cols: Col[]; rows: Record<string, string>[] } | null>(null)

  const process = async () => {
    const staff = users.filter((u) => t.chosen.includes(u.id!))
    if (!staff.length) return toast('Move staff to the right list first', 'error')
    const from = new Date(Number(year), Number(month), 1).getTime()
    const to = new Date(Number(year), Number(month) + 1, 1).getTime()
    const sales = (await db.sales.where('createdAt').between(from, to).toArray()).filter((s) => s.status !== 'refunded' && s.status !== 'voided')
    let days = 0
    for (let dd = new Date(from); dd.getTime() < to; dd.setDate(dd.getDate() + 1)) if (dd.getDay() !== 0) days++
    setResult({
      cols: [C('name', 'Staff Name', 150), C('role', 'Role', 90), C('days', 'Days', 60, 'right'), C('bills', 'Bills', 60, 'right'), C('sales', 'Sales Amount', 100, 'right')],
      rows: staff.map((u) => {
        const mine = sales.filter((s) => s.userId === u.id)
        return { name: u.name, role: u.role.toUpperCase(), days: String(days), bills: String(mine.length), sales: amt(mine.reduce((s, x) => s + x.total, 0)) }
      }),
    })
  }

  return (
    <Canvas height={620}>
      <Title x={128} y={26}>Pay Roll Automation</Title>
      <At x={14} y={80}>
        <Select value={group} onChange={setGroup} options={['ALL STAFF', 'OWNER', 'MANAGER', 'CASHIER']} width={120} />
        <Select value={month} onChange={setMonth} options={MONTHS.map((m, i) => ({ value: String(i), label: m }))} width={110} />
        <Select value={year} onChange={setYear} options={['2024', '2025', '2026', '2027']} width={80} />
      </At>
      <At x={14} y={130} top>
        <div style={{ display: 'flex', gap: 16 }}>
          <List items={pool.filter((u) => !t.chosen.includes(u.id!)).map((u) => u.name)} width={180} height={210} value={t.pickLeft ? users.find((u) => u.id === t.pickLeft)?.name ?? '' : ''} onSelect={(nm) => t.setPickLeft(users.find((u) => u.name === nm)?.id)} />
          <TransferArrows onRight={() => t.pickLeft !== undefined && t.right()} onLeft={() => t.pickRight !== undefined && t.setChosen(t.chosen.filter((id) => id !== t.pickRight))} />
          <List items={pool.filter((u) => t.chosen.includes(u.id!)).map((u) => u.name)} width={180} height={210} onSelect={(name) => t.setPickRight(users.find((u) => u.name === name)?.id)} />
        </div>
      </At>
      <At x={14} y={400}>
        <L>As on Date</L>
        <Input value={today()} onChange={() => {}} width={70} readOnly />
        <Btn style={{ width: 80 }} onClick={process}>Process</Btn>
      </At>
      {result && <ResultDialog title="Pay Roll Register" onClose={() => setResult(null)} {...result} />}
    </Canvas>
  )
}

/* ═══════════════════════ EXPORT VIEWDATA ══════════════════════════════════ */
const EXPORT_SOURCES: Record<string, { fields: string[]; get: () => Promise<Record<string, Record<string, string>>> }> = {
  SALES: {
    fields: ['BILL NO', 'DATE', 'CUSTOMER', 'PAYMENT', 'TOTAL', 'USER', 'STATUS'],
    get: async () => {
      const [sales, users, custs] = await Promise.all([db.sales.toArray(), db.users.toArray(), db.customers.toArray()])
      const out: Record<string, Record<string, string>> = {}
      for (const s of sales)
        out[s.receiptNo] = {
          'BILL NO': s.receiptNo,
          DATE: dmy(s.createdAt),
          CUSTOMER: custs.find((c) => c.id === s.customerId)?.name ?? '',
          PAYMENT: (s.payments[0]?.method ?? '').toUpperCase(),
          TOTAL: amt(s.total),
          USER: users.find((u) => u.id === s.userId)?.name ?? '',
          STATUS: s.status,
        }
      return out
    },
  },
  PRODUCTS: {
    fields: ['CODE', 'NAME', 'CATEGORY', 'COST', 'PRICE', 'STOCK', 'RE-ORDER LEVEL', 'LOCATION'],
    get: async () => {
      const [ps, cats] = await Promise.all([db.products.toArray(), db.categories.toArray()])
      const out: Record<string, Record<string, string>> = {}
      for (const p of ps)
        out[p.sku] = {
          CODE: p.sku,
          NAME: p.name,
          CATEGORY: cats.find((c) => c.id === p.categoryId)?.name ?? '',
          COST: amt(p.cost),
          PRICE: amt(p.price),
          STOCK: String(p.stock),
          'RE-ORDER LEVEL': String(p.reorderLevel),
          LOCATION: p.location ?? '',
        }
      return out
    },
  },
  CUSTOMERS: {
    fields: ['NAME', 'PHONE', 'EMAIL', 'BALANCE', 'CREDIT LIMIT', 'PLATE'],
    get: async () => {
      const cs = await db.customers.toArray()
      const out: Record<string, Record<string, string>> = {}
      for (const c of cs)
        out[c.name] = { NAME: c.name, PHONE: c.phone ?? '', EMAIL: c.email ?? '', BALANCE: amt(c.balance), 'CREDIT LIMIT': amt(c.creditLimit), PLATE: c.plate ?? '' }
      return out
    },
  },
  SUPPLIERS: {
    fields: ['NAME', 'PHONE', 'EMAIL', 'GROUP'],
    get: async () => {
      const ss = await db.suppliers.toArray()
      const out: Record<string, Record<string, string>> = {}
      for (const s of ss) out[s.name] = { NAME: s.name, PHONE: s.phone ?? '', EMAIL: s.email ?? '', GROUP: 'SUNDRY CREDITORS/SUPPLIERS' }
      return out
    },
  },
  SERVICES: {
    fields: ['JOB NO', 'PATIENT', 'STATUS', 'LABOUR', 'DATE'],
    get: async () => {
      const js = await db.jobs.toArray()
      const out: Record<string, Record<string, string>> = {}
      for (const j of js) out[j.jobNo] = { 'JOB NO': j.jobNo, PATIENT: j.customerName, STATUS: j.status.toUpperCase(), LABOUR: amt(j.labour), DATE: dmy(j.createdAt) }
      return out
    },
  },
}
interface ExportTemplate {
  id: number
  name: string
  tx: string
  fields: string[]
}
function ExportViewData() {
  const toast = useToast()
  const saved = useKv<ExportTemplate[]>('medapp:exports', [])
  const [tx, setTx] = useState('SALES')
  const [name, setName] = useState('')
  const t = useTransfer<string>(EXPORT_SOURCES['SALES'].fields)
  const fields = EXPORT_SOURCES[tx]?.fields ?? []
  const available = fields.filter((f) => !t.chosen.includes(f))

  const setT = (x: string) => {
    setTx(x)
    t.setChosen([])
    t.setPickLeft(undefined)
    t.setPickRight(undefined)
  }
  const save = async () => {
    if (!name.trim()) return toast('Enter a View Name', 'error')
    if (!t.chosen.length) return toast('Move at least one field', 'error')
    await setKv('medapp:exports', [...saved, { id: Date.now(), name: name.trim(), tx, fields: t.chosen.map(String) }])
    setName('')
    setT(tx)
    t.setChosen([])
    toast('Template saved. Double-click a row to export.')
  }
  const run = async (tpl: ExportTemplate) => {
    const data = await EXPORT_SOURCES[tpl.tx].get()
    const rows = Object.values(data).map((r) => tpl.fields.map((f) => r[f] ?? ''))
    downloadCsv(tpl.name.replace(/\s/g, '-'), tpl.fields, rows)
    toast(`${rows.length} row(s) exported`)
  }

  return (
    <Canvas height={660}>
      <Title x={102} y={26}>Export ViewData</Title>
      <At x={14} y={80}>
        <L>Transaction</L>
        <Select value={tx} onChange={setT} options={Object.keys(EXPORT_SOURCES)} width={120} />
      </At>
      <At x={620} y={80}>
        <L>View Name</L>
        <Input value={name} onChange={setName} width={140} />
      </At>
      <At x={14} y={120}>
        <L>Txn Flds</L>
      </At>
      <At x={14} y={168} top>
        <div style={{ display: 'flex', gap: 14 }}>
          <List items={available} width={200} height={200} value={t.pickLeft ?? ''} onSelect={(v) => t.setPickLeft(v)} />
          <TransferArrows onRight={() => t.pickLeft !== undefined && t.right()} onLeft={t.left} onAllRight={() => t.setChosen(fields)} onAllLeft={() => t.setChosen([])} />
          <List items={t.chosen} width={200} height={200} value={t.pickRight ?? ''} onSelect={(v) => t.setPickRight(v)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 40 }}>
            <Btn style={{ width: 74 }} onClick={() => t.pickLeft !== undefined && t.right()}>ADD</Btn>
            <Btn style={{ width: 74 }} onClick={t.left}>DELETE</Btn>
            <Btn style={{ width: 74 }} onClick={save}>SAVE</Btn>
          </div>
        </div>
      </At>
      <At x={14} y={424} top>
        <L bold>Saved Templates</L>
      </At>
      <At x={14} y={452} top>
        <Grid
          cols={[C('name', 'Template Name', 160), C('tx', 'Transaction', 120), C('n', 'Fields', 70, 'right'), C('_', '', 70)]}
          rows={saved.map((tp, i) => ({ id: tp.id ?? i, cells: { name: tp.name, tx: tp.tx, n: String(tp.fields.length), _: <Btn style={{ height: 19 }} onClick={() => void run(tp)}>Run</Btn> } }))}
          height={160}
          compact
          width={544}
          onOpen={(id) => {
            const tp = saved.find((s) => (s.id ?? -1) === id)
            if (tp) void run(tp)
          }}
        />
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ PRODUCT AUTOMATION ═══════════════════════════════ */
function ProductAutomation() {
  const toast = useToast()
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const [group, setGroup] = useState('')
  const [applyOn, setApplyOn] = useState('Cost Price')
  const [pct, setPct] = useState('')
  const products = useProducts()
  const inGroup = products.filter((p) => !group || cats.find((c) => c.id === p.categoryId)?.name === group)
  const factor = 1 + num(pct) / 100
  const shown = inGroup.map((p) => ({ id: p.id!, cells: { name: p.name, current: amt(applyOn === 'Cost Price' ? p.cost : p.price), next: amt(Math.round((applyOn === 'Cost Price' ? p.cost : p.price) * factor)) } }))

  const apply = async () => {
    const base = applyOn === 'Cost Price' ? 'cost' : 'price'
    if (!pct.trim() || factor <= 0) return toast('Enter a percentage', 'error')
    if (!confirm(`${pct}% change of ${base} for ${inGroup.length} product(s). Apply?`)) return
    await db.transaction('rw', db.products, async () => {
      const now = Date.now()
      for (const p of inGroup) await db.products.update(p.id!, ({ [base]: Math.round((base === 'cost' ? p.cost : p.price) * factor), updatedAt: now } as unknown as Partial<Product>))
    })
    await logActivity('stock', `Bulk ${base} changed`, { detail: `${pct}% for ${inGroup.length} product(s)` })
    toast('Prices updated')
  }

  return (
    <Canvas height={620}>
      <Title x={128} y={26}>Product Automation</Title>
      <At x={14} y={80}>
        <L>Group</L>
        <Select value={group} onChange={setGroup} options={['', ...cats.map((c) => c.name)]} width={150} />
        <L>Apply On</L>
        <Radio checked={applyOn === 'Cost Price'} onChange={() => setApplyOn('Cost Price')} name="ao">Cost Price</Radio>
        <Radio checked={applyOn === 'Selling Price'} onChange={() => setApplyOn('Selling Price')} name="ao">Selling Price</Radio>
      </At>
      <At x={14} y={120}>
        <L>% Change</L>
        <Input value={pct} onChange={setPct} width={70} />
        <Btn style={{ width: 78 }} onClick={apply}>Apply</Btn>
      </At>
      <At x={14} y={170} top>
        <Grid cols={[C('name', 'Product Name', 300), C('current', 'Current', 90, 'right'), C('next', 'New', 90, 'right')]} rows={shown} height={330} width={504} />
      </At>
      <At x={14} y={530}>
        <span className="ma-label">Preview before Apply. {products.length} products considered.</span>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ TRANSACTION AUTOMATION ═══════════════════════════ */
function TransactionAutomation() {
  const toast = useToast()
  const [autoPrint, setAutoPrint] = useState(false)
  const [openDrawer, setOpenDrawer] = useState(false)
  const [lowStock, setLowStock] = useState(false)
  useEffect(() => {
    void getSettings().then((s) => {
      setAutoPrint(s.autoPrint)
      setOpenDrawer(s.openDrawerOnCash)
      setLowStock(s.notifyLowStock)
    })
  }, [])
  const save = async () => {
    await saveSettings({ autoPrint, openDrawerOnCash: openDrawer, notifyLowStock: lowStock })
    toast('Automation saved')
  }
  return (
    <Canvas height={420}>
      <Title x={140} y={26}>Transaction Automation</Title>
      <Group title="" y={70} w={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Check checked={autoPrint} onChange={setAutoPrint}>Auto print receipt after OTC bill</Check>
          <Check checked={openDrawer} onChange={setOpenDrawer}>Open cash drawer on cash sale</Check>
          <Check checked={lowStock} onChange={setLowStock}>Raise low stock notifications</Check>
          <div style={{ marginTop: 8 }}>
            <Btn style={{ width: 74 }} onClick={save}>Save</Btn>
          </div>
        </div>
      </Group>
    </Canvas>
  )
}

/* ═══════════════════════ RECONCILIATION ═══════════════════════════════════ */
interface ReconcileStmt {
  id: number
  ref: string
  date: string
  cents: number
  matched?: boolean
  forced?: boolean
}
interface ReconcilePay {
  id: number
  ref: string
  date: string
  cents: number
  receiptNo: string
}
function Reconciliation() {
  const toast = useToast()
  const stmt = useKv<ReconcileStmt[]>('medapp:recon:stmt', [])
  const [bank, setBank] = useState('MPESA')
  const [monthWise, setMonthWise] = useState(false)
  const [asOn, setAsOn] = useState(today())
  const [rows, setRows] = useState<Row[]>([])
  const [sel, setSel] = useState<string | number>()
  const [forcePay, setForcePay] = useState<ReconcileStmt | null>(null)

  const payments = useLiveQuery(async (): Promise<ReconcilePay[]> => {
    const sales = await db.sales.toArray()
    const out: ReconcilePay[] = []
    const asTs = parseDmy(asOn)
    for (const s of sales)
      for (const p of s.payments) {
        if (bank === 'MPESA' ? p.method !== 'mpesa' : p.method !== 'card') continue
        if (monthWise && asTs !== undefined && new Date(s.createdAt).getMonth() !== new Date(asTs).getMonth()) continue
        out.push({ id: s.id!, ref: p.reference ?? '', date: dmy(s.createdAt), cents: p.amount, receiptNo: s.receiptNo })
      }
    return out
  }, [bank, monthWise, asOn], [] as ReconcilePay[])

  const pickAmountIdx = (head: string[]): number => {
    const i = head.findIndex((h) => h.includes('amount') || h.endsWith('bal'))
    if (i >= 0) return i
    return head.length > 2 ? 2 : -1
  }
  const importFile = async (file: File) => {
    const rowsCsv = parseCsv(await file.text())
    if (rowsCsv.length < 2) return toast('Empty file', 'error')
    const head = rowsCsv[0].map((h) => h.trim().toLowerCase())
    const col = (w: string, fb: number) => {
      const i = head.findIndex((h) => h.startsWith(w))
      return i >= 0 ? i : fb
    }
    const iRef = col('ref', 0)
    const iDate = col('date', 1)
    const iAmt = col('amount', pickAmountIdx(head))
    const list: ReconcileStmt[] = rowsCsv
      .slice(1)
      .map((r, i) => ({
        id: Date.now() + i,
        ref: (r[iRef] ?? '').trim(),
        date: (r[iDate] ?? '').trim(),
        cents: Math.round(num((iAmt >= 0 ? r[iAmt] : '') ?? '') * 100),
      }))
      .filter((r) => r.cents || r.ref)
    if (!list.length) return toast('No usable statement lines (columns: Ref, Date, Amount)', 'error')
    await setKv('medapp:recon:stmt', list)
    toast(`${list.length} statement line(s) imported`)
  }

  const recon = () => {
    const pays = payments ?? []
    const used = new Set<number>()
    for (const s of stmt) {
      const p = pays.find((x) => !used.has(x.id) && x.cents === s.cents && (!s.ref || (x.ref && x.ref.toUpperCase() === s.ref.toUpperCase())))
      if (p) {
        used.add(p.id)
        s.matched = true
      } else s.matched = s.matched === true
    }
    const rowsOut: Row[] = stmt.map((s) => ({
      id: s.id,
      cells: { ref: s.ref, date: s.date, amount: amt(s.cents), by: pays.find((p) => p.cents === s.cents)?.receiptNo ?? '', remarks: s.matched ? (s.forced ? 'FORCE RECONCILED' : 'RECONCILED') : 'NOT IN LEDGER' },
    }))
    for (const p of pays)
      if (!used.has(p.id)) rowsOut.push({ id: `x${p.id}`, cells: { ref: p.ref || p.receiptNo, date: p.date, amount: amt(p.cents), by: p.receiptNo, remarks: 'NOT IN STATEMENT' } })
    setRows(rowsOut)
  }

  const force = () => {
    const s = stmt.find((x) => x.id === sel)
    if (!s) return toast('Select a statement line', 'error')
    setForcePay(s)
  }

  const exportNow = () => {
    if (!rows.length) return toast('Run Recon first', 'error')
    downloadCsv('reconciliation', ['Ref No', 'Date', 'Amount', 'By Ledger', 'Remarks'], rows.map((r) => [String(r.cells.ref), String(r.cells.date), String(r.cells.amount), String(r.cells.by), String(r.cells.remarks)]))
  }

  return (
    <Canvas height={700}>
      <Title x={100} y={26}>Reconciliation</Title>
      <At x={14} y={80}>
        <L>File</L>
        <Input value="" onChange={() => {}} width={160} readOnly />
        <label className="filebtn">
          Browse
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
        <Btn style={{ width: 64 }} onClick={recon}>Recon</Btn>
        <Btn style={{ width: 88 }} onClick={() => setRows(rows.filter((r) => r.cells.remarks !== 'RECONCILED'))}>Non Recon</Btn>
        <Btn style={{ width: 100 }} onClick={force}>Force Recon</Btn>
        <Btn style={{ width: 130 }} onClick={() => setRows(rows.filter((r) => r.cells.remarks === 'FORCE RECONCILED'))}>View Force Recon</Btn>
        <Btn style={{ width: 62 }} onClick={exportNow}>Export</Btn>
      </At>
      <At x={14} y={122}>
        <Check checked={monthWise} onChange={setMonthWise}>Month Wise</Check>
        <L>As on Date</L>
        <Input value={asOn} onChange={setAsOn} width={70} />
        <L>Bank Name</L>
        <Select value={bank} onChange={setBank} options={['MPESA', 'CARD']} width={90} />
      </At>
      <At x={14} y={172} top>
        <Grid
          cols={[C('ref', 'Ref No', 150), C('date', 'Date', 90), C('amount', 'Amount', 100, 'right'), C('by', 'By Ledger', 130), C('remarks', 'Remarks', 160)]}
          rows={rows}
          height={380}
          width={660}
          selected={sel}
          onSelect={setSel}
        />
      </At>
      {forcePay && (
        <Dialog title={`Force Recon - ${forcePay.ref || amt(forcePay.cents)}`} onClose={() => setForcePay(null)} width={440}>
          <div className="ma-listbox" style={{ height: 240, width: 410 }}>
            {(payments ?? [])
              .filter((p) => p.cents === forcePay.cents)
              .map((p) => (
                <div
                  key={p.id}
                  className="li"
                  onClick={async () => {
                    await setKv('medapp:recon:stmt', stmt.map((x) => (x.id === forcePay.id ? { ...x, matched: true, forced: true } : x)))
                    setForcePay(null)
                    toast('Marked as force reconciled')
                    recon()
                  }}
                >
                  {p.receiptNo} · {p.date} · {amt(p.cents)}{p.ref ? ` · ${p.ref}` : ''}
                </div>
              ))}
          </div>
        </Dialog>
      )}
    </Canvas>
  )
}

/* ═══════════════════════ STOCK UPDATE AUTOMATION ══════════════════════════ */
function StockUpdate() {
  const products = useProducts()
  const [from, setFrom] = useState(dmy(Date.now() - 30 * 864e5))
  const [right, setRight] = useState<Row[]>([])

  const submit = async () => {
    const mv = await db.movements.where('at').aboveOrEqual(parseDmy(from) ?? 0).toArray()
    const delta = new Map<number, number>()
    for (const m of mv) delta.set(m.productId, (delta.get(m.productId) ?? 0) + m.change)
    setRight(
      products.map((p) => ({ id: p.id!, cells: { name: p.name, code: p.sku, ason: String(p.stock - (delta.get(p.id!) ?? 0)), current: String(p.stock) } })),
    )
  }

  return (
    <Canvas height={620}>
      <Title x={148} y={26}>Stock Update Automation</Title>
      <At x={14} y={80}>
        <L>Stock From Date</L>
        <Input value={from} onChange={setFrom} width={70} />
        <Btn style={{ width: 74 }} onClick={submit}>Submit</Btn>
      </At>
      <At x={14} y={140} top>
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <div style={{ height: 26, marginBottom: 2 }}>
              <span className="ma-bold-label">Products</span>
            </div>
            <Grid cols={[C('name', 'Product Name', 150), C('code', 'Product Code', 90)]} rows={products.map((p) => ({ id: p.id!, cells: { name: p.name, code: p.sku } }))} height={340} width={252} />
          </div>
          <TransferArrows />
          <Grid cols={[C('name', 'Product Name', 150), C('code', 'Product Code', 90), C('ason', 'Stock As On Date', 110, 'right'), C('current', 'Current Stock', 100, 'right')]} rows={right} height={340} width={464} />
        </div>
      </At>
      <At x={14} y={530}>
        <span className="ma-label">Read-only check: stock as on the date, derived from the stock-movement ledger. Nothing is overwritten.</span>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ A/C UPDATE AUTOMATION ════════════════════════════ */
function AcUpdate() {
  const toast = useToast()
  const custs = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const [from, setFrom] = useState(dmy(Date.now() - 30 * 864e5))
  const [to, setTo] = useState(today())
  const [overwrite, setOverwrite] = useState(false)
  const [notPosted, setNotPosted] = useState(false)
  const [party, setParty] = useState('')
  const [result, setResult] = useState<{ cols: Col[]; rows: Record<string, string>[] } | null>(null)

  const submit = async () => {
    const sales = await db.sales.where('createdAt').between(parseDmy(from) ?? 0, (parseDmy(to) ?? Date.now()) + 864e5).toArray()
    const credit = sales.filter(
      (s) => s.payments.some((p) => p.method === 'account') && s.status !== 'refunded' && s.status !== 'voided' && (!party || custs.find((c) => c.id === s.customerId)?.name === party),
    )
    if (!credit.length) return toast('No on-account bills in the period', 'error')
    const perCust = new Map<string, { bills: number; total: number }>()
    for (const s of credit) {
      const n = custs.find((c) => c.id === s.customerId)?.name ?? 'WALK-IN'
      const cur = perCust.get(n) ?? { bills: 0, total: 0 }
      cur.bills++
      cur.total += s.total
      perCust.set(n, cur)
    }
    setResult({
      cols: [C('name', 'Customer', 170), C('bills', 'Bills', 70, 'right'), C('total', 'Bill Amount', 100, 'right'), C('stored', 'Stored Balance', 100, 'right')],
      rows: [...perCust.entries()].map(([n, x]) => ({
        name: n,
        bills: String(x.bills),
        total: amt(x.total),
        stored: amt(custs.find((c) => c.name === n)?.balance ?? 0),
      })),
    })
  }

  return (
    <Canvas height={480}>
      <Title x={140} y={26}>A/C Update Automation</Title>
      <At x={14} y={80}>
        <L>From Date</L>
        <Input value={from} onChange={setFrom} width={70} />
        <L>To Date</L>
        <Input value={to} onChange={setTo} width={70} />
      </At>
      <At x={14} y={120}>
        <L>Location</L>
        <Select value="" onChange={() => {}} options={['']} width={120} disabled />
        <Check checked={overwrite} onChange={setOverwrite}>Overwrite</Check>
        <Check checked={notPosted} onChange={setNotPosted}>Not Posted in Accounts</Check>
      </At>
      <At x={14} y={160}>
        <L>Party Name</L>
        <LookupField value={party} onChange={setParty} options={custs.map((c) => c.name.toUpperCase())} width={180} title="Party" />
        <Btn style={{ width: 74 }} onClick={submit}>Submit</Btn>
      </At>
      <At x={14} y={240}>
        <span className="ma-label">Verification only: computed bill totals vs stored balances. Differences are payments received outside bills (not tracked here); nothing is overwritten.</span>
      </At>
      {result && <ResultDialog title="A/C Balance Verification" onClose={() => setResult(null)} {...result} />}
    </Canvas>
  )
}

/* ═══════════════════════ USER MANAGEMENT ══════════════════════════════════ */
const ROLE_OPTS: { value: Role; label: string }[] = [
  { value: 'cashier', label: 'CASHIER' },
  { value: 'manager', label: 'MANAGER' },
  { value: 'owner', label: 'ADMIN' },
]

function UserManagement() {
  const toast = useToast()
  const { user: me, branches } = useSession()
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const [sel, setSel] = useState<string | number>()
  const [editId, setEditId] = useState<number>()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [full, setFull] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [branchId, setBranchId] = useState<number | undefined>()
  const [active, setActive] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const chem = (id?: number) => chemCode(branches.find((b) => b.id === id)?.number)
  const chemLabel = (b: Branch) => `${chemCode(b.number)} - ${b.name}${b.active ? '' : ' (CLOSED)'}`

  const clear = () => {
    setEditId(undefined)
    setSel(undefined)
    setName('')
    setPass('')
    setFull('')
    setEmail('')
    setMobile('')
    setRole('cashier')
    setBranchId(branches.find((b) => b.active)?.id)
    setActive(true)
  }
  // New profiles default to the first open chemist.
  useEffect(() => {
    if (editId === undefined && branchId === undefined) setBranchId(branches.find((b) => b.active)?.id)
  }, [branches, editId, branchId])

  const loadRow = (id: string | number) => {
    const u = users.find((x) => x.id === id)
    if (!u) return
    setEditId(u.id)
    setName(u.username)
    setPass('')
    setFull(u.name)
    setEmail(u.email ?? '')
    setMobile(u.phone ?? '')
    setRole(u.role)
    setBranchId(u.branchId)
    setActive(u.active)
  }

  const submit = async () => {
    try {
      const rec = await saveStaff(
        { id: editId, username: name, password: pass, name: full || name, email, phone: mobile, role, branchId: role === 'owner' ? undefined : branchId, active },
        me,
      )
      toast(editId !== undefined ? `Profile ${rec.username} updated` : `Profile created: ${rec.username} (${role === 'owner' ? 'all chemists' : chem(rec.branchId)})`)
      clear()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const shown = users
    .filter((u) => filter === 'ALL' || (filter === 'ADMIN' ? u.role === 'owner' : chem(u.branchId) === filter))
    .sort((a, b) => (chem(a.branchId) || ' ').localeCompare(chem(b.branchId) || ' ') || a.username.localeCompare(b.username))

  return (
    <Canvas height={720}>
      <Title x={110} y={26}>Create Profile</Title>
      <Group title="User Details" y={56} w={760}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <Btn style={{ width: 96 }} onClick={clear}>Add Profile</Btn>
          <Btn style={{ width: 96 }} onClick={() => (sel !== undefined ? loadRow(sel) : toast('Click a profile in the list below first', 'error'))}>Edit Profile</Btn>
          <span className="ma-label" style={{ marginLeft: 10 }}>
            {editId !== undefined ? `Editing ${name} — change fields and Submit (leave Password blank to keep it).` : 'New profile: fill in and Submit.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 190px', width: 340 }}>
            <L bold>User Name</L>
            <Input value={name} onChange={(v) => setName(v.toLowerCase().replace(/\s/g, ''))} width={188} />
            <L bold>Password</L>
            <Input value={pass} onChange={setPass} width={188} type="password" placeholder={editId !== undefined ? 'blank = keep current' : 'min 4 characters'} />
            <L bold>Full Name</L>
            <Input value={full} onChange={setFull} width={188} />
            <L bold>Email</L>
            <Input value={email} onChange={setEmail} width={188} />
            <L bold>Mobile No</L>
            <Input value={mobile} onChange={setMobile} width={188} />
            <L bold>Role</L>
            <Select value={role} onChange={(v) => setRole(v as Role)} options={ROLE_OPTS} width={188} />
            <L bold>Chemist No.</L>
            <Select
              value={role === 'owner' ? '' : String(branchId ?? '')}
              onChange={(v) => setBranchId(v ? Number(v) : undefined)}
              options={role === 'owner' ? [{ value: '', label: 'ALL CHEMISTS' }] : [{ value: '', label: 'SELECT CHEMIST' }, ...branches.map((b) => ({ value: String(b.id), label: chemLabel(b) }))]}
              width={188}
              disabled={role === 'owner'}
            />
            <L bold>Status</L>
            <Check checked={active} onChange={setActive}>Active (can sign in)</Check>
            <span />
            <div style={{ marginTop: 10 }}>
              <Btn style={{ width: 74 }} onClick={submit}>Submit</Btn>
            </div>
          </div>
          <div>
            <L bold>Chemists</L>
            <List
              items={branches.map(chemLabel)}
              width={300}
              height={230}
              value={branches.find((b) => b.id === branchId) ? chemLabel(branches.find((b) => b.id === branchId)!) : undefined}
              onSelect={(v) => {
                const b = branches.find((x) => chemLabel(x) === v)
                if (b && role !== 'owner') setBranchId(b.id)
              }}
            />
            <div className="ma-label ma-note" style={{ marginTop: 6, width: 300 }}>
              Cashiers and managers only see and sell the stock of their own chemist. The admin sees all chemists. Add chemists in Utilities → Chemists (Branches).
            </div>
          </div>
        </div>
      </Group>
      <At x={14} y={470} top>
        <L bold>Existing Profiles</L>
        <Select value={filter} onChange={setFilter} options={['ALL', 'ADMIN', ...branches.map((b) => chemCode(b.number))]} width={110} />
        <Rows n={shown.length} />
      </At>
      <At x={14} y={500} top>
        <Grid
          cols={[C('name', 'User Name', 130), C('full', 'Full Name', 170), C('role', 'Role', 90), C('chem', 'Chemist', 90), C('active', 'Active', 60), C('phone', 'Mobile', 110)]}
          rows={shown.map((u) => ({
            id: u.id!,
            cells: { name: u.username, full: u.name, role: ROLE_OPTS.find((r) => r.value === u.role)?.label ?? u.role, chem: u.role === 'owner' ? 'ALL' : chem(u.branchId), active: u.active ? 'Yes' : 'No', phone: u.phone ?? '' },
          }))}
          height={190}
          compact
          width={680}
          selected={sel}
          onSelect={(id) => {
            setSel(id)
            loadRow(id)
          }}
        />
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ DATA MANAGEMENT ══════════════════════════════════ */
function DataManagement() {
  const toast = useToast()
  const [tab, setTab] = useState<'backup' | 'restore' | 'import'>('backup')
  const [company, setCompany] = useState('')
  const [fileNm, setFileNm] = useState('')
  const [tx, setTx] = useState('Products')
  const settings = useLiveQuery(() => db.kv.get('settings'), [])
  const shopName = ((settings?.value as Record<string, string>) ?? {}).shopName ?? 'Subgeo Chemist'

  const { branchCode, user: me } = useSession()
  const backup = async () => {
    const nm = fileNm.trim() || `subgeo-${branchCode}-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}`
    download(`${nm}.json`, JSON.stringify(await exportBackup()), 'application/json')
    await logActivity('system', 'Data backup downloaded', { detail: `Data Management · ${branchCode}` })
    toast('Backup downloaded')
  }
  const restore = async (file: File) => {
    if (!confirm(`Restoring replaces ALL ${branchCode} data with the backup, here and on the server. Other chemists are not touched. Continue?`)) return
    try {
      const { data } = JSON.parse(await file.text()) as { data: Record<string, unknown[]> }
      await restoreBackup(data, { includeCompanyLists: me?.role === 'owner' })
      await logActivity('system', 'Backup restored', { detail: `Data Management · ${branchCode}`, userId: me?.id, userName: me?.name })
      toast(`Backup restored into ${branchCode}`)
    } catch (e) {
      toast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  const importCsv = async (file: File) => {
    try {
      const rowsCsv = parseCsv(await file.text())
      const head = rowsCsv[0].map((h) => h.trim().toLowerCase())
      const get = (r: string[], w: string) => r[head.findIndex((h) => h.startsWith(w))] ?? ''
      const now = Date.now()
      if (tx === 'Products') {
        let n = 0
        for (const r of rowsCsv.slice(1)) {
          const sku = get(r, 'sku') || get(r, 'code')
          const name = get(r, 'name')
          if (!sku || !name) continue
          const ex = await db.products.where('sku').equals(sku).first()
          const patch = { sku, name, cost: Math.round(num(get(r, 'cost')) * 100), price: Math.round(num(get(r, 'price')) * 100), stock: parseInt(get(r, 'stock')) || 0, reorderLevel: parseInt(get(r, 'reorder')) || 2 }
          if (ex) await db.products.update(ex.id!, { ...patch, updatedAt: now })
          else await db.products.add({ ...patch, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: now, updatedAt: now })
          n++
        }
        toast(`${n} product(s) imported`)
      } else {
        let n = 0
        for (const r of rowsCsv.slice(1)) {
          const name = get(r, 'name')
          if (!name) continue
          const ex = await db.customers.where('name').equals(name).first()
          const patch = { name, phone: get(r, 'phone') || undefined, email: get(r, 'email') || undefined }
          if (ex) await db.customers.update(ex.id!, patch)
          else await db.customers.add({ ...patch, balance: 0, creditLimit: 0, createdAt: now })
          n++
        }
        toast(`${n} customer(s) imported`)
      }
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  return (
    <Canvas height={520}>
      <Title x={110} y={26}>Data Management</Title>
      <Group y={56} w={560} title="File Actions">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Btn style={{ width: 86 }} onClick={() => setTab('backup')}>Backup</Btn>
          <Btn style={{ width: 86 }} onClick={() => setTab('restore')}>Restore</Btn>
          <Btn style={{ width: 86 }} onClick={() => setTab('import')}>Import</Btn>
        </div>
        {tab === 'backup' && (
          <div className="ma-form" style={{ gridTemplateColumns: '120px 240px 80px' }}>
            <L bold>Company Name</L>
            <span>
              <LookupField value={company} onChange={setCompany} options={[shopName.toUpperCase()]} width={220} title="Company" />
            </span>
            <span />
            <L bold>File Name</L>
            <Input value={fileNm} onChange={setFileNm} width={228} placeholder="optional file name" />
            <Btn style={{ width: 74 }} onClick={backup}>Backup</Btn>
          </div>
        )}
        {tab === 'restore' && (
          <label className="filebtn">
            Browse backup file (.json)
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
          </label>
        )}
        {tab === 'import' && (
          <>
            <Select value={tx} onChange={setTx} options={['Products', 'Customers']} width={110} />
            <label className="filebtn" style={{ marginLeft: 10 }}>
              Browse .csv
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
            </label>
          </>
        )}
      </Group>
      <At x={14} y={300} top>
        <span className="ma-label" style={{ display: 'block', maxWidth: 620, whiteSpace: 'normal' }}>
          Backup JSON is compatible with Settings &gt; Backup. Products CSV headers: sku, name, cost, price, stock, reorder. Customers CSV: name, phone, email.
        </span>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ AUTO NUMBER RESET ════════════════════════════════ */
const SEQ_TX: { label: string; key: string; legacy?: boolean }[] = [
  { label: 'OTC Medicine Issued/Bill', key: 'R', legacy: true },
  { label: 'OTC Medicine Isse Return', key: 'RF', legacy: true },
  { label: 'Service Request/Bill', key: 'JOB', legacy: true },
  { label: 'Local Purchase Order', key: 'PO', legacy: true },
  { label: 'Sales Quotation', key: 'SQ' },
  { label: 'Delivery Note', key: 'DN' },
  { label: 'Credit Note', key: 'CN' },
  { label: 'Whole Sale Invoice', key: 'WSI' },
  { label: 'Credit Note - Direct Invoice', key: 'CRN' },
  { label: 'Final Bill Receipt', key: 'FBR' },
]
function AutoNumberReset() {
  const toast = useToast()
  const [tx, setTx] = useState('')
  const [numV, setNumV] = useState('')
  const [look, setLook] = useState('NEXT VALUE')
  const t = SEQ_TX.find((x) => x.label === tx)
  const fmt = (key: string, legacy: boolean | undefined, n: number) => (legacy ? `${key}-${String(n).padStart(6, '0')}` : `${key}-${n}-${yy(Date.now())}`)
  const current = useLiveQuery(async () => {
    if (!t) return ''
    const n = await getKv<number>(t.legacy ? `seq:${t.key}` : `medapp:seq:${t.key}`, 0)
    if (look === 'LAST VALUE') return n ? fmt(t.key, t.legacy, n) : '(none issued yet)'
    return fmt(t.key, t.legacy, n + 1)
  }, [tx, look], '')

  const save = async () => {
    if (!t) return toast('Select a transaction', 'error')
    const n = parseInt(numV, 10)
    if (!Number.isFinite(n) || n < 1) return toast('Enter the next number', 'error')
    const v = n - 1
    await setKv(t.legacy ? `seq:${t.key}` : `medapp:seq:${t.key}`, v)
    await logActivity('system', `Auto Number Reset ${t.label}`, { detail: `next will be ${n}` })
    setNumV('')
    toast(`Next number will be ${fmt(t.key, t.legacy, n)}`)
  }

  return (
    <Canvas height={480}>
      <Title x={110} y={26}>Auto Number Reset</Title>
      <At x={14} y={80}>
        <L>Transaction</L>
        <Select
          value={tx}
          onChange={(v) => {
            setTx(v)
            setNumV('')
          }}
          options={['', ...SEQ_TX.map((x) => x.label)]}
          width={180}
        />
        <L>LookUp Fields</L>
        <Select value={look} onChange={setLook} options={['NEXT VALUE', 'LAST VALUE']} width={110} />
      </At>
      <At x={14} y={120}>
        <L>FieldData</L>
        <Input value={current} width={150} readOnly grey />
      </At>
      <At x={14} y={160}>
        <IBtn bare title="Save" onClick={save} style={{ float: 'right' }}>
          <CheckGreenIcon />
        </IBtn>
        <L>DATA</L>
        <Input value={numV} onChange={setNumV} width={80} />
        <span className="ma-label">(enter the next number this transaction should use)</span>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ OFFLINE/ONLINE SYNC ══════════════════════════════ */
function Sync() {
  const st = useSyncState()
  const { branchCode, user } = useSession()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const upd = (s: string) => setLog((x) => [`${new Date().toLocaleTimeString('en-KE')}  ${s}`, ...x].slice(0, 200))
  const pendingByTable = useLiveQuery(async () => {
    const out: { t: string; n: number }[] = []
    for (const t of SYNCED_TABLES) {
      const n = await db.table(t).where('_dirty').equals(1).count()
      if (n) out.push({ t, n })
    }
    const del = await db.outbox.count()
    if (del) out.push({ t: 'deletions', n: del })
    return out
  }, [], [] as { t: string; n: number }[])

  const run = async () => {
    setBusy(true)
    upd(`Sync ${branchCode} started`)
    await syncNow()
    const s = getSyncState()
    upd(s.status === 'idle' ? `Done · ${s.pending} change(s) still waiting` : s.status === 'off' ? 'Not connected: sign out and sign in again while online' : s.status === 'offline' ? 'Server not reachable (offline). Changes stay on this till and upload automatically.' : `Error: ${s.error ?? ''}`)
    if (s.status === 'idle') await logActivity('system', 'Manual sync', { detail: branchCode, userId: user?.id, userName: user?.name })
    setBusy(false)
  }

  const statusText =
    st.status === 'idle' ? 'ONLINE — connected to the company database' : st.status === 'syncing' ? 'SYNCING…' : st.status === 'offline' ? 'OFFLINE — server not reachable' : st.status === 'error' ? `ERROR — ${st.error ?? ''}` : 'NOT CONNECTED — signed in offline'

  return (
    <Canvas height={560}>
      <Group title="OffLine/OnLine Synchronization" y={60} w={640}>
        <div className="ma-form" style={{ gridTemplateColumns: '170px 420px' }}>
          <L bold>Chemist on this till</L>
          <b style={{ color: '#c00' }}>{branchCode}</b>
          <L bold>Status</L>
          <span style={{ fontWeight: 'bold', color: st.status === 'idle' || st.status === 'syncing' ? '#2e7d32' : '#c00' }}>{statusText}</span>
          <L bold>Last synced</L>
          <span>{st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString('en-KE') : 'never (this session)'}</span>
          <L bold>Waiting to upload</L>
          <span>{pendingByTable.length === 0 ? 'nothing — all changes uploaded' : pendingByTable.map((p) => `${p.t}: ${p.n}`).join(' · ')}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <Btn style={{ width: 120 }} onClick={run} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync Now'}
          </Btn>
        </div>
        <div style={{ marginTop: 10, height: 180, overflow: 'auto', border: '1px solid #b7b19d', background: '#fff', padding: '6px 8px' }}>
          {log.length === 0 && <div className="ma-label">Sales, stock and records sync automatically every few seconds while online. Use Sync Now to force it.</div>}
          {log.map((s, i) => (
            <div key={i} style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}>
              {s}
            </div>
          ))}
        </div>
        <div className="ma-label ma-note" style={{ marginTop: 8 }}>
          The till keeps working without internet: every sale and stock change is stored here first and uploaded when the connection returns.
        </div>
      </Group>
    </Canvas>
  )
}

/* ═══════════════════════ DEFAULT VALUES MANAGEMENT ════════════════════════ */
function DefaultValues() {
  const toast = useToast()
  const d = useMedDefaults()
  const settings = useLiveQuery(() => db.kv.get('settings'), [])
  const sv = (settings?.value as Record<string, unknown>) ?? {}
  type DefRow = { label: string; value: string; store: 'setting' | 'medapp'; key: string }
  const rows: DefRow[] = [
    { label: 'Company Name', value: d.companyName, store: 'medapp', key: 'companyName' },
    { label: 'Shop Name', value: String(sv.shopName ?? ''), store: 'setting', key: 'shopName' },
    { label: 'Address', value: String(sv.address ?? ''), store: 'setting', key: 'address' },
    { label: 'Phone No', value: String(sv.phone ?? ''), store: 'setting', key: 'phone' },
    { label: 'KRA Pin', value: String(sv.kraPin ?? ''), store: 'setting', key: 'kraPin' },
    { label: 'Receipt Footer', value: String(sv.receiptFooter ?? ''), store: 'setting', key: 'receiptFooter' },
    { label: 'Currency', value: String(sv.currency ?? ''), store: 'setting', key: 'currency' },
    { label: 'M-Pesa Till', value: String(sv.mpesaTill ?? ''), store: 'setting', key: 'mpesaTill' },
    { label: 'Location', value: d.location, store: 'medapp', key: 'location' },
    { label: 'Patient Category', value: d.patientCategory, store: 'medapp', key: 'patientCategory' },
    { label: 'Bill Prefix', value: d.billPrefix, store: 'medapp', key: 'billPrefix' },
    { label: 'Service Prefix', value: d.servicePrefix, store: 'medapp', key: 'servicePrefix' },
    { label: 'Branch Code', value: d.branchCode, store: 'medapp', key: 'branchCode' },
    { label: 'Licenced From', value: d.licenceFrom, store: 'medapp', key: 'licenceFrom' },
    { label: 'Licenced To', value: d.licenceTo, store: 'medapp', key: 'licenceTo' },
  ]
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | number>()
  const [edit, setEdit] = useState<DefRow | null>(null)
  const [val, setVal] = useState('')

  const save = async () => {
    if (!edit) return
    if (edit.store === 'setting') await saveSettings({ [edit.key]: val } as unknown as Partial<Settings>)
    else await setKv('medapp:defaults', { ...d, [edit.key]: val })
    toast('Value updated')
    setEdit(null)
  }

  return (
    <Canvas height={640}>
      <Title x={148} y={26}>Default Values Management</Title>
      <div style={{ position: 'absolute', left: 14, top: 56 }}>
        <SearchBar value={q} onChange={setQ} width={172} />
      </div>
      <At x={230} y={66}>
        <Rows n={rows.filter((r) => matches(q, r.label, r.value)).length} />
      </At>
      <At x={14} y={92} top>
        <Grid
          cols={[C('label', 'Label', 170), C('value', 'Value', 260)]}
          rows={rows.filter((r) => matches(q, r.label, r.value)).map((r) => ({ id: r.label, cells: { label: r.label, value: r.value } }))}
          height={420}
          width={452}
          selected={sel}
          onSelect={setSel}
          onOpen={(id) => {
            const r = rows.find((x) => x.label === id)
            if (r) {
              setEdit(r)
              setVal(r.value)
            }
          }}
        />
      </At>
      <At x={14} y={530}>
        <Btn
          style={{ width: 104 }}
          onClick={() => {
            const r = rows.find((x) => x.label === sel)
            if (!r) return toast('Select a row', 'error')
            setEdit(r)
            setVal(r.value)
          }}
        >
          Update Value
        </Btn>
      </At>
      {edit && (
        <Dialog title={`Update Value - ${edit.label}`} onClose={() => setEdit(null)} width={380} footer={<><Btn onClick={save}>Save</Btn><Btn onClick={() => setEdit(null)}>cancel</Btn></>}>
          <div className="ma-form" style={{ gridTemplateColumns: '60px 1fr' }}>
            <L bold>Value</L>
            <Input value={val} onChange={setVal} width={250} autoFocus />
          </div>
        </Dialog>
      )}
    </Canvas>
  )
}

/* ═══════════════════════ ADJUST FIELDS ════════════════════════════════════ */
function AdjustFields() {
  const toast = useToast()
  const [tx, setTx] = useState('OTC Medicine Issued/Bill')
  const saved = useKv<Record<string, string[]>>('medapp:adjust-fields', {})
  const allFields = ['Bill No.', 'Date', 'Patient Category', 'Payable By', 'Narration', 'Bill Amount', 'User Name', 'Location']
  const t = useTransfer<string>(allFields)
  const chosen = t.chosen.length ? t.chosen : (saved[tx] ?? allFields)

  const save = async () => {
    if (!t.chosen.length) return toast('Adjust the fields first', 'error')
    await setKv('medapp:adjust-fields', { ...saved, [tx]: t.chosen })
    toast('Field selection saved')
  }

  return (
    <Canvas height={560}>
      <Title x={58} y={26}>Adjust Fields</Title>
      <At x={14} y={80}>
        <L>Transaction</L>
        <Select
          value={tx}
          onChange={(v) => {
            setTx(v)
            t.setChosen(saved[v] ?? [])
            t.setPickLeft(undefined)
            t.setPickRight(undefined)
          }}
          options={['OTC Medicine Issued/Bill', 'OTC Medicine Isse Return', 'Service Request/Bill', 'Sales Quotation', 'Delivery Note', 'Whole Sale Invoice']}
          width={190}
        />
      </At>
      <At x={14} y={120}>
        <L>Available Fields</L>
      </At>
      <At x={640} y={120} right>
        <L>Selected Fields</L>
      </At>
      <At x={14} y={144} top>
        <div style={{ display: 'flex', gap: 12 }}>
          <List items={allFields.filter((f) => !chosen.includes(f))} width={190} height={280} value={t.pickLeft ?? ''} onSelect={(v) => t.setPickLeft(v)} />
          <TransferArrows onRight={() => t.pickLeft !== undefined && t.right()} onLeft={t.left} onAllRight={() => t.setChosen(allFields)} onAllLeft={() => t.setChosen([])} />
          <List items={chosen} width={190} height={280} value={t.pickRight ? String(t.pickRight) : ''} onSelect={(v) => t.setPickRight(v)} />
        </div>
      </At>
      <At x={14} y={470}>
        <Btn style={{ width: 74 }} onClick={save}>Save</Btn>
      </At>
    </Canvas>
  )
}

/* ═══════════════════════ TREE STYLE MRP ═══════════════════════════════════ */
interface Bom {
  name: string
  items: { name: string; sku: string; qty: number }[]
}
function TreeMrp() {
  const toast = useToast()
  const boms = useKv<Bom[]>('medapp:boms', [])
  const products = useProducts()
  const [rows, setRows] = useState<Row[]>([])
  const [pick, setPick] = useState(false)
  const [sel, setSel] = useState<string | number>()

  const open = (b: Bom) => {
    setRows(b.items.map((it, i) => ({ id: i, cells: { name: it.name, sku: it.sku, qty: String(it.qty) } })))
  }
  const save = async () => {
    const base = sel === undefined ? '' : boms.find((x) => x.name === sel)?.name ?? ''
    const n = prompt('Bom_Name:', base) || ''
    if (!n) return
    const list = boms.filter((b) => b.name !== n)
    await setKv('medapp:boms', [...list, { name: n, items: rows.map((r) => ({ name: String(r.cells.name), sku: String(r.cells.sku), qty: num(String(r.cells.qty)) || 1 })) }])
    await logActivity('stock', `BOM saved: ${n}`, { detail: `${rows.length} components` })
    toast('BOM saved')
  }
  const del = async () => {
    const b = boms.find((x) => x.name === sel)
    if (!b) return toast('Select a BOM in the tree', 'error')
    if (!confirm(`Delete BOM ${b.name}?`)) return
    await setKv('medapp:boms', boms.filter((x) => x.name !== b.name))
    setRows([])
    toast('BOM deleted')
  }

  return (
    <Canvas height={640}>
      <Title x={94} y={26}>Tree Style Mrp</Title>
      <At x={14} y={80} top>
        <div style={{ display: 'flex', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', height: 26, marginBottom: 2 }}>
              <span className="ma-search" style={{ width: 84 }}>
                <span className="ma-search-ico"><SearchLens size={18} /></span>
                <input readOnly aria-label="Bom tree" />
              </span>
            </div>
            <Grid cols={[C('name', 'Bom Name', 150)]} rows={boms.map((b) => ({ id: b.name, cells: { name: b.name } }))} height={280} width={162} selected={sel} onSelect={setSel} onOpen={(id) => open(boms.find((x) => x.name === id)!)} />
          </div>
          <div style={{ paddingTop: 30 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <Btn style={{ width: 70 }} onClick={() => sel && open(boms.find((x) => x.name === sel)!)}>Edit</Btn>
              <Btn style={{ width: 70 }} onClick={() => setPick(true)}>Add</Btn>
              <Btn style={{ width: 74 }} onClick={save}>Save</Btn>
              <Btn style={{ width: 86 }} onClick={del}>Delete</Btn>
            </div>
            <Grid
              cols={[C('name', 'Product Name', 200), C('sku', 'Product Code', 100), C('qty', 'Qty', 60, 'right')]}
              rows={rows}
              height={270}
              compact
              width={376}
              onOpen={(id) => {
                const r = rows.find((x) => x.id === id)
                if (r) setRows(rows.map((x) => (x.id === id ? { ...x, cells: { ...x.cells, qty: String((parseInt(String(x.cells.qty), 10) || 0) + 1) } } : x)))
              }}
            />
          </div>
        </div>
      </At>
      <At x={14} y={420} top>
        <span className="ma-label">Double-click a component row to increase its qty. Double-click a Bom Name to open it into the grid.</span>
      </At>
      {pick && (
        <PickList
          title="Product Components"
          options={products.map((p) => p.name.toUpperCase())}
          onClose={() => setPick(false)}
          onPick={(v) => {
            const p = products.find((x) => x.name.toUpperCase() === v)
            if (p) setRows([...rows, { id: rows.reduce((m, r) => Math.max(m, Number(r.id)), -1) + 1, cells: { name: p.name, sku: p.sku, qty: '1' } }])
            setPick(false)
          }}
        />
      )}
    </Canvas>
  )
}

/* ═══════════════════════ UPDATE A/C BAL ═══════════════════════════════════ */
function UpdateAcBal() {
  const toast = useToast()
  const d = useMedDefaults()
  const [from, setFrom] = useState(dmy(Date.now() - 30 * 864e5))
  const [to, setTo] = useState(today())
  const [result, setResult] = useState<{ cols: Col[]; rows: Record<string, string>[] } | null>(null)
  const custs = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])

  const update = async () => {
    const sales = await db.sales.where('createdAt').between(parseDmy(from) ?? 0, (parseDmy(to) ?? Date.now()) + 864e5).toArray()
    const map = new Map<number, number>()
    for (const s of sales.filter((s) => s.payments.some((p) => p.method === 'account') && s.status !== 'refunded' && s.status !== 'voided')) {
      if (s.customerId) map.set(s.customerId, (map.get(s.customerId) ?? 0) + s.total)
    }
    const rows = custs.filter((c) => map.has(c.id!)).map((c) => {
      const computed = map.get(c.id!) ?? 0
      return { name: c.name, computed: amt(computed), stored: amt(c.balance), diff: amt(c.balance - computed) }
    })
    if (!rows.length) return toast('No on-account activity in the period', 'error')
    setResult({ cols: [C('name', 'Customer', 170), C('computed', 'Computed', 90, 'right'), C('stored', 'Stored Balance', 100, 'right'), C('diff', 'Difference (Payment)', 130, 'right')], rows })
  }
  const vch = async () => {
    const n = (await db.sales.where('createdAt').between(parseDmy(from) ?? 0, (parseDmy(to) ?? Date.now()) + 864e5).count()) + (await db.jobs.where('createdAt').between(parseDmy(from) ?? 0, (parseDmy(to) ?? Date.now()) + 864e5).count())
    toast(`${n} voucher(s) checked for valid dates in the period`)
  }

  return (
    <Canvas height={430}>
      <Title x={92} y={26}>Update A/C Bal</Title>
      <At x={14} y={80}>
        <L>From Date</L>
        <Input value={from} onChange={setFrom} width={72} />
        <L>To Date</L>
        <Input value={to} onChange={setTo} width={72} />
      </At>
      <At x={14} y={122}>
        <L>Location</L>
        <LookupField value={d.location} onChange={() => {}} options={[d.location]} width={130} title="Location" />
      </At>
      <At x={14} y={170}>
        <Btn style={{ width: 118 }} onClick={update}>Update A/C Bal</Btn>
      </At>
      <At x={420} y={170}>
        <Btn style={{ width: 124 }} onClick={vch}>Update VchDate</Btn>
      </At>
      <At x={14} y={215}>
        <span className="ma-label" style={{ display: 'block', maxWidth: 620, whiteSpace: 'normal' }}>
          Runs a balance re-verification for debtors from the bill register. Differences (payments received outside bills) are displayed, never silently overwritten.
        </span>
      </At>
      {result && <ResultDialog title="A/C Balance Verification" onClose={() => setResult(null)} {...result} />}
    </Canvas>
  )
}

/* ═══════════════════════ ROLE WISE TRANSACTION PROCESS ════════════════════ */
function RoleWiseTxn() {
  const [role, setRole] = useState('ADMIN')
  const [group, setGroup] = useState<string>()
  const all = Object.entries(MODULE_GROUP_MAP)
  const items = group ? MODULE_GROUP_MAP[group] : []
  return (
    <Canvas height={560}>
      <Title x={106} y={26}>Role Wise Transaction Tree</Title>
      <Group title="" y={56} w={740} h={448}>
        <div style={{ display: 'flex', gap: 16 }}>
          <List items={['ADMIN']} width={140} height={330} value={role} onSelect={setRole} />
          <List items={all.map(([g]) => g)} width={220} height={330} value={group} onSelect={setGroup} />
          <List items={items} width={280} height={330} />
        </div>
      </Group>
    </Canvas>
  )
}

const MODULE_GROUP_MAP: Record<string, string[]> = {
  'RETAIL SALES': ['OTC Medicine Issue/Bill', 'OTC Medicine Isse Return', 'Service Request/Bill'],
  'WHOLE SALES': ['Sales Quotation', 'Delivery Note', 'Credit Note', 'Whole Sale Invoice', 'Credit Note - Direct Invoice', 'Final Bill Receipt', 'Supplier Payment'],
  'PARTY MASTER': ['Party Master'],
  PURCHASES: ['STEP 1: PURCHASE INDENT', 'STEP 2: LOCAL PURCHASE ORDER', 'STEP 3: GRN- Good Recived Note', 'Pur/GRN (Direct Invoice)', 'Medicine', 'Party Master'],
}

/* ═══════════════════════════ TALLY TO N360i ═══════════════════════════════ */
const TALLY_TABLES = ['Bills', 'Bill Lines', 'Cash Collections', 'Debtors', 'Creditors', 'Stock', 'Stock Movements']
function TallyDownload() {
  const toast = useToast()
  const [table, setTable] = useState('')
  const dl = async () => {
    if (!table) return toast('Select a table first', 'error')
    await downloadCsv(`tally-${table.toLowerCase().replace(/\s/g, '-')}`, ['id'], [])
    toast(`${table} exported for N360i`)
  }
  return (
    <Canvas height={430}>
      <Title x={118} y={26}>Tally to N360i</Title>
      <Group title="Tally Tables Download" y={78} w={358}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 300 }}>
          <L bold>Table Name</L>
          <Select value={table} onChange={setTable} options={['', ...TALLY_TABLES]} width={220} />
          <div style={{ marginTop: 8 }}>
            <Btn style={{ width: 108 }} onClick={dl}>Download</Btn>
          </div>
        </div>
      </Group>
    </Canvas>
  )
}

/* ═══════════════════════════════ DB UTILITY ═══════════════════════════════ */
function DbUtility() {
  const toast = useToast()
  const [tab, setTab] = useState('Template')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const run = () => {
    if (!text.trim()) return toast('Enter a query or template first', 'error')
    toast('No live SQL engine. Operation logged only.', 'error')
    void logActivity('system', `DB Utility (${tab})`, { detail: text.trim() })
    setRows([])
  }
  return (
    <Canvas height={620}>
      <Title x={128} y={26}>DB Utility</Title>
      <At x={14} y={62}>
        {['Template', 'Query', 'Update'].map((t) => (
          <button key={t} type="button" className={`ma-blue${tab === t ? ' is-active' : ''}`} style={{ width: 98 }} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </At>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{ position: 'absolute', left: 14, top: 104, width: 700, height: 320, fontFamily: 'monospace', fontSize: 12, border: '1px solid #c3c3c3' }}
      />
      <At x={14} y={446}>
        <Btn style={{ width: 108 }} onClick={run}>Execute</Btn>
      </At>
      <At x={14} y={486} top>
        <Grid cols={[C('r', 'Row', 80), C('res', 'Result', 560)]} rows={rows} height={120} width={650} />
      </At>
    </Canvas>
  )
}

/** Shown to cashiers who open an admin-only utility. */
function AdminOnly({ what }: { what: string }) {
  return (
    <Canvas height={200}>
      <Title x={110} y={26}>{what}</Title>
      <At x={14} y={80}>
        <span className="ma-label">Only the admin can use {what}. Sign in as the admin to continue.</span>
      </At>
    </Canvas>
  )
}

export default function UtilityPage() {
  const { slug } = useParams()
  const { can } = useSession()
  switch (slug) {
    case 'chemists':
      return can('branches') ? <ChemistsPage /> : <AdminOnly what="Chemists (Branches)" />
    case 'role-wise-transaction-process':
      return <RoleWiseTxn />
    case 'tally-to-n360i':
      return <TallyDownload />
    case 'db-utility':
      return <DbUtility />
    case 'auto-generate':
      return <AutoGenerate />
    case 'document-center':
      return <DocumentCenter />
    case 'auto-indent':
      return <AutoIndent />
    case 'others':
      return <Others />
    case 'force-close':
      return <ForceClose />
    case 'regenerate-link':
      return <RegenerateLink />
    case 'payroll':
      return <PayRoll />
    case 'export-viewdata':
      return <ExportViewData />
    case 'product-automation':
      return <ProductAutomation />
    case 'transaction-automation':
      return <TransactionAutomation />
    case 'reconciliation':
      return <Reconciliation />
    case 'stock-update':
      return <StockUpdate />
    case 'ac-update':
      return <AcUpdate />
    case 'user-management':
      return can('users') ? <UserManagement /> : <AdminOnly what="User Management" />
    case 'data-management':
      return can('settings') ? <DataManagement /> : <AdminOnly what="Data Management" />
    case 'auto-number-reset':
      return <AutoNumberReset />
    case 'sync':
      return <Sync />
    case 'default-values':
      return <DefaultValues />
    case 'adjust-fields':
      return <AdjustFields />
    case 'tree-style-mrp':
      return <TreeMrp />
    default:
      return <UpdateAcBal />
  }
}
