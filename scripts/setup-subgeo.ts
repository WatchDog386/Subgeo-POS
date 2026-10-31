// One-time setup of the company's chemists: npm run setup:subgeo
// SUBGEO1 … SUBGEO12, each with a cashier "subgeo" / 0001 … 0012; today's
// chemist 1 becomes SUBGEO12 with all its data. Safe to run more than once.
import { dbPath, migrate } from '../server/db'
import { ensureSeeds, setupSubgeoChemists } from '../server/sync'

migrate()
ensureSeeds()
const done = setupSubgeoChemists(12)
console.log(done.length ? done.join('\n') : 'Already set up: SUBGEO1 … SUBGEO12 and their cashiers exist.')
console.log(`\nDatabase: ${dbPath}\nTills pick the changes up on their next sync. Sign in as cashier: subgeo / 0001 (SUBGEO1) … 0012 (SUBGEO12).`)
