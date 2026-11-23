// A chemist's stock was keyed in as pieces but some prices are for a whole pack.
// Show (and, with --apply, make) each medicine's price per selling unit:
//   npm run stock:unit-prices -- 13              (look only — changes nothing)
//   npm run stock:unit-prices -- 13 --apply      (backs the database up first)
// How a medicine is sold (each / in pairs / whole bottle) comes from HQ's records,
// else any chemist's, else its name. The last stock upload (or --doc=MRN-5-26)
// was keyed in pieces: medicines sold in pairs get those pieces counted as pairs.
import fs from 'node:fs'
import path from 'node:path'
import { dbPath, migrate, sql } from '../server/db'
import { STOCK_IN_SLUGS, applyUnitPriceFix, chemistByNumber } from '../server/sync'
import { planUnitPrices, type FixProduct, type PackInfo } from '../src/lib/unitPrices'

const args = process.argv.slice(2)
const n = Number(args.find((a) => /^\d+$/.test(a)))
const apply = args.includes('--apply')
const docArg = args.find((a) => a.startsWith('--doc='))?.slice(6).trim().toUpperCase()
if (!n) {
  console.error('Which chemist? e.g.  npm run stock:unit-prices -- 13')
  process.exit(1)
}
migrate()
const chem = chemistByNumber(n)
if (!chem) {
  console.error(`No chemist number ${n}.`)
  process.exit(1)
}
const hqChem = chemistByNumber(100)
type Rec = Record<string, unknown>
const live = (tbl: string, scope: number): Rec[] =>
  (sql.prepare('SELECT data FROM sync_records WHERE tbl = ? AND scope = ? AND deleted = 0').all(tbl, scope) as { data: string }[]).map((r) => JSON.parse(r.data) as Rec)
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const kes = (c: number) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const asProduct = (p: Rec): FixProduct => ({ id: p.id as number, name: String(p.name ?? ''), sku: String(p.sku ?? ''), stock: Number(p.stock) || 0, cost: Number(p.cost) || 0, price: Number(p.price) || 0, minPrice: Number(p.minPrice) || undefined })

const products = live('products', chem.id).filter((p) => p.trackStock !== false && p.active !== false && !/^SRV-/i.test(String(p.sku))).map(asProduct)
const hqProducts = hqChem ? live('products', hqChem.id).map(asProduct) : []
// Every chemist's Medicine form records: how each medicine comes (packSize) and is sold (sellBy).
const chemists = (sql.prepare("SELECT id, data FROM sync_records WHERE tbl = 'branches' AND scope = 0 AND deleted = 0").all() as { id: string; data: string }[]).map((r) => ({ id: Number(r.id), number: Number((JSON.parse(r.data) as Rec).number) }))
const medDocs = (scope: number) => live('docs', scope).filter((d) => d.slug === 'medicine').map((d) => (d.values ?? {}) as Record<string, string>)
const order = [...(hqChem ? [hqChem.id] : []), chem.id, ...chemists.map((c) => c.id).filter((id) => id !== chem.id && id !== hqChem?.id)]
const records = order.map((id) => ({ id, code: chemists.find((c) => c.id === id)?.number === 100 ? 'HQ' : `chemist ${chemists.find((c) => c.id === id)?.number}`, docs: medDocs(id) }))
const infoIn = (docs: Record<string, string>[], p: FixProduct) =>
  docs.find((v) => Number(v.packSize) > 1 && (norm(v.name) === norm(p.name) || String(v.docNo ?? '').trim().toUpperCase() === p.sku.trim().toUpperCase()))
const packInfo = (p: FixProduct): PackInfo | undefined => {
  for (const r of records) {
    const v = infoIn(r.docs, p)
    if (v) return { packSize: Math.round(Number(v.packSize)), sellBy: Math.max(1, Math.round(Number(v.sellBy) || 1)), from: r.code }
  }
  return undefined
}
// HQ's price is a per-unit reference only where HQ recorded how the medicine is packed and sold.
const hqDocs = records.find((r) => r.id === hqChem?.id)?.docs ?? []
const hq = (p: FixProduct) => {
  const ref = hqProducts.find((x) => norm(x.name) === norm(p.name)) ?? hqProducts.find((x) => x.sku.trim().toUpperCase() === p.sku.trim().toUpperCase())
  return ref && infoIn(hqDocs, ref) ? ref : undefined
}

// The last stock upload, keyed in pieces.
const stockIn = live('docs', chem.id)
  .filter((d) => STOCK_IN_SLUGS.includes(String(d.slug)) && Array.isArray(d.lines))
  .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
const doc = docArg ? stockIn.find((d) => String(((d.values ?? {}) as Rec).docNo ?? d.docNo ?? '').toUpperCase() === docArg) : stockIn.find((d) => (d.lines as unknown[]).length === 62) ?? stockIn[0]
const docNo = doc ? String(((doc.values ?? {}) as Rec).docNo ?? doc.docNo ?? '') : ''
const lastUpload = new Map<string, number>()
for (const l of (doc?.lines ?? []) as { productId?: number; qty: number }[]) if (l.productId !== undefined) lastUpload.set(String(l.productId), (lastUpload.get(String(l.productId)) ?? 0) + Number(l.qty || 0))

// Other chemists' prices for each medicine where they sell it by the pack (no pack size on record).
const elsewhere = new Map<string, number[]>()
for (const c of chemists) {
  if (c.id === chem.id) continue
  const docs = records.find((r) => r.id === c.id)?.docs ?? []
  for (const x of live('products', c.id).map(asProduct)) {
    if (!(x.price > 0) || infoIn(docs, x)) continue
    const k = norm(x.name)
    elsewhere.set(k, [...(elsewhere.get(k) ?? []), x.price])
  }
}
const plan = planUnitPrices({ products, hq, packInfo, lastUpload, packPricesElsewhere: (p) => elsewhere.get(norm(p.name)) ?? [] })
const changes = plan.filter((f) => f.change)
const before = plan.reduce((s, f) => s + f.p.stock * f.p.price, 0)
const after = plan.reduce((s, f) => s + f.stock * f.price, 0)

console.log(`Database: ${dbPath}`)
console.log(`\n══ ${chem.code} — ${chem.name}${hqChem ? '' : '   (no HQ chemist found: using other chemists and names)'}`)
console.log(`   Last upload (keyed in pieces): ${doc ? `${docNo} — ${(doc.lines as unknown[]).length} lines` : 'none found'}`)
console.log(`   ${plan.length} medicines in stock · ${changes.length} to change`)
console.log(`   Stock value at selling price: KES ${kes(before)}  →  KES ${kes(after)}`)
for (const f of changes) {
  console.log(
    `\n  ${f.p.name.slice(0, 44).padEnd(44)} ${f.how}\n     ${f.why}\n     price ${kes(f.p.price)} → ${kes(f.price)}${f.p.minPrice ? ` · best ${kes(f.p.minPrice)} → ${kes(f.minPrice ?? 0)}` : ''} · cost ${kes(f.p.cost)} → ${kes(f.cost)}${f.stock !== f.p.stock ? ` · stock ${f.p.stock} → ${f.stock}` : ` · stock ${f.stock}`}`,
  )
}
const kept = plan.filter((f) => !f.change)
console.log(`\n   Unchanged (${kept.length}): ${kept.slice(0, 40).map((f) => `${f.p.name} [${f.why.split(' (')[0]}]`).join(' · ')}${kept.length > 40 ? ' …' : ''}`)

if (!apply) {
  console.log('\nNothing was changed. Check the list; to make these changes run again with --apply')
  process.exit(0)
}
const backup = path.join(path.dirname(dbPath), `backup-before-unit-prices-${chem.code}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`)
await sql.backup(backup)
console.log(`\nBacked up to ${backup} (${(fs.statSync(backup).size / 1e6).toFixed(1)} MB)`)
const done = applyUnitPriceFix(chem.id, changes, `UNIT-PRICES ${docNo}`.trim())
console.log(`✓ ${done} medicine(s) of ${chem.code} now priced per selling unit. Every till of ${chem.code} gets it on its next sync.`)
