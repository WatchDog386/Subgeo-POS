// Pur/GRN (Direct Invoice), Stock Adjust − / +(DBH) and the minimum selling price.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { DocLine, Product } from '../db/types'

let m: { db: typeof import('../db/db'); ss: typeof import('../medapp/pages/StockScreens'); sales: typeof import('../db/sales') }
let amox: number
let calpol: number

const product = (over: Partial<Product>): Product =>
  ({ sku: 'X', barcode: 'X', name: 'X', fitment: [], cost: 0, price: 0, stock: 0, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1, ...over }) as Product
const line = (productId: number, qty: number, over: Partial<DocLine> = {}): DocLine => ({ productId, name: '', qty, cost: 0, rate: 0, vatPct: 0, vat: 0, discount: 0, total: 0, ...over })
const stock = async (id: number) => (await m.db.db.products.get(id))!.stock

beforeEach(async () => {
  vi.resetModules()
  await Dexie.delete('subgeo-pos')
  m = { db: await import('../db/db'), ss: await import('../medapp/pages/StockScreens'), sales: await import('../db/sales') }
  amox = (await m.db.db.products.add(product({ sku: 'AMX', name: 'AMOXIL 500MG', cost: 1000, price: 2000, stock: 10, minPrice: 1500, maxStock: 50 }))) as number
  calpol = (await m.db.db.products.add(product({ sku: 'CAL', name: 'CALPOL', cost: 20000, price: 35000, stock: 4 }))) as number
})

describe('Pur/GRN (Direct Invoice)', () => {
  it('receives stock, sets the cost and the retail price, and logs a movement', async () => {
    const doc = { values: { docNo: 'MRN-1-26', vendorName: 'TABACAN', invoice: '77' }, lines: [line(amox, 5, { cost: 1100, retail: 2200 })] }
    await m.ss.applyGrn(doc, 1, 1, 9)
    const p = (await m.db.db.products.get(amox))!
    expect([p.stock, p.cost, p.price, p.supplierId]).toEqual([15, 1100, 2200, 9])
    const mv = await m.db.db.movements.where('productId').equals(amox).toArray()
    expect(mv.map((x) => [x.change, x.reason, x.reference])).toEqual([[5, 'receive', 'MRN-1-26']])
  })

  it('editing undoes the old quantities first; deleting takes them back out', async () => {
    const v1 = { values: { docNo: 'MRN-1-26' }, lines: [line(amox, 5, { cost: 1000 })] }
    await m.ss.applyGrn(v1, 1)
    expect(await stock(amox)).toBe(15)
    // Edit: 5 → 3
    const v2 = { values: { docNo: 'MRN-1-26' }, lines: [line(amox, 3, { cost: 1000 })] }
    await m.ss.applyGrn(v1, -1)
    await m.ss.applyGrn(v2, 1)
    expect(await stock(amox)).toBe(13)
    await m.ss.applyGrn(v2, -1)
    expect(await stock(amox)).toBe(10)
  })
})

describe('Stock Adjust − / +(DBH)', () => {
  it('minus takes stock off under the type of adjustment; plus adds it and may set prices', async () => {
    await m.ss.applyAdjust(m.ss.ADJUST_MINUS, { values: { docNo: 'SAM-1-26' }, lines: [line(amox, 4, { reason: 'Expiry' })] }, 1)
    expect(await stock(amox)).toBe(6)
    const mv = (await m.db.db.movements.toArray()).at(-1)!
    expect([mv.change, mv.reason, mv.note]).toEqual([-4, 'damage', 'Expiry'])

    await m.ss.applyAdjust(m.ss.ADJUST_PLUS, { values: { docNo: 'SAP-1-26' }, lines: [line(calpol, 6, { reason: 'Opening Stock', cost: 21000, rate: 36000 })] }, 1)
    const c = (await m.db.db.products.get(calpol))!
    expect([c.stock, c.cost, c.price]).toEqual([10, 21000, 36000])
  })

  it('undoing reverses the direction', async () => {
    const minus = { values: { docNo: 'SAM-1-26' }, lines: [line(amox, 4, { reason: 'Damage' })] }
    await m.ss.applyAdjust(m.ss.ADJUST_MINUS, minus, 1)
    await m.ss.applyAdjust(m.ss.ADJUST_MINUS, minus, -1)
    expect(await stock(amox)).toBe(10)
    const plus = { values: { docNo: 'SAP-1-26' }, lines: [line(calpol, 2, { reason: 'Found' })] }
    await m.ss.applyAdjust(m.ss.ADJUST_PLUS, plus, 1)
    await m.ss.applyAdjust(m.ss.ADJUST_PLUS, plus, -1)
    expect(await stock(calpol)).toBe(4)
  })

  it('never lets stock go below zero, counting what the earlier version already took', async () => {
    expect(await m.ss.shortfall([line(amox, 11)], undefined, -1)).toMatch(/Only 10 of AMOXIL/)
    expect(await m.ss.shortfall([line(amox, 10)], undefined, -1)).toBeUndefined()
    // An edit from 4 → 12 needs 8 more: stock is 10, so fine.
    expect(await m.ss.shortfall([line(amox, 12)], [line(amox, 4)], -1)).toBeUndefined()
    // Cutting a Stock Adjust + from 12 to 1 removes 11 of the 10 on the shelf.
    expect(await m.ss.shortfall([line(amox, 1)], [line(amox, 12)], 1)).toMatch(/Only 10/)
    // Deleting a Stock Adjust + is the same as cutting it to nothing.
    expect(await m.ss.shortfall([], [line(calpol, 4)], 1)).toBeUndefined()
    expect(await m.ss.shortfall([], [line(calpol, 5)], 1)).toMatch(/Only 4 of CALPOL/)
  })
})

describe('minimum selling price', () => {
  const sl = (unitPrice: number, qty = 1, discount = 0) => ({ productId: amox, name: 'AMOXIL 500MG', qty, unitPrice, unitCost: 1000, discount, taxable: false })
  it('refuses a line, a line discount or a bill discount that takes it below the floor', async () => {
    await expect(m.sales.checkPriceFloor([sl(1500)], 0)).resolves.toBeUndefined()
    await expect(m.sales.checkPriceFloor([sl(1499)], 0)).rejects.toThrow(/cannot be sold below KES 15.00/)
    await expect(m.sales.checkPriceFloor([sl(2000, 2, 1002)], 0)).rejects.toThrow(/below/)
    await expect(m.sales.checkPriceFloor([sl(2000, 2, 1000)], 0)).resolves.toBeUndefined()
    await expect(m.sales.checkPriceFloor([sl(2000)], 600)).rejects.toThrow(/below/)
    // A medicine without a floor can be discounted freely.
    await expect(m.sales.checkPriceFloor([{ ...sl(100), productId: calpol }], 0)).resolves.toBeUndefined()
  })
})
