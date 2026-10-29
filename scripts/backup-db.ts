// Nightly server DB backup: tsx scripts/backup-db.ts [retention]
// Copies the SQLite database to backups/<date>-subgeo.db using the online
// backup API (safe while the server is writing), keeping the newest N copies.
//
// Installed by deploy/db-setup.sh as a daily cron job; also safe to run by hand.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath, sql } from '../server/db'

const KEEP = Math.max(1, Number(process.argv[2] ?? 14))

const here = path.dirname(fileURLToPath(import.meta.url))
const backupDir = process.env.BACKUP_DIR ?? path.join(here, '..', 'backups')

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath} — start the server once (bash deploy.sh) first.`)
  process.exit(1)
}

fs.mkdirSync(backupDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(backupDir, `${stamp}-subgeo.db`)

// better-sqlite3's .backup() streams a consistent snapshot even while the
// server writes — no locking, no pm2 restart needed.
await sql.backup(dest)
console.log(`Backed up ${dbPath} -> ${dest}`)

const files = fs
  .readdirSync(backupDir)
  .filter((f) => f.endsWith('subgeo.db'))
  .sort()
  .reverse()
for (const old of files.slice(KEEP)) {
  fs.unlinkSync(path.join(backupDir, old))
  console.log(`Removed old backup: ${old}`)
}

const megabytes = (n: number) => (n / 1024 / 1024).toFixed(1)
console.log(`Kept ${Math.min(files.length, KEEP)} of ${files.length} backups (${megabytes(fs.statSync(dest).size)} MB newest)`)
