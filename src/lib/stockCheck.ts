// Why a medicine's stock value looks wrong: prices that do not fit the stock.
// Stock is counted in pieces / units; its value is stock × selling price. A pack
// price on piece stock (845.00 for one tablet of a 100-pack) multiplies the
// value many times over.
import { packContents } from './medMatch'

export type PriceProblem = 'no selling price' | 'below cost' | 'over 3× cost' | 'no cost'
export type StockLine = { name: string; sku: string; stock: number; cost: number; price: number }

/** What is suspicious about one medicine's prices (empty when they look fine). */
export function priceProblems(p: StockLine): PriceProblem[] {
  const out: PriceProblem[] = []
  if (!(p.price > 0)) out.push('no selling price')
  if (!(p.cost > 0)) out.push('no cost')
  if (p.cost > 0 && p.price > 0 && p.price < p.cost) out.push('below cost')
  if (p.cost > 0 && p.price > 3 * p.cost) out.push('over 3× cost')
  return out
}

/**
 * The selling price looks like the price of a whole pack: the name says a pack
 * of 10 or more (100S, 30 TABS, 10X10) and the price is 100.00 or more. Fine
 * when the stock is counted in packs; when it is counted in pieces, each piece
 * is valued at a pack's price. Cost and price both per pack still look normal
 * next to each other, so this does not depend on the cost.
 */
export function packPrice(p: StockLine): { pieces: number; perPiece: number } | undefined {
  const pieces = packContents(p.name).pieces
  if (!pieces || pieces < 10 || !(p.price >= 100_00)) return undefined
  return { pieces, perPiece: Math.round(p.price / pieces) }
}
export function packHint(p: StockLine): string | undefined {
  const pk = packPrice(p)
  return pk ? `name says ${pk.pieces} per pack: if the ${p.stock} in stock are pieces, the price per piece is about ${(pk.perPiece / 100).toFixed(2)}` : undefined
}

export function stockValueCheck(products: StockLine[]) {
  const held = products.filter((p) => p.stock > 0)
  const rows = held
    .map((p) => ({ ...p, atPrice: p.stock * Math.max(0, p.price), atCost: p.stock * Math.max(0, p.cost), problems: priceProblems(p), hint: packHint(p) }))
    .sort((a, b) => b.atPrice - a.atPrice)
  const sum = (k: 'atPrice' | 'atCost', list = rows) => list.reduce((s, r) => s + r[k], 0)
  const suspicious = rows.filter((r) => r.problems.some((x) => x === 'over 3× cost' || x === 'below cost'))
  return {
    rows,
    suspicious,
    totalAtPrice: sum('atPrice'),
    totalAtCost: sum('atCost'),
    /** The total if the suspicious medicines were valued at cost, i.e. how much of the figure they make. */
    suspiciousAtPrice: sum('atPrice', suspicious),
    noPrice: rows.filter((r) => r.problems.includes('no selling price')),
    /** Priced like a whole pack (see packPrice), largest value first. */
    packPriced: rows.filter((r) => packPrice(r)),
    /** The total if every pack-priced medicine's stock were pieces (each at its per-piece price). */
    totalIfPieces: rows.reduce((s, r) => { const pk = packPrice(r); return s + (pk ? r.stock * pk.perPiece : r.atPrice) }, 0),
  }
}
