// One chemist's stock was keyed in as UNITS (pieces), but some of its prices are
// the price of a whole pack. Work out, per medicine, the price of one selling
// unit — a piece, or a pair where it is sold in pairs; a syrup / cream bottle is
// sold whole — using how the medicine is already recorded in the system (HQ
// first, then any chemist, then its name). Nothing here writes: see the
// stock:unit-prices script.
import { medKey, packContents } from './medMatch'

export type FixProduct = { id: string | number; name: string; sku: string; stock: number; cost: number; price: number; minPrice?: number }
/** How a medicine comes and is sold, from a Medicine form record (packSize / sellBy). */
export type PackInfo = { packSize: number; sellBy: number; from: string }
export type UnitFix = {
  p: FixProduct
  /** Units (pieces ÷ sell-by) in one pack. */
  perPack: number
  sellBy: number
  how: string
  /** Why the prices are (or are not) changed. */
  why: string
  change: boolean
  price: number
  minPrice?: number
  cost: number
  /** Stock after the pieces of the last upload are counted as pairs (sold in pairs only). */
  stock: number
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const WHOLE_FORMS = new Set(['SYR', 'SUSP', 'DROP', 'INJ', 'CREAM', 'OINT', 'GEL', 'LOTION', 'BALM', 'INHALER', 'SPRAY', 'POWDER'])

/** Sold as it comes (a bottle, a tube, an inhaler): its price is already for one. */
export function soldWhole(name: string, info?: PackInfo): boolean {
  if (info && info.packSize > 1) return false
  const k = medKey(name)
  if (k.form && WHOLE_FORMS.has(k.form)) return true
  return !packContents(name).pieces
}

/** Which of two prices is nearer another (by ratio, so 8 vs 800 is far). */
const nearer = (a: number, b: number, to: number) => Math.abs(Math.log(a / to)) <= Math.abs(Math.log(b / to))

export function planUnitPrices(input: {
  products: FixProduct[]
  /** The same medicine at HQ (by name, else by code). */
  hq: (p: FixProduct) => FixProduct | undefined
  /** How the medicine comes and is sold: HQ's record first, then any chemist's. */
  packInfo: (p: FixProduct) => PackInfo | undefined
  /** Quantity each medicine got from the last upload (keyed in pieces). */
  lastUpload: Map<string, number>
}): UnitFix[] {
  const out: UnitFix[] = []
  for (const p of input.products) {
    if (!(p.stock > 0)) continue
    const info = input.packInfo(p)
    const keep = (why: string, how = 'as it is'): UnitFix => ({ p, perPack: 1, sellBy: 1, how, why, change: false, price: p.price, minPrice: p.minPrice, cost: p.cost, stock: p.stock })
    if (soldWhole(p.name, info)) {
      out.push(keep('sold whole (bottle / tube / one item): its price is already for one', 'whole'))
      continue
    }
    const pieces = info && info.packSize > 1 ? info.packSize : packContents(p.name).pieces ?? 1
    const sellBy = info && info.sellBy >= 1 && pieces % info.sellBy === 0 ? info.sellBy : 1
    const perPack = pieces / sellBy
    const how = `${pieces} per pack, sold ${sellBy === 1 ? 'each' : sellBy === 2 ? 'in pairs' : `${sellBy} at a time`}${info ? ` (${info.from})` : ' (from the name)'}`
    if (perPack <= 1) {
      out.push(keep('one unit per pack', how))
      continue
    }
    // The last upload was keyed in pieces: a medicine sold in pairs holds half as many units.
    const fromUpload = input.lastUpload.get(String(p.id)) ?? 0
    const stock = sellBy > 1 && fromUpload > 0 ? p.stock - fromUpload + Math.floor(fromUpload / sellBy) : p.stock
    // Is today's price for a pack or already for one unit? Compare with HQ; without HQ, a price
    // of 100.00 or more for a pack of 10+ is taken as a pack price.
    const ref = input.hq(p)
    const perUnit = p.price / perPack
    const isPack = !(p.price > 0)
      ? false
      : ref && ref.price > 0
        ? !nearer(p.price, perUnit, ref.price)
        : pieces >= 10 && p.price >= 100_00
    const costIsPack = !(p.cost > 0) ? false : ref && ref.cost > 0 ? !nearer(p.cost, p.cost / perPack, ref.cost) : isPack
    if (!isPack && !costIsPack && stock === p.stock) {
      out.push(keep(ref ? `already per ${sellBy === 1 ? 'piece' : 'unit'} (HQ sells it at ${(ref.price / 100).toFixed(2)})` : 'already per unit', how))
      continue
    }
    const div = (v: number | undefined, yes: boolean) => (v && yes ? Math.round(v / perPack) : v)
    out.push({
      p,
      perPack,
      sellBy,
      how,
      why: [isPack ? `price ${(p.price / 100).toFixed(2)} is for a pack of ${perPack} ${sellBy === 1 ? 'pieces' : 'units'}${ref ? ` (HQ: ${(ref.price / 100).toFixed(2)})` : ''}` : '', costIsPack ? 'cost is for a pack' : '', stock !== p.stock ? `${fromUpload} pieces from the last upload = ${Math.floor(fromUpload / sellBy)} pairs` : ''].filter(Boolean).join('; '),
      change: true,
      price: div(p.price, isPack)!,
      minPrice: div(p.minPrice, isPack),
      cost: div(p.cost, costIsPack)!,
      stock,
    })
  }
  return out
}

export { norm as normName }
