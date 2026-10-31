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
  it('creates the twelve chemists and their cashiers, keeping chemist 1 as SUBGEO12', () => {
    const out = sync.setupSubgeoChemists(12)
    expect(out[0]).toMatch(/is now SUBGEO12/)
    const codes = (sqlMod.sql.prepare('SELECT code FROM branches ORDER BY number').all() as { code: string }[]).map((r) => r.code)
    expect(codes).toEqual(Array.from({ length: 12 }, (_, i) => `SUBGEO${i + 1}`))
    expect((sqlMod.sql.prepare("SELECT number FROM branches WHERE id = 1").get() as { number: number }).number).toBe(12)
    expect((sqlMod.sql.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'subgeo' AND role = 'cashier'").get() as { n: number }).n).toBe(12)
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
    // A fresh server's starter cashier used 0001; this server's old 0000 is gone.
    expect((await login('subgeo', '0000')).status).toBe(401)
  })

  it('still keeps admin and purchase user names unique', async () => {
    expect((await login('admin', 'subgeo22')).status).toBe(200)
    expect((await login('purchase', '')).status).toBe(200)
  })
})
