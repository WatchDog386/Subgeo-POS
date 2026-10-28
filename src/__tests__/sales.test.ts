import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { seedIfEmpty } from '../db/seed'
import { completeSale, refundSale, SaleError } from '../db/sales'
import { closeShift, openShift } from '../db/shifts'
import { draftReorder, receivePurchaseOrder } from '../db/purchasing'
import type { Product, SaleLine } from '../db/types'

const lineFor = (p: Product, qty = 1): SaleLine => ({
  productId: p.id,
  name: p.name,
  sku: p.sku,
  qty,
  unitPrice: p.price,
  unitCost: p.cost,
  discount: 0,
  taxable: p.taxable,
})

/** Fixture products replacing the removed demo catalog. */
async function seedFixture(): Promise<void> {
  await db.products.bulkAdd([
    { sku: 'MED-PARA-500', name: 'Paracetamol 500mg', cost: 150_00, price: 350_00, stock: 100, reorderLevel: 20, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'MED-AMOX-250', name: 'Amoxicillin 250mg', cost: 400_00, price: 900_00, stock: 50, reorderLevel: 10, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'MED-CETIRIZINE', name: 'Cetirizine 10mg', cost: 200_00, price: 500_00, stock: 80, reorderLevel: 15, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'MED-ORS', name: 'ORS Sachet', cost: 100_00, price: 250_00, stock: 120, reorderLevel: 25, fitment: [], taxable: false, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'MED-VIT-C', name: 'Vitamin C 500mg', cost: 250_00, price: 600_00, stock: 60, reorderLevel: 12, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'MED-IBUPROFEN-400', name: 'Ibuprofen 400mg', cost: 180_00, price: 450_00, stock: 45, reorderLevel: 8, fitment: [], taxable: true, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 },
    { sku: 'SVC-CONSULT', name: 'Consultation fee', cost: 0, price: 1_000_00, stock: 0, reorderLevel: 0, fitment: [], taxable: false, serialized: false, trackStock: false, active: true, createdAt: 0, updatedAt: 0 },
  ])
  await db.customers.add({
    name: 'City Clinic Ltd',
    balance: 0,
    creditLimit: 50_000_00,
    createdAt: 0,
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await seedIfEmpty()
  await seedFixture()
})

describe('sales', () => {
  it('completes a sale, deducts stock and numbers receipts', async () => {
    const para = (await db.products.where('sku').equals('MED-PARA-500').first())!
    const sale = await completeSale({ lines: [lineFor(para, 2)], discount: 0, payments: [{ method: 'cash', amount: 2_000_00 }], userId: 1 })
    expect(sale.receiptNo).toBe('R-000001')
    expect(sale.total).toBe(700_00)
    expect(sale.change).toBe(1_300_00)
    expect((await db.products.get(para.id!))!.stock).toBe(para.stock - 2)
    expect(await db.movements.where('productId').equals(para.id!).count()).toBe(1)
  })

  it('does not touch stock for labour', async () => {
    const consult = (await db.products.where('sku').equals('SVC-CONSULT').first())!
    await completeSale({ lines: [lineFor(consult)], discount: 0, payments: [{ method: 'mpesa', amount: 1_000_00, reference: 'ABC1234567' }], userId: 1 })
    expect((await db.products.get(consult.id!))!.stock).toBe(0)
  })

  it('rejects underpayment and enforces credit limits', async () => {
    const ibu = (await db.products.where('sku').equals('MED-IBUPROFEN-400').first())!
    await expect(completeSale({ lines: [lineFor(ibu)], discount: 0, payments: [{ method: 'cash', amount: 100 }], userId: 1 })).rejects.toThrow(SaleError)
    const clinic = (await db.customers.where('name').startsWith('City').first())!
    const amox = (await db.products.where('sku').equals('MED-AMOX-250').first())!
    await expect(
      completeSale({ lines: [lineFor(amox, 3)], discount: 0, payments: [{ method: 'account', amount: 63_000_00 }], customerId: clinic.id, userId: 1 }),
    ).rejects.toThrow(/Credit limit/)
    await completeSale({ lines: [lineFor(ibu)], discount: 0, payments: [{ method: 'account', amount: 3_000_00 }], customerId: clinic.id, userId: 1 })
    expect((await db.customers.get(clinic.id!))!.balance).toBe(3_000_00)
  })

  it('partially refunds and restocks', async () => {
    const vit = (await db.products.where('sku').equals('MED-VIT-C').first())!
    const sale = await completeSale({ lines: [lineFor(vit, 3)], discount: 0, payments: [{ method: 'cash', amount: 1_950_00 }], userId: 1 })
    const refund = await refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 1 })
    expect(refund.total).toBe(-600_00)
    expect((await db.sales.get(sale.id!))!.status).toBe('partially_refunded')
    expect((await db.products.get(vit.id!))!.stock).toBe(vit.stock - 2)
    await expect(refundSale(sale.id!, { qtyByLine: { 0: 3 }, restock: true, method: 'cash', userId: 1 })).rejects.toThrow(/Only 2/)
    await refundSale(sale.id!, { qtyByLine: { 0: 2 }, restock: false, method: 'cash', userId: 1 })
    expect((await db.sales.get(sale.id!))!.status).toBe('refunded')
  })
})

describe('shifts', () => {
  it('computes expected cash net of change and refunds', async () => {
    const shift = await openShift(1, 5_000_00)
    const ibu = (await db.products.where('sku').equals('MED-IBUPROFEN-400').first())!
    const sale = await completeSale({ lines: [lineFor(ibu, 2)], discount: 0, payments: [{ method: 'cash', amount: 2_000_00 }], userId: 1, shiftId: shift.id })
    await completeSale({ lines: [lineFor(ibu)], discount: 0, payments: [{ method: 'mpesa', amount: 450_00, reference: 'QWE1234567' }], userId: 1, shiftId: shift.id })
    await refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 1, shiftId: shift.id })
    const summary = await closeShift(shift.id!, 5_450_00)
    expect(summary.byMethod.cash).toBe(450_00)
    expect(summary.byMethod.mpesa).toBe(450_00)
    expect(summary.expectedCash).toBe(5_450_00)
  })
})

describe('purchasing', () => {
  it('drafts a reorder for low stock and receives it', async () => {
    const ibu = (await db.products.where('sku').equals('MED-IBUPROFEN-400').first())!
    await db.products.update(ibu.id!, { stock: 1 })
    const po = (await draftReorder())!
    const idx = po.lines.findIndex((l) => l.productId === ibu.id)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(po.lines[idx].qty).toBe(ibu.reorderLevel * 2 - 1)
    await receivePurchaseOrder(po.id!, { [idx]: po.lines[idx].qty })
    expect((await db.products.get(ibu.id!))!.stock).toBe(ibu.reorderLevel * 2)
    expect((await db.purchaseOrders.get(po.id!))!.status).toBe('partial')
  })
})
