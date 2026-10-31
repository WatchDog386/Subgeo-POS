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
