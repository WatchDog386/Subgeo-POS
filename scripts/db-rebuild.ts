// Rebuild the relational tables (branches, users, products, sales, sale_lines,
// documents, …) from the synced records: npm run db:rebuild
// Safe to run any time; the tills are not affected.
import { dbPath, migrate } from '../server/db'
import { projectionFailures, rebuildRelational } from '../server/relational'

migrate()
const t = Date.now()
const n = rebuildRelational()
console.log(`Rebuilt relational tables from ${n} record(s) in ${Date.now() - t} ms${projectionFailures() ? ` — ${projectionFailures()} skipped (see warnings above)` : ''}`)
console.log(`SQLite file: ${dbPath}`)
