// Subgeo POS local server.
//  - Serves the built app (dist/) so tills just open http://<shop-pc>:8787
//  - Company database: sign-in and till sync (server/sync.ts)
//  - Relays raw ESC/POS bytes to LAN receipt printers on port 9100
//
// Configure with a .env file next to package.json (see .env.example).

import express from 'express'
import net from 'node:net'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dbPath, migrate } from './db'
import { ensureSeeds, syncRouter } from './sync'

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: dbPath,
  })
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
  console.log('M-Pesa: cashiers type the confirmation code from the SMS (no phone prompt)')
  if (!existsSync(dist)) console.log('dist/ not built yet: run "npm run build" to serve the app from here, or use "npm run dev".')
})
