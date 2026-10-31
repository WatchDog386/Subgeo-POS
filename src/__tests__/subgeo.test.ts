// Chemists SUBGEO1 … SUBGEO12 with one shared cashier user name "subgeo":
// the password picks the chemist (0001 → SUBGEO1 … 0012 → SUBGEO12).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let server: Server
let base = ''
let sync: typeof import('../../server/sync')
let sqlMod: typeof import('../../server/db')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subgeo-12-'))

beforeAll(async () => {
  process.env.DB_PATH = path.join(tmp, 's.db')
  const express = (await import('express')).default
  sqlMod = await import('../../server/db')
  sync = await import('../../server/sync')
  sqlMod.migrate()
  sync.ensureSeeds()
  const app = express()
  app.use(express.json())
  app.use('/api', sync.syncRouter)
  await new Promise<void>((res) => {
    server = app.listen(0, () => res())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const login = (username: string, password: string) =>
  fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as { user?: { branchId?: number; name: string }; branches?: { id: number; number: number }[] } }))

describe('SUBGEO1 … SUBGEO12', () => {
  it('moves the stocked chemist 1 to number 12, swapping with an empty chemist 12', async () => {
    // Chemist 1 has its medicines; someone already made an empty chemist 12.
    const { token } = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'subgeo22' }) })).json()) as { token: string }
    const now = Date.now()
    const push = (branchId: number, changes: unknown[]) =>
      fetch(`${base}/api/sync/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ branchId, changes, deletes: [] }) })
    await push(1, [{ t: 'branches', id: 777, data: { id: 777, number: 12, name: 'CHEM 12 SPARE', active: true, createdAt: now }, ts: now }])
    // As the earlier setup left it: the empty chemist 12 already had "subgeo" / 0012.
    const { hashPassword } = await import('../lib/sha256')
    await push(1, [{ t: 'users', id: 778, data: { id: 778, name: 'SUBGEO12', username: 'subgeo', salt: 's778', passHash: hashPassword('s778', '0012'), role: 'cashier', active: true, branchId: 777 }, ts: now }])
    await push(1, [{ t: 'products', id: 5001, data: { id: 5001, sku: 'P1', name: 'PANADOL', cost: 100, price: 200, stock: 40, reorderLevel: 0, fitment: [], taxable: false, serialized: false, trackStock: true, active: true, createdAt: now, updatedAt: now }, ts: now, deltas: { stock: 0 } }])
    const out = sync.setupSubgeoChemists(12)
    expect(out.join('\n')).toMatch(/is now SUBGEO12/)
    expect(out.join('\n')).toMatch(/empty SUBGEO12 \(CHEM 12 SPARE\) is now SUBGEO1/)
    expect(sqlMod.sql.prepare('SELECT number FROM branches WHERE id = 1').get()).toEqual({ number: 12 })
    expect(sqlMod.sql.prepare('SELECT number FROM branches WHERE id = 777').get()).toEqual({ number: 1 })
    expect(sqlMod.sql.prepare("SELECT b.code FROM products p JOIN branches b ON b.id = p.branch_id WHERE p.sku = 'P1'").get()).toEqual({ code: 'SUBGEO12' })
  })

  it('creates the twelve chemists and their cashiers', () => {
    const codes = (sqlMod.sql.prepare('SELECT code FROM branches ORDER BY number').all() as { code: string }[]).map((r) => r.code)
    expect(codes).toEqual([...Array.from({ length: 12 }, (_, i) => `SUBGEO${i + 1}`), 'HQ'])
    expect((sqlMod.sql.prepare("SELECT number FROM branches WHERE id = 1").get() as { number: number }).number).toBe(12)
    expect((sqlMod.sql.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'subgeo' AND role = 'cashier'").get() as { n: number }).n).toBe(13)
    // Running it again changes nothing.
    expect(sync.setupSubgeoChemists(12)).toEqual([])
  })

  it('signs each cashier into its own chemist by password', async () => {
    for (const n of [1, 7, 12]) {
      const r = await login('subgeo', String(n).padStart(4, '0'))
      expect(r.status).toBe(200)
      expect(r.body.branches!.find((b) => b.id === r.body.user!.branchId)!.number).toBe(n)
    }
    expect((await login('subgeo', '0013')).status).toBe(401)
    // 0000 opens the head-office pharmacy HQ.
    const hq = await login('subgeo', '0000')
    expect(hq.status).toBe(200)
    expect(hq.body.branches!.find((b) => b.id === hq.body.user!.branchId)!.number).toBe(100)
    expect(sqlMod.sql.prepare('SELECT code, name FROM branches WHERE number = 100').get()).toEqual({ code: 'HQ', name: 'HQ' })
  })

  it('gives the purchases account the admin rights over every chemist', async () => {
    const r = await login('purchase', '')
    const token = (r.body as unknown as { token: string }).token
    const h = { Authorization: `Bearer ${token}` }
    const other = r.body.branches!.find((b) => b.number === 3)!
    // Any chemist's data, the all-chemists overview and medicine lists.
    expect((await fetch(`${base}/api/sync/pull?branch=${other.id}&since=0`, { headers: h })).status).toBe(200)
    expect((await fetch(`${base}/api/admin/overview`, { headers: h })).status).toBe(200)
    expect((await fetch(`${base}/api/admin/products?branch=${other.id}`, { headers: h })).status).toBe(200)
    // A cashier still only reaches its own chemist.
    const c = (await login('subgeo', '0001')).body as unknown as { token: string }
    expect((await fetch(`${base}/api/sync/pull?branch=${other.id}&since=0`, { headers: { Authorization: `Bearer ${c.token}` } })).status).toBe(403)
    expect((await fetch(`${base}/api/admin/overview`, { headers: { Authorization: `Bearer ${c.token}` } })).status).toBe(403)
  })

  it('still keeps admin and purchase user names unique', async () => {
    expect((await login('admin', 'subgeo22')).status).toBe(200)
    expect((await login('purchase', '')).status).toBe(200)
  })
})
