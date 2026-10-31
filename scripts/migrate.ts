// Apply pending server DB migrations and refresh the relational tables: npm run db:migrate
import { dbPath, migrate } from '../server/db'
import { ensureSeeds } from '../server/sync'

const ran = migrate()
// Seeds, legacy document lists → documents, and the relational tables.
ensureSeeds()
console.log(ran.length ? `Applied ${ran.length} migration(s): ${ran.join(', ')}` : 'Database is up to date')
console.log(`SQLite file: ${dbPath}`)
