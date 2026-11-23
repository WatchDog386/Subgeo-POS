// Chemist stock keyed in pieces, prices for a whole pack: price per selling unit.
import { describe, expect, it } from 'vitest'
import { planUnitPrices, soldWhole, type FixProduct, type PackInfo } from '../lib/unitPrices'

const p = (id: number, name: string, stock: number, price: number, cost: number, minPrice?: number): FixProduct => ({ id, name, sku: `S${id}`, stock, price: price * 100, cost: cost * 100, minPrice: minPrice ? minPrice * 100 : undefined })

describe('unit prices for stock keyed in pieces', () => {
  const acetal = p(1, 'ACETAL MR TABLETS 100S', 99, 845, 635, 800)
  const calpol = p(2, 'CALPOL SUSPENSION (60ML)', 5, 332, 250)
  const eno = p(3, 'ENO TABS (PACK OF 100S)', 50, 1000, 700) // sold in pairs (HQ); 40 of the 50 came from the last upload
  const cofta = p(4, 'COFTA TABLETS (100S)', 50, 5, 3) // already per tablet
  const zulu = p(5, 'ZULU MR TABLETS (20S)', 46, 904, 679)
  const hqInfo: Record<string, PackInfo> = { S3: { packSize: 100, sellBy: 2, from: 'HQ' }, S5: { packSize: 20, sellBy: 1, from: 'HQ' } }
  const hqRef: Record<string, FixProduct> = { S5: p(50, 'ZULU MR TABLETS (20S)', 10, 46, 34) }
  const plan = planUnitPrices({
    products: [acetal, calpol, eno, cofta, zulu],
    hq: (x) => hqRef[x.sku],
    packInfo: (x) => hqInfo[x.sku],
    lastUpload: new Map([['3', 40]]),
  })
  const of = (id: number) => plan.find((f) => f.p.id === id)!

  it('divides a pack price by the pieces in a pack, keeping the stock', () => {
    expect(of(1)).toMatchObject({ change: true, price: 845, minPrice: 800, cost: 635, stock: 99 })
  })
  it('leaves syrups (sold whole) and prices already per piece alone', () => {
    expect(of(2).change).toBe(false)
    expect(soldWhole('CALPOL SUSPENSION (60ML)')).toBe(true)
    expect(of(4).change).toBe(false)
  })
  it('sold in pairs (from HQ): price per pair, and the last upload\'s pieces counted as pairs', () => {
    // 100 per pack sold in pairs = 50 pairs a pack: 1000.00 → 20.00 a pair. 40 pieces of the 50 came in the last upload = 20 pairs.
    expect(of(3)).toMatchObject({ change: true, sellBy: 2, perPack: 50, price: 2000, cost: 1400, stock: 10 + 20 })
  })
  it('a price copied from a chemist that sells by the pack is a pack price, whatever its size', () => {
    const cet = p(7, 'CETRIZINE 10MG TABLETS (100S)', 441, 44, 33)
    const keyed = p(8, 'CETRIZINE 10MG TABLETS (100S) B', 100, 2, 1) // keyed in by hand, per tablet
    const out = planUnitPrices({ products: [cet, keyed], hq: () => undefined, packInfo: () => undefined, lastUpload: new Map(), packPricesElsewhere: () => [4400] })
    expect(out.find((f) => f.p.id === 7)).toMatchObject({ change: true, price: 44, cost: 33, stock: 441 })
    expect(out.find((f) => f.p.id === 8)!.change).toBe(false)
  })
  it('uses HQ\'s price to tell a pack price from a piece price', () => {
    // HQ sells Zulu MR at 46.00 a tablet: 904.00 is the pack of 20 → 45.20.
    expect(of(5)).toMatchObject({ change: true, price: 4520, cost: 3395 })
  })
})
