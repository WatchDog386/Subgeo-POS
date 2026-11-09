// The company's default price for a medicine, from its copies at every chemist.
// Each chemist keeps its own prices: editing one never changes another. The
// default (offered to a chemist that has not priced the medicine yet) is the
// price MOST chemists use, so one chemist's own change does not move it;
// a tie goes to the most recently updated.

export type PricedCopy = { price: number; minPrice?: number | null; cost: number; updatedAt: number; chem: string }
export type CompanyPrice = { price: number; minPrice: number | null; cost: number; chem: string }

/** The value most copies have (ignoring blanks / 0); a tie goes to the latest. */
function usual<T extends PricedCopy>(copies: T[], get: (c: T) => number | null | undefined): T | undefined {
  const groups = new Map<number, T[]>()
  for (const c of copies) {
    const v = get(c)
    if (!v || v <= 0) continue
    groups.set(v, [...(groups.get(v) ?? []), c])
  }
  let best: T[] | undefined
  const latest = (g: T[]) => Math.max(...g.map((c) => c.updatedAt))
  for (const g of groups.values()) if (!best || g.length > best.length || (g.length === best.length && latest(g) > latest(best))) best = g
  return best?.sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function companyPrice(copies: PricedCopy[]): CompanyPrice | undefined {
  if (!copies.length) return undefined
  const byPrice = usual(copies, (c) => c.price)
  const price = byPrice?.price ?? 0
  // Best Price: the usual one among chemists selling at that price, else the usual one at or below it.
  const samePrice = copies.filter((c) => c.price === price)
  const best = usual(samePrice, (c) => c.minPrice) ?? usual(copies.filter((c) => !price || (c.minPrice ?? 0) <= price), (c) => c.minPrice)
  const cost = usual(copies, (c) => c.cost)
  return { price, minPrice: best?.minPrice ?? null, cost: cost?.cost ?? 0, chem: (byPrice ?? copies.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]).chem }
}
