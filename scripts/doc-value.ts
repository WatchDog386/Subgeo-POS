// A stock document uploaded with NO prices (names and quantities only) shows a value made of
// costs filled in from elsewhere. Re-value it at the medicines' selling prices instead:
//   npm run doc:value -- 13 MRN-2-26            (chemist number, document number)
// Medicines and stock are not touched; the document's lines carry no cost.
import { migrate } from '../server/db'
import { chemistByNumber, revalueAtSellingPrice } from '../server/sync'

const [num, docNo] = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (!Number(num) || !docNo) {
  console.error('e.g.  npm run doc:value -- 13 MRN-2-26')
  process.exit(1)
}
migrate()
const chem = chemistByNumber(Number(num))
if (!chem) {
  console.error(`No chemist number ${num}.`)
  process.exit(1)
}
const r = revalueAtSellingPrice(chem.id, docNo)
if (!r) {
  console.error(`${docNo} is not a stock document of ${chem.code}.`)
  process.exit(1)
}
const kes = (c: number) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
console.log(`${chem.code} ${r.docNo}: ${r.lines} lines. Value ${kes(r.before)} → ${kes(r.after)} (quantity × selling price; no costs on the document).`)
