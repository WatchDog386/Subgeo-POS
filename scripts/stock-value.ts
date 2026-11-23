// Check a chemist's stock value (stock × selling price) and list the medicines
// whose prices make it look wrong:
//   npm run stock:value -- 13            (chemist number; HQ = 100)
// Read-only: changes nothing. Fix prices in Modules → Medicine Prices.
import { migrate, sql } from '../server/db'
import { chemistByNumber } from '../server/sync'
import { stockValueCheck } from '../src/lib/stockCheck'

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)))
if (!n) {
  console.error('Which chemist? e.g.  npm run stock:value -- 13')
  process.exit(1)
}
migrate()
const chem = chemistByNumber(n)
if (!chem) {
  console.error(`No chemist number ${n}.`)
  process.exit(1)
}
const kes = (c: number) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const products = (sql.prepare("SELECT data FROM sync_records WHERE tbl = 'products' AND scope = ? AND deleted = 0").all(chem.id) as { data: string }[])
  .map((r) => JSON.parse(r.data) as Record<string, unknown>)
  .filter((p) => p.trackStock !== false && p.active !== false && !/^SRV-/i.test(String(p.sku)))
  .map((p) => ({ name: String(p.name ?? ''), sku: String(p.sku ?? ''), stock: Number(p.stock) || 0, cost: Number(p.cost) || 0, price: Number(p.price) || 0 }))
const r = stockValueCheck(products)
const row = (x: (typeof r.rows)[number]) =>
  `  ${x.name.slice(0, 40).padEnd(40)} ${String(x.stock).padStart(7)} × ${kes(x.price).padStart(9)} = ${kes(x.atPrice).padStart(12)}   cost ${kes(x.cost).padStart(8)}${x.problems.length ? `   ⚠ ${x.problems.join(', ')}` : ''}${x.hint ? `\n${' '.repeat(44)}↳ ${x.hint}` : ''}`

console.log(`\n══ ${chem.code} — ${chem.name}`)
console.log(`   ${r.rows.length} medicines in stock`)
console.log(`   Stock value at SELLING price: KES ${kes(r.totalAtPrice)}`)
console.log(`   Stock value at cost:          KES ${kes(r.totalAtCost)}   (selling ÷ cost = ${r.totalAtCost ? (r.totalAtPrice / r.totalAtCost).toFixed(2) : '-'}; usually 1.2 – 1.6)`)
if (r.suspicious.length) {
  console.log(`\n   ⚠ ${r.suspicious.length} medicine(s) with a selling price over 3× its cost or below cost make KES ${kes(r.suspiciousAtPrice)} of the total:`)
  for (const x of r.suspicious.slice(0, 60)) console.log(row(x))
}
if (r.packPriced.length) {
  const share = r.packPriced.reduce((s, x) => s + x.atPrice, 0)
  console.log(`\n   ⚠ ${r.packPriced.length} medicine(s) are priced like a WHOLE PACK (name says 10 or more per pack, price 100.00 or more).`)
  console.log(`     They make KES ${kes(share)} of the total. That is right only if their stock is counted in PACKS.`)
  console.log(`     If their stock is counted in PIECES, the true stock value is about KES ${kes(r.totalIfPieces)}.`)
  for (const x of r.packPriced.slice(0, 60)) console.log(row(x))
}
if (r.noPrice.length) {
  console.log(`\n   ${r.noPrice.length} medicine(s) in stock with NO selling price (counted as 0):`)
  for (const x of r.noPrice.slice(0, 40)) console.log(`  ${x.name.slice(0, 40).padEnd(40)} ${String(x.stock).padStart(7)} in stock`)
}
console.log(`\n   The 20 largest values:`)
for (const x of r.rows.slice(0, 20)) console.log(row(x))
console.log('\nFix a price in Modules → Medicine Prices (pick this chemist at the top). Nothing was changed.')
