// A till that ran the single-shop version (schema v2, PIN accounts) upgrades in place:
// its data becomes CHEM1's and is queued for upload; PIN accounts give way to the starter logins.
import { expect, it, vi } from 'vitest'
import Dexie from 'dexie'

it('upgrades a v2 till to multi-chemist', async () => {
  vi.resetModules()
  const old = new Dexie('subgeo-pos')
  old.version(1).stores({
    users: '++id, pin, role',
    categories: '++id, name',
    suppliers: '++id, name',
    products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
    customers: '++id, name, phone, plate, balance',
    sales: '++id, &receiptNo, createdAt, customerId, userId, shiftId, status',
    parked: '++id, createdAt',
    movements: '++id, productId, at, reason',
    purchaseOrders: '++id, &poNo, supplierId, status, createdAt',
    shifts: '++id, userId, openedAt, closedAt',
    jobs: '++id, &jobNo, customerId, status, createdAt',
    kv: 'key',
  })
  old.version(2).stores({ logs: '++id, at, kind, userId' })
  await old.table('users').bulkAdd([{ name: 'Owner', pin: '1234', role: 'owner', active: true }])
  await old.table('products').add({ sku: 'X1', name: 'Old med', stock: 4, cost: 1, price: 2, fitment: [], active: true })
  await old.table('kv').put({ key: 'seq:R', value: 41 })
  old.close()

  const { db } = await import('../db/db')
  const { seedIfEmpty } = await import('../db/seed')
  await seedIfEmpty()
  const users = await db.users.toArray()
  expect(users.map((u) => u.username).sort()).toEqual(['admin', 'purchase', 'subgeo'])
  expect(users.every((u) => (u as { _dirty?: number })._dirty === 0)).toBe(true)
  const p = (await db.products.toArray())[0] as unknown as Record<string, unknown>
  expect(p.stock).toBe(4)
  expect(p._dirty).toBe(1)
  expect(p._d_stock).toBe(0)
  expect(((await db.kv.get('seq:R')) as unknown as Record<string, unknown>)._dirty).toBe(1)
  expect(await db.branches.count()).toBe(1)
})

// A till on schema v3 (documents and tasks kept as kv lists) upgrades to v4:
// every entry becomes its own record with the stable id the server also uses,
// sample rows from old builds are dropped, and unsent edits stay queued.
it('upgrades v3 document and task lists to their own tables', async () => {
  vi.resetModules()
  // Start from a v3 till: drop what the previous test left.
  await Dexie.delete('subgeo-pos')
  const old = new Dexie('subgeo-pos')
  old.version(3).stores({
    users: '++id, username, role, branchId, _dirty',
    branches: '++id, number, _dirty',
    categories: '++id, name, _dirty',
    suppliers: '++id, name, _dirty',
    products: '++id, sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active, _dirty',
    customers: '++id, name, phone, plate, balance, _dirty',
    sales: '++id, receiptNo, createdAt, customerId, userId, shiftId, status, _dirty',
    parked: '++id, createdAt, _dirty',
    movements: '++id, productId, at, reason, _dirty',
    purchaseOrders: '++id, poNo, supplierId, status, createdAt, _dirty',
    shifts: '++id, userId, openedAt, closedAt, _dirty',
    jobs: '++id, jobNo, customerId, status, createdAt, _dirty',
    logs: '++id, at, kind, userId, _dirty',
    kv: 'key, _dirty',
    outbox: '++seq',
  })
  await old.table('kv').bulkPut([
    {
      key: 'medapp:docs:purchase-indent',
      value: [
        { id: 1, createdAt: 1, values: { location: 'SCL UMOJA 3', docNo: 'PI-1-24', indentDate: '15-01-2024', indentor: 'ADMIN', status: 'INDENT APPROVED', purpose: 'reorder', approx: '2000.00' } },
        { id: 4, createdAt: 5, values: { docNo: 'PI-4-26', purpose: 'syrups', approx: '900.00' } },
      ],
      _dirty: 1,
      _ts: 10,
    },
    { key: 'medapp:tasks', value: [{ id: 1790000000000, text: 'Count shelf A', assigner: 'ADMIN', assignee: 'ALL CHEM1', status: 'PENDING', createdAt: 1790000000000 }], _dirty: 0, _ts: 5 },
  ])
  old.close()

  const { db } = await import('../db/db')
  const { legacyDocId } = await import('../db/legacyDemo')
  await db.open()
  const docs = await db.docs.toArray()
  expect(docs.map((d) => d.docNo)).toEqual(['PI-4-26'])
  expect(docs[0].id).toBe(legacyDocId('purchase-indent', 4))
  expect(docs[0].slug).toBe('purchase-indent')
  expect((docs[0] as unknown as { _dirty: number })._dirty).toBe(1)
  expect((await db.tasks.toArray()).map((t) => t.text)).toEqual(['Count shelf A'])
  expect(await db.kv.get('medapp:docs:purchase-indent')).toBeUndefined()
  expect(await db.kv.get('medapp:tasks')).toBeUndefined()
  // Converting never queues deletes of the old lists (the server drops its own copy).
  expect(await db.outbox.count()).toBe(0)
})
