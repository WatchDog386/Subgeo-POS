import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileSpreadsheet, Database, UserCog, RefreshCw, ClipboardList } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { downloadCsv, toCsv, download } from '../lib/csv'
import { ErpPanel, SearchResultNote } from './piLists'
import { money } from '../lib/money'

// Utilities page mirroring the old medapp sidebar list. Each item either
// links to its management screen or performs a one-click action below.

export default function ErpUtilitiesPage() {
  const nav = useNavigate()
  const settings = useSettings()
  const products = useLiveQuery(() => db.products.toArray(), [])
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const pos = useLiveQuery(() => db.purchaseOrders.toArray(), [])
  const logs = useLiveQuery(() => db.logs.orderBy('at').reverse().limit(500).toArray(), [])

  const exportProducts = useCallback(() => {
    if (!products) return
    downloadCsv(
      'viewdata-products',
      ['SKU', 'Barcode', 'Name', 'Cost', 'Price', 'Stock', 'Reorder', 'Location'],
      products.map((p) => [p.sku, p.barcode ?? '', p.name, money(p.cost, 'KES'), money(p.price, 'KES'), p.stock, p.reorderLevel, p.location ?? '']),
    )
  }, [products])

  const exportSales = useCallback(() => {
    if (!sales) return
    const rows: (string | number)[][] = []
    for (const s of sales)
      for (const ln of s.lines) rows.push([s.receiptNo, new Date(s.createdAt).toISOString(), ln.sku ?? '', ln.name, ln.qty, ln.unitPrice, ln.discount, s.total])
    download('viewdata-sales', toCsv([['Receipt', 'Date', 'Item Code', 'Item', 'Qty', 'Unit Price', 'Line Discount', 'Bill Total'], ...rows]))
  }, [sales])

  const reindexStock = useCallback(async () => {
    // Stock Update Automation: recompute each product's on-hand ledger total
    // from movement history and correct drift automatically.
    const [allProducts, movements] = await Promise.all([db.products.toArray(), db.movements.toArray()])
    for (const p of allProducts) {
      if (!p.trackStock) continue
      const net = movements.filter((m) => m.productId === p.id).reduce((s, m) => s + m.change, 0)
      const adjustments = net - p.stock
      if (adjustments !== 0) await db.movements.add({ productId: p.id as number, change: adjustments, reason: 'adjust', reference: 'AUTO-STOCK-SYNC', userId: undefined, at: Date.now() })
    }
    window.alert('Stock ledger synced: counted-adjust entries created where on-hand drifted.')
  }, [])

  const cards: { title: string; desc: string; icon: typeof Database; action: () => void; cta: string }[] = [
    { title: 'User Management', desc: 'Users, roles and PINs for till access.', icon: UserCog, action: () => nav('/staff'), cta: 'Open' },
    { title: 'Export ViewData (Products)', desc: 'Product master to CSV — SKU, prices, stock, bin.', icon: FileSpreadsheet, action: exportProducts, cta: 'Export CSV' },
    { title: 'Export ViewData (Transactions)', desc: 'All sales lines with receipts, discounts, totals.', icon: FileSpreadsheet, action: exportSales, cta: 'Export CSV' },
    { title: 'Stock Update Automation', desc: 'Re-sync on-hand stock with the movement ledger.', icon: RefreshCw, action: () => void reindexStock(), cta: 'Run' },
    { title: 'Data Management', desc: 'Backup / restore the shop database.', icon: Database, action: () => nav('/settings'), cta: 'Open' },
    { title: 'Reconciliation (Shift)', desc: 'Open, close and count till sessions.', icon: ClipboardList, action: () => nav('/shift'), cta: 'Open' },
  ]

  const counts = [
    { label: 'Medicines Master rows', value: (products ?? []).length },
    { label: 'Bills on file', value: (sales ?? []).length },
    { label: 'Party Master rows', value: (customers ?? []).length },
    { label: 'Purchase orders', value: (pos ?? []).length },
    { label: 'Audit log entries', value: (logs ?? []).length },
  ]

  return (
    <div className="space-y-3">
      <ErpPanel title={`Utilities - ${settings.shopName.toUpperCase()}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <button key={c.title} type="button" onClick={c.action} className="flex items-start gap-3 rounded-[4px] border border-[#c7ccd0] bg-white px-3 py-3 text-left shadow-sm transition hover:border-[#969ea4] hover:bg-[#f3f4f5]">
              <c.icon size={20} className="mt-0.5 shrink-0 text-[#3b74b8]" />
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-slate-800">{c.title}</span>
                <span className="block text-[12px] text-slate-500">{c.desc}</span>
                <span className="mt-1 inline-block rounded-sm border border-[#cc7010] bg-[#f2891d] px-2 py-0.5 text-[11px] font-bold text-white">{c.cta}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="space-y-1 px-1 pt-1">
          {counts.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-[12px] text-slate-600">
              <span>{c.label}</span>
              <span className="font-bold text-slate-800">{c.value}</span>
            </div>
          ))}
          <SearchResultNote count={counts.reduce((s, c) => s + c.value, 0)} />
        </div>
      </ErpPanel>
    </div>
  )
}
