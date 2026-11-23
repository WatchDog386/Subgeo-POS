// Stock value = stock × selling price, and the prices that make it look wrong.
import { describe, expect, it } from 'vitest'
import { packPrice, priceProblems, stockValueCheck } from '../lib/stockCheck'

const m = (name: string, stock: number, cost: number, price: number) => ({ name, sku: name, stock, cost: cost * 100, price: price * 100 })

describe('stock value check', () => {
  it('values stock at the selling price and finds pack prices on piece stock', () => {
    const r = stockValueCheck([
      m('PARACETAMOL 500MG TABLETS', 408, 1, 2), // priced per tablet
      m('ACETAL MR TABLETS 100S', 99, 635, 845), // pack price, 99 tablets
      m('CALPOL SUSPENSION (60ML)', 5, 250, 332),
      m('OUT OF STOCK (100S)', 0, 500, 700),
    ])
    expect(r.totalAtPrice).toBe((408 * 2 + 99 * 845 + 5 * 332) * 100)
    expect(r.packPriced.map((x) => x.name)).toEqual(['ACETAL MR TABLETS 100S'])
    // As pieces, Acetal is worth 99 × 8.45.
    expect(r.totalIfPieces).toBe((408 * 2 + 5 * 332) * 100 + 99 * 845)
    expect(packPrice(m('ACETAL MR TABLETS 100S', 99, 635, 845))).toEqual({ pieces: 100, perPiece: 845 })
    // A per-piece price, or a pack of under 10, is not flagged.
    expect(packPrice(m('COFTA TABLETS (100S)', 50, 3, 5))).toBeUndefined()
    expect(packPrice(m('MALODAR TABLETS (3S)', 10, 150, 200))).toBeUndefined()
  })
  it('flags no price, below cost and over 3× cost', () => {
    expect(priceProblems(m('A', 1, 10, 0))).toContain('no selling price')
    expect(priceProblems(m('A', 1, 10, 8))).toEqual(['below cost'])
    expect(priceProblems(m('A', 1, 10, 40))).toEqual(['over 3× cost'])
    expect(priceProblems(m('A', 1, 10, 14))).toEqual([])
  })
})
