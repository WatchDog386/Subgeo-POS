// End-to-end: a real server (Express + SQLite in a temp file) and two tills,
// each with its own IndexedDB, syncing through it.
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
type StaffMod = typeof import('../db/staff')
type Device = { db: DbMod; sync: SyncMod; sales: SalesMod; staff: StaffMod }

let server: Server
let base = ''
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subgeo-sync-'))

/** A fresh copy of the till modules with its own IndexedDB — one "device". */
async function device(username: string, password: string): Promise<Device> {
  vi.resetModules()
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  ;(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange
  const db = await import('../db/db')
  const sync = await import('../db/sync')
  const sales = await import('../db/sales')
  const staff = await import('../db/staff')
  const { seedIfEmpty } = await import('../db/seed')
  sync.setApiBase(base)
  await seedIfEmpty()
  const r = await sync.api<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  sync.setSyncToken(r.token)
  await sync.syncNow()
  return { db, sync, sales, staff }
}

beforeAll(async () => {
  process.env.DB_PATH = path.join(tmp, 'test.db')
  const express = (await import('express')).default
  const { migrate } = await import('../../server/db')
  const { ensureSeeds, syncRouter } = await import('../../server/sync')
  migrate()
  ensureSeeds()
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use('/api', syncRouter)
  // (server/index.ts also marks /api responses no-store)
  await new Promise<void>((res) => {
    server = app.listen(0, () => res())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const product = (sku: string, stock: number) => ({
  sku,
  name: `Med ${sku}`,
  cost: 100_00,
  price: 200_00,
  stock,
  reorderLevel: 2,
  fitment: [],
  taxable: true,
  serialized: false,
  trackStock: true,
  active: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

describe('multi-chemist sync', () => {
  let cashier: Device
  let admin: Device
  let productId = 0

  it('rejects a wrong password and accepts the starter accounts', async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }) })
    expect(r.status).toBe(401)
    cashier = await device('subgeo', '0000')
    admin = await device('admin', 'subgeo22')
    expect(cashier.sync.getSyncState().status).toBe('idle')
  })

  it('uploads a medicine from the cashier and the admin receives it', async () => {
    productId = (await cashier.db.db.products.add(product('PARA', 10))) as number
    await cashier.sync.syncNow()
    await admin.sync.syncNow()
    const p = await admin.db.db.products.get(productId)
    expect(p?.stock).toBe(10)
    expect(await cashier.db.db.products.where('_dirty').equals(1).count()).toBe(0)
  })

  it('merges stock changes made on two tills at the same time', async () => {
    const p = (await cashier.db.db.products.get(productId))!
    // Cashier sells 3 while the admin receives 5 — neither has seen the other.
    await cashier.sales.completeSale({
      lines: [{ productId, name: p.name, sku: p.sku, qty: 3, unitPrice: p.price, unitCost: p.cost, discount: 0, taxable: true }],
      discount: 0,
      payments: [{ method: 'cash', amount: 600_00 }],
      userId: 2,
    })
    await admin.sales.adjustStock(productId, 5, 'receive', 1, 'delivery')
    await cashier.sync.syncNow()
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    expect((await cashier.db.db.products.get(productId))?.stock).toBe(12)
    expect((await admin.db.db.products.get(productId))?.stock).toBe(12)
    expect(await admin.db.db.sales.count()).toBe(1)
  })

  it('lets the admin create a chemist and a cashier for it; tills learn about them', async () => {
    const branchId = (await admin.db.db.branches.add({ number: 2, name: 'SCL KAYOLE', active: true, createdAt: Date.now() })) as number
    await admin.staff.saveStaff({ name: 'Jane', username: 'jane', password: 'pass1', role: 'cashier', branchId, active: true })
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    expect((await cashier.db.db.branches.get(branchId))?.number).toBe(2)
    const jane = await cashier.db.db.users.where('username').equals('jane').first()
    expect(jane?.branchId).toBe(branchId)
    // Jane can sign in on the server and only reaches her chemist.
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jane', password: 'pass1' }) })
    const { token } = (await r.json()) as { token: string }
    const own = await fetch(`${base}/api/sync/pull?branch=${branchId}&since=0`, { headers: { Authorization: `Bearer ${token}` } })
    expect(own.status).toBe(200)
    const other = await fetch(`${base}/api/sync/pull?branch=1&since=0`, { headers: { Authorization: `Bearer ${token}` } })
    expect(other.status).toBe(403)
  })

  it('keeps chemists apart: CHEM2 data never reaches the CHEM1 till', async () => {
    const branch2 = (await admin.db.db.branches.where('number').equals(2).first())!.id!
    await admin.sync.flushPending()
    await admin.db.switchBranchDb(branch2)
    await admin.db.db.products.add(product('AMOX', 7))
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    expect(await cashier.db.db.products.where('sku').equals('AMOX').count()).toBe(0)
    await admin.db.switchBranchDb(1)
    await admin.sync.syncNow()
    expect(await admin.db.db.products.where('sku').equals('AMOX').count()).toBe(0)
    expect(await admin.db.db.products.where('sku').equals('PARA').count()).toBe(1)
  })

  it('refuses staff changes from a cashier and restores the server copy', async () => {
    const jane = (await cashier.db.db.users.where('username').equals('jane').first())!
    await cashier.db.db.users.update(jane.id!, { role: 'owner' })
    await cashier.sync.syncNow()
    expect(cashier.sync.getSyncState().error).toMatch(/Server refused/)
    expect((await cashier.db.db.users.get(jane.id!))?.role).toBe('cashier')
  })

  it('propagates deletes', async () => {
    const cid = (await admin.db.db.customers.add({ name: 'Walk-in Clinic', balance: 0, creditLimit: 0, createdAt: Date.now() })) as number
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    expect(await cashier.db.db.customers.get(cid)).toBeDefined()
    await admin.db.db.customers.delete(cid)
    await new Promise((r) => setTimeout(r, 20))
    await admin.sync.syncNow()
    await cashier.sync.syncNow()
    expect(await cashier.db.db.customers.get(cid)).toBeUndefined()
  })

  it('transfers stock between chemists on the server', async () => {
    const branch2 = (await admin.db.db.branches.where('number').equals(2).first())!.id!
    await admin.sync.api('/admin/transfer', { method: 'POST', body: JSON.stringify({ from: 1, to: branch2, items: [{ productId, qty: 2 }] }) })
    await cashier.sync.syncNow()
    expect((await cashier.db.db.products.get(productId))?.stock).toBe(10)
    const list = await admin.sync.api<{ sku: string; stock: number }[]>(`/admin/products?branch=${branch2}`)
    expect(list.find((p) => p.sku === 'PARA')?.stock).toBe(2)
    expect(await cashier.db.db.movements.where('reason').equals('transfer').count()).toBe(1)
  })

  it('reports every chemist in the admin overview', async () => {
    const dayStart = new Date().setHours(0, 0, 0, 0)
    const r = await admin.sync.api<{ branches: { number: number; todaySales: number; stockValue: number; staff: unknown[] }[] }>(`/admin/overview?dayStart=${dayStart}&monthStart=0`)
    const b1 = r.branches.find((b) => b.number === 1)!
    expect(b1.todaySales).toBe(600_00)
    expect(b1.stockValue).toBe(10 * 100_00)
    expect(r.branches.find((b) => b.number === 2)?.staff).toHaveLength(1)
    // Cashiers can't see it.
    const login = await cashier.sync.api<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'subgeo', password: '0000' }) })
    const denied = await fetch(`${base}/api/admin/overview`, { headers: { Authorization: `Bearer ${login.token}` } })
    expect(denied.status).toBe(403)
  })

  it('never lets the last admin be disabled', async () => {
    await expect(admin.staff.saveStaff({ id: 1, name: 'ADMIN', username: 'admin', role: 'owner', active: false })).rejects.toThrow(/active admin/)
  })
})
