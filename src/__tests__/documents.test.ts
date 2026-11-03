// Stock and account effects of the cashier's whole-sale documents
// (EntryScreens.tsx): delivery notes take stock out, invoices post to the
// customer (and only take stock not already delivered), credit notes bring
// stock back and credit the customer; editing undoes the old version first.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { DocLine } from '../db/types'

type Mods = { db: typeof import('../db/db'); entry: typeof import('../medapp/pages/EntryScreens') }
let m: Mods
let productId = 0
let customerId = 0

const line = (qty: number, extra: Partial<DocLine> = {}): DocLine => ({ productId, name: 'PCM', qty, cost: 500, rate: 1000, vatPct: 16, vat: 0, discount: 0, total: qty * 1000, ...extra })
const stock = async () => (await m.db.db.products.get(productId))!.stock
const balance = async () => (await m.db.db.customers.get(customerId))!.balance

beforeEach(async () => {
  vi.resetModules()
  await Dexie.delete('subgeo-pos')
  m = { db: await import('../db/db'), entry: await import('../medapp/pages/EntryScreens') }
  productId = (await m.db.db.products.add({ sku: 'PCM', name: 'PCM', cost: 500, price: 1000, stock: 50, reorderLevel: 0, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 })) as number
  customerId = (await m.db.db.customers.add({ name: 'ABC CLINIC', balance: 0, creditLimit: 0, createdAt: 0 })) as number
})

describe('whole-sale document effects', () => {
  it('a quotation changes nothing', async () => {
    await m.entry.applyDocEffects('sales-quotation', { values: { docNo: 'SQ-1-26', total: '100.00' }, lines: [line(10)] }, 1)
    expect(await stock()).toBe(50)
  })

  it('a delivery note takes stock out and logs the movement', async () => {
    await m.entry.applyDocEffects('delivery-note', { values: { docNo: 'DN-1-26' }, lines: [line(10)] }, 1)
    expect(await stock()).toBe(40)
    const mv = await m.db.db.movements.toArray()
    expect(mv.map((x) => [x.change, x.reason, x.reference])).toEqual([[-10, 'sale', 'DN-1-26']])
  })

  it('editing a delivery note undoes the old quantity first', async () => {
    const v1 = { values: { docNo: 'DN-1-26' }, lines: [line(10)] }
    await m.entry.applyDocEffects('delivery-note', v1, 1)
    await m.entry.applyDocEffects('delivery-note', v1, -1)
    await m.entry.applyDocEffects('delivery-note', { values: { docNo: 'DN-1-26' }, lines: [line(4)] }, 1)
    expect(await stock()).toBe(46)
  })

  it('an invoice posts to the customer and only takes stock not already delivered', async () => {
    await m.entry.applyDocEffects(
      'whole-sale-invoice',
      { values: { docNo: 'WSI-1-26', total: '150.00', posted: '1', customerId: String(customerId) }, lines: [line(10, { srcSlug: 'delivery-note', srcDocNo: 'DN-1-26', srcLine: 0 }), line(5)] },
      1,
    )
    expect(await stock()).toBe(45)
    expect(await balance()).toBe(150_00)
  })

  it('an invoice with Accounts? off does not touch the balance', async () => {
    await m.entry.applyDocEffects('whole-sale-invoice', { values: { docNo: 'WSI-2-26', total: '100.00', posted: '0', customerId: String(customerId) }, lines: [line(10)] }, 1)
    expect(await balance()).toBe(0)
  })

  it('a credit note returns stock and credits the customer', async () => {
    await m.db.db.customers.update(customerId, { balance: 300_00 })
    await m.entry.applyDocEffects('credit-note', { values: { docNo: 'CN-1-26', total: '100.00', posted: '1', customerId: String(customerId) }, lines: [line(10)] }, 1)
    expect(await stock()).toBe(60)
    expect(await balance()).toBe(200_00)
  })
})
