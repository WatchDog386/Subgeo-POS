// End-to-end: real server (Express + SQLite) and three tills — admin, cashier
// and the purchases dashboard. Checks that what each dashboard saves reaches
// the others, lands in the relational tables with its foreign keys, and that
// documents / tasks saved on two tills at once never overwrite each other.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

type DbMod = typeof import('../db/db')
type SyncMod = typeof import('../db/sync')
type SalesMod = typeof import('../db/sales')
type DataMod = typeof import('../medapp/data')
type TasksMod = typeof import('../medapp/tasks')
type Device = { db: DbMod; sync: SyncMod; sales: SalesMod; data: DataMod; tasks: TasksMod; user: { id: number; name: string } }
type SqlMod = typeof import('../../server/db')
type RelMod = typeof import('../../server/relational')

let server: Server
let base = ''
let sqlMod: SqlMod
let rel: RelMod
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subgeo-rel-'))

async function device(username: string, password: string): Promise<Device> {
  vi.resetModules()
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  ;(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange
  const db = await import('../db/db')
  const sync = await import('../db/sync')
  const sales = await import('../db/sales')
  // The screens' own helpers, bound to this device's database.
  const data = await import('../medapp/data')
  const tasks = await import('../medapp/tasks')
  const { seedIfEmpty } = await import('../db/seed')
  sync.setApiBase(base)
  await seedIfEmpty()
  const r = await sync.api<{ token: string; user: { id: number; name: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  sync.setSyncToken(r.token)
  await sync.syncNow()
  return { db, sync, sales, data, tasks, user: r.user }
}

const q = <T = Record<string, unknown>>(s: string, ...args: unknown[]) => sqlMod.sql.prepare(s).all(...args) as T[]
const one = <T = Record<string, unknown>>(s: string, ...args: unknown[]) => sqlMod.sql.prepare(s).get(...args) as T

beforeAll(async () => {
  process.env.DB_PATH = path.join(tmp, 'rel.db')
  const express = (await import('express')).default
  sqlMod = await import('../../server/db')
  rel = await import('../../server/relational')
  const { ensureSeeds, syncRouter } = await import('../../server/sync')
  sqlMod.migrate()
  ensureSeeds()
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use('/api', syncRouter)
  await new Promise<void>((res) => {
    server = app.listen(0, () => res())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const product = (sku: string, stock: number, supplierId?: number) => ({
  sku,
  name: `Med ${sku}`,
  cost: 50_00,
  price: 120_00,
  stock,
  reorderLevel: 2,
  supplierId,
  fitment: [],
  taxable: true,
  serialized: false,
  trackStock: true,
  active: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

describe('relational company database', () => {
  let admin: Device
  let cashier: Device
  let purchase: Device
  let supplierId = 0
  let productId = 0
  let saleId = 0

  it('creates every table with foreign keys switched on', () => {
    const tables = q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name)
    for (const t of ['branches', 'users', 'products', 'sales', 'sale_lines', 'sale_payments', 'documents', 'staff_tasks', 'staff_messages', 'purchase_order_lines', 'service_jobs', 'activity_logs', 'app_values']) {
      expect(tables).toContain(t)
    }
    expect(sqlMod.sql.pragma('foreign_keys', { simple: true })).toBe(1)
    const fks = q<{ table: string }>("SELECT 'sale_lines' AS t, * FROM pragma_foreign_key_list('sale_lines')")
    expect(fks.map((f) => f.table).sort()).toEqual(['products', 'sales'])
    // Starter accounts are linked to the starter chemist.
    expect(q('SELECT username, branch_id FROM users ORDER BY id')).toEqual([
      { username: 'admin', branch_id: null },
      { username: 'subgeo', branch_id: 1 },
      { username: 'purchase', branch_id: 1 },
    ])
  })

  it('signs in all three dashboards (purchase with no password)', async () => {
    admin = await device('admin', 'subgeo22')
    cashier = await device('subgeo', '0000')
    purchase = await device('purchase', '')
    expect(purchase.sync.getSyncState().status).toBe('idle')
  })

  it('mirrors a sale with its lines, payments and links', async () => {
    supplierId = (await admin.db.db.suppliers.add({ name: 'TABACAN LTD', phone: '0700000001' })) as number
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    productId = (await cashier.db.db.products.add(product('PCM500', 20, supplierId))) as number
    const sale = await cashier.sales.completeSale({
      lines: [{ productId, name: 'Med PCM500', sku: 'PCM500', qty: 2, unitPrice: 120_00, unitCost: 50_00, discount: 0, taxable: true }],
      discount: 0,
      payments: [{ method: 'mpesa', amount: 240_00, reference: 'QAB12CD34' }],
      userId: cashier.user.id,
    })
    saleId = sale.id!
    await cashier.sync.syncNow()

    expect(one('SELECT branch_id, supplier_id, stock FROM products WHERE id = ?', productId)).toEqual({ branch_id: 1, supplier_id: supplierId, stock: 18 })
    expect(one('SELECT branch_id, user_id, total, status FROM sales WHERE id = ?', saleId)).toEqual({ branch_id: 1, user_id: cashier.user.id, total: 240_00, status: 'completed' })
    expect(q('SELECT line_no, product_id, qty, unit_price FROM sale_lines WHERE sale_id = ?', saleId)).toEqual([{ line_no: 1, product_id: productId, qty: 2, unit_price: 120_00 }])
    expect(q('SELECT method, amount, reference FROM sale_payments WHERE sale_id = ?', saleId)).toEqual([{ method: 'mpesa', amount: 240_00, reference: 'QAB12CD34' }])
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ? AND reason = 'sale'", productId).n).toBe(1)
    expect(one<{ total_cents: number }>("SELECT total_cents FROM v_daily_sales WHERE chemist = 'CHEM1'").total_cents).toBe(240_00)
  })

  it('stores purchase documents one per record and links the purchase flow', async () => {
    const { saveDoc } = purchase.data
    await saveDoc('purchase-indent', { docNo: 'PI-1-26', indentDate: '01-10-2026', indentor: 'PURCHASE', status: 'INDENT APPROVED', purpose: 'reorder', approx: '2,500.00' })
    await saveDoc('local-purchase-order', { docNo: 'PO-1-26', indentNo: 'PI-1-26', poDate: '02-10-2026', vendorName: 'TABACAN LTD' })
    await saveDoc('pur-inv-grn', { docNo: 'GRN-1-26', lpoNo: 'PO-1-26', supInvDate: '05-10-2026', vendorName: 'TABACAN LTD' })
    await purchase.sync.syncNow()

    const docs = q<{ doc_type: string; doc_no: string; supplier_id: number | null; amount: number | null; ref_doc_no: string | null }>(
      'SELECT doc_type, doc_no, supplier_id, amount, ref_doc_no FROM documents ORDER BY doc_no',
    )
    expect(docs).toEqual([
      { doc_type: 'pur-inv-grn', doc_no: 'GRN-1-26', supplier_id: supplierId, amount: null, ref_doc_no: 'PO-1-26' },
      { doc_type: 'purchase-indent', doc_no: 'PI-1-26', supplier_id: null, amount: 250_000, ref_doc_no: null },
      { doc_type: 'local-purchase-order', doc_no: 'PO-1-26', supplier_id: supplierId, amount: null, ref_doc_no: 'PI-1-26' },
    ])
    expect(q('SELECT indent_no, lpo_no, grn_no, stage FROM v_purchase_flow')).toEqual([{ indent_no: 'PI-1-26', lpo_no: 'PO-1-26', grn_no: 'GRN-1-26', stage: 'RECEIVED' }])
    // The admin's till sees them.
    await admin.sync.syncNow()
    expect(await admin.db.db.docs.where('slug').equals('pur-inv-grn').count()).toBe(1)
  })

  it('keeps documents saved on two tills at the same time', async () => {
    const a = purchase.data
    const b = admin.data
    await a.saveDoc('pur-grn-direct-invoice', { docNo: 'MRN-1-26', invoice: '111', vendorName: 'TABACAN LTD', total: '100.00' })
    await b.saveDoc('pur-grn-direct-invoice', { docNo: 'MRN-2-26', invoice: '222', vendorName: 'TABACAN LTD', total: '200.00' })
    await purchase.sync.syncNow()
    await admin.sync.syncNow()
    await purchase.sync.syncNow()
    expect((await purchase.db.db.docs.where('slug').equals('pur-grn-direct-invoice').toArray()).map((d) => d.docNo).sort()).toEqual(['MRN-1-26', 'MRN-2-26'])
    expect(one<{ n: number; s: number }>("SELECT COUNT(*) AS n, SUM(amount) AS s FROM documents WHERE doc_type = 'pur-grn-direct-invoice'")).toEqual({ n: 2, s: 300_00 })
  })

  it('syncs tasks from the admin to the purchase dashboard and back', async () => {
    const adminTasks = admin.tasks
    const id = await adminTasks.addTask({ text: 'Raise LPO for syrups', assigner: 'ADMIN', assignerId: admin.user.id, assigneeId: purchase.user.id, assignee: 'PURCHASE' })
    await admin.sync.syncNow()
    await purchase.sync.syncNow()
    const purchaseTasks = purchase.tasks
    expect((await purchase.db.db.tasks.get(id))?.status).toBe('PENDING')
    await purchaseTasks.setTaskStatus(id, 'COMPLETED', { name: 'PURCHASE' } as never)
    await purchase.sync.syncNow()
    await admin.sync.syncNow()
    expect((await admin.db.db.tasks.get(id))?.completedBy).toBe('PURCHASE')
    expect(one('SELECT status, assigner_id, assignee_id FROM staff_tasks WHERE id = ?', id)).toEqual({ status: 'COMPLETED', assigner_id: admin.user.id, assignee_id: purchase.user.id })
  })

  it('delivers staff messages company-wide; only the sender may edit them', async () => {
    const id = (await cashier.db.db.messages.add({ fromId: cashier.user.id, fromName: 'SUBGEO', toId: undefined, toName: 'EVERYONE', subject: 'Stock count', body: 'Friday 6pm', at: Date.now(), readBy: [] })) as number
    await cashier.sync.syncNow()
    await purchase.sync.syncNow()
    expect((await purchase.db.db.messages.get(id))?.subject).toBe('Stock count')
    // Marking it read is allowed …
    await purchase.db.db.messages.update(id, { readBy: [purchase.user.id] })
    await purchase.sync.syncNow()
    expect(q('SELECT user_id FROM staff_message_reads WHERE message_id = ?', id)).toEqual([{ user_id: purchase.user.id }])
    // … rewriting someone else's message is not.
    await purchase.db.db.messages.update(id, { body: 'changed' })
    await purchase.sync.syncNow()
    expect(purchase.sync.getSyncState().error).toMatch(/Only the sender/)
    expect((await purchase.db.db.messages.get(id))?.body).toBe('Friday 6pm')
  })

  it('sets references to NULL when a parent is deleted, never losing history', async () => {
    await cashier.db.db.products.delete(productId)
    await new Promise((r) => setTimeout(r, 20))
    await cashier.sync.syncNow()
    expect(one('SELECT id FROM products WHERE id = ?', productId)).toBeUndefined()
    expect(one('SELECT product_id, name FROM sale_lines WHERE sale_id = ?', saleId)).toEqual({ product_id: null, name: 'Med PCM500' })
  })

  it('converts document lists pushed by a till on an old build, dropping demo rows', async () => {
    const legacyDemo = await import('../db/legacyDemo')
    const token = cashier.sync.syncToken()
    const list = [
      { id: 1, createdAt: Date.now(), values: { docNo: 'MRN-300-26', mrnDate: '20-10-2026', invoice: '174357', vendorName: 'TABACAN LTD', total: '166.00', expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' } },
      { id: 7, createdAt: Date.now(), values: { docNo: 'MRN-77-26', invoice: '999', vendorName: 'TABACAN LTD', total: '77.00' } },
    ]
    const r = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ branchId: 1, changes: [{ t: 'kv', id: 'medapp:docs:pur-grn-direct-invoice', data: { key: 'medapp:docs:pur-grn-direct-invoice', value: list }, ts: Date.now() }], deletes: [] }),
    })
    expect(r.status).toBe(200)
    const kept = legacyDemo.legacyDocId('pur-grn-direct-invoice', 7)
    expect(one('SELECT doc_no FROM documents WHERE id = ?', kept)).toEqual({ doc_no: 'MRN-77-26' })
    expect(one('SELECT id FROM documents WHERE id = ?', legacyDemo.legacyDocId('pur-grn-direct-invoice', 1))).toBeUndefined()
    expect(one<{ deleted: number }>("SELECT deleted FROM sync_records WHERE tbl = 'kv' AND id = 'medapp:docs:pur-grn-direct-invoice'").deleted).toBe(1)
    await cashier.sync.syncNow()
    expect((await cashier.db.db.docs.get(kept))?.docNo).toBe('MRN-77-26')
  })

  it('rebuilds to exactly the same rows, with no broken references', () => {
    const tables = ['branches', 'users', 'suppliers', 'products', 'sales', 'sale_lines', 'sale_payments', 'stock_movements', 'documents', 'staff_tasks', 'staff_messages', 'staff_message_reads', 'app_values']
    const snapshot = () => Object.fromEntries(tables.map((t) => [t, q(`SELECT * FROM ${t} ORDER BY 1, 2`)]))
    const before = snapshot()
    rel.rebuildRelational()
    expect(snapshot()).toEqual(before)
    expect(sqlMod.sql.pragma('foreign_key_check')).toEqual([])
    expect(rel.projectionFailures()).toBe(0)
  })
})

