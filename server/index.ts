// Subgeo POS local server.
//  - Serves the built app (dist/) so tills just open http://<shop-pc>:8787
//  - M-Pesa STK Push via Safaricom Daraja (keeps the consumer secret & passkey off the browser)
//  - Relays raw ESC/POS bytes to LAN receipt printers on port 9100
//
// Configure with a .env file next to package.json (see .env.example).

import express from 'express'
import net from 'node:net'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDaraja, type StkCallbackBody } from './daraja'
import { dbPath, migrate, sql } from './db'
import { ensureSeeds, syncRouter } from './sync'
import * as pinpay from './pinpay'

try {
  process.loadEnvFile()
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787)
const app = express()
// Sync uploads can carry product photos (data URLs); nginx allows 25 MB.
app.use(express.json({ limit: '25mb' }))
// API answers are live data (stock, sync changes): never let a browser or proxy cache them.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const daraja = createDaraja(process.env)

// --- M-Pesa ---------------------------------------------------------------

type StkState = { status: 'pending' | 'success' | 'failed'; receipt?: string; message?: string; at: number }
const stk = new Map<string, StkState>()

// Forget stale requests so the map can't grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [k, v] of stk) if (v.at < cutoff) stk.delete(k)
}, 10 * 60 * 1000).unref()

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mpesa: pinpay.payConfigured() ? 'pinnovatech pay gateway' : daraja.configured ? daraja.env : 'not configured',
    db: dbPath,
  })
})

app.post('/api/mpesa/stkpush', async (req, res) => {
  const { phone, amount, reference } = req.body ?? {}
  if (!/^254[17]\d{8}$/.test(String(phone)) || !Number.isInteger(amount) || amount < 1) {
    res.status(400).json({ error: 'phone must be 2547XXXXXXXX and amount a whole number of shillings' })
    return
  }
  const ref = String(reference ?? 'POS')

  // 1) PinnovaTech pay gateway — prompts the phone, records the txn in SQLite.
  if (pinpay.payConfigured()) {
    try {
      const r = await pinpay.promptPayment(String(phone), amount, ref)
      const now = Date.now()
      sql.prepare(
        `INSERT INTO mpesa_transactions (id, gateway_id, reference, phone, amount, status, request_json, response_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).run(
        r.transactionId,
        r.transactionId,
        ref,
        String(phone),
        amount,
        JSON.stringify({ phone, amount, reference: ref }),
        JSON.stringify(r.raw),
        now,
        now,
      )
      res.json({
        checkoutRequestId: r.transactionId,
        customerMessage: r.customerMessage ?? 'Prompt sent. Ask the customer to enter their M-Pesa PIN…',
      })
      return
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
  }

  // 2) Fallback: direct Safaricom Daraja (MPESA_* credentials in .env).
  if (!daraja.configured) {
    res.status(503).json({ error: 'M-Pesa is not configured on the server (.env). Use manual code entry.' })
    return
  }
  try {
    const r = await daraja.stkPush(String(phone), amount, ref)
    stk.set(r.CheckoutRequestID, { status: 'pending', at: Date.now() })
    res.json({ checkoutRequestId: r.CheckoutRequestID, customerMessage: r.CustomerMessage })
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// Safaricom calls this (it must be reachable over public HTTPS, e.g. via a tunnel or your VPS).
app.post('/api/mpesa/callback', (req, res) => {
  const cb = (req.body as StkCallbackBody)?.Body?.stkCallback
  if (cb?.CheckoutRequestID) {
    const receipt = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value
    stk.set(cb.CheckoutRequestID, {
      status: cb.ResultCode === 0 ? 'success' : 'failed',
      receipt: receipt ? String(receipt) : undefined,
      message: cb.ResultDesc,
      at: Date.now(),
    })
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
})

type TxnRow = {
  id: string
  gateway_id: string | null
  reference: string | null
  phone: string
  amount: number
  status: 'pending' | 'success' | 'failed'
  receipt: string | null
  message: string | null
  created_at: number
}

app.get('/api/mpesa/status/:id', async (req, res) => {
  const id = req.params.id

  // --- PinnovaTech gateway txns (SQLite) ----------------------------------
  const row = sql.prepare('SELECT * FROM mpesa_transactions WHERE id = ? OR gateway_id = ?').get(id, id) as TxnRow | undefined
  if (row) {
    if (row.status !== 'pending') {
      res.json({ status: row.status, receipt: row.receipt ?? undefined, message: row.message ?? undefined })
      return
    }
    // Let the prompt settle before asking the gateway (till polls every 3s).
    if (Date.now() - row.created_at > 2_500) {
      try {
        const q = await pinpay.queryPayment({
          id: row.id,
          gatewayId: row.gateway_id,
          reference: row.reference,
          phone: row.phone,
          amount: row.amount,
        })
        const now = Date.now()
        if (q.status !== 'pending') {
          sql.prepare(
            'UPDATE mpesa_transactions SET status = ?, receipt = ?, message = ?, response_json = ?, updated_at = ? WHERE id = ?',
          ).run(q.status, q.receipt ?? null, q.message ?? null, JSON.stringify(q.raw), now, row.id)
          res.json({ status: q.status, receipt: q.receipt ?? undefined, message: q.message ?? undefined })
          return
        }
        sql.prepare('UPDATE mpesa_transactions SET response_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(q.raw), now, row.id)
      } catch {
        // Gateway unreachable — keep the pending state, the till keeps polling.
      }
    }
    res.json({ status: 'pending' })
    return
  }

  // --- Safaricom Daraja txns (in-memory) ----------------------------------
  const known = stk.get(id)
  if (known && known.status !== 'pending') {
    res.json(known)
    return
  }
  // No callback yet (e.g. callback URL unreachable on a LAN): ask Daraja directly.
  if (daraja.configured && known && Date.now() - known.at > 10_000) {
    try {
      const q = await daraja.stkQuery(id)
      // ResultCode is only present once the transaction has completed or failed.
      if (q.ResultCode !== undefined && q.ResultCode !== '') {
        const ok = String(q.ResultCode) === '0'
        // The query API does not return the receipt number; the cashier can add it later.
        const state: StkState = { status: ok ? 'success' : 'failed', message: q.ResultDesc, receipt: ok ? 'STK-CONFIRMED' : undefined, at: known.at }
        stk.set(id, state)
        res.json(state)
        return
      }
    } catch {
      // Still processing — Daraja returns an error until the customer responds.
    }
  }
  res.json(known ?? { status: 'pending' })
})

// --- Company database: sign-in, till sync, admin views (server/sync.ts) ----
app.use('/api', syncRouter)

// --- Network printer relay -----------------------------------------------

const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/

app.post('/api/print', (req, res) => {
  const { host, port = 9100, data } = req.body ?? {}
  // Only relay to printers on the shop's own network.
  if (typeof host !== 'string' || !net.isIPv4(host) || !PRIVATE_IP.test(host)) {
    res.status(400).send('host must be a private IPv4 address')
    return
  }
  if (typeof data !== 'string') {
    res.status(400).send('data (base64) is required')
    return
  }
  const socket = net.createConnection({ host, port: Number(port) })
  socket.setTimeout(5000)
  socket.on('connect', () => socket.end(Buffer.from(data, 'base64')))
  socket.on('close', (hadError) => {
    if (!hadError && !res.headersSent) res.json({ ok: true })
  })
  socket.on('timeout', () => {
    socket.destroy()
    if (!res.headersSent) res.status(504).send(`Printer ${host}:${port} did not respond`)
  })
  socket.on('error', (e) => {
    if (!res.headersSent) res.status(502).send(`Printer error: ${e.message}`)
  })
})

// --- Static app ----------------------------------------------------------

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const migrated = migrate()
if (migrated.length) console.log(`DB migrations applied: ${migrated.join(', ')}`)
ensureSeeds()

app.listen(PORT, () => {
  console.log(`Subgeo POS server on http://localhost:${PORT}`)
  console.log(`Database: ${dbPath}`)
  console.log(
    `M-Pesa: ${
      pinpay.payConfigured()
        ? `pay gateway (${pinpay.payEndpoint()})`
        : daraja.configured
          ? `${daraja.env} (${process.env.MPESA_SHORTCODE})`
          : 'not configured — manual code entry only'
    }`,
  )
  if (!existsSync(dist)) console.log('dist/ not built yet: run "npm run build" to serve the app from here, or use "npm run dev".')
})
