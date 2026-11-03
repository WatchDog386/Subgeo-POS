// Bills, returns and service bills saved from the entry screens (which don't
// pass a shift) still count in the open shift's cash-up.
import { beforeEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'

beforeEach(async () => {
  vi.resetModules()
  await Dexie.delete('subgeo-pos')
})

it('attaches bills and refunds to the open shift', async () => {
  const { db } = await import('../db/db')
  const sales = await import('../db/sales')
  const shifts = await import('../db/shifts')
  const pid = (await db.products.add({ sku: 'P1', name: 'PCM', cost: 500, price: 1000, stock: 10, reorderLevel: 0, fitment: [], taxable: false, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 })) as number
  const shift = await shifts.openShift(2, 1000_00)
  const sale = await sales.completeSale({ lines: [{ productId: pid, name: 'PCM', qty: 3, unitPrice: 1000, unitCost: 500, discount: 0, taxable: false }], discount: 0, payments: [{ method: 'cash', amount: 3000 }], userId: 2 })
  expect(sale.shiftId).toBe(shift.id)
  const refund = await sales.refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 2 })
  expect(refund.shiftId).toBe(shift.id)
  const sum = await shifts.closeShift(shift.id!, 1020_00)
  expect(sum.sales).toBe(3000)
  expect(sum.refunds).toBe(1000)
  expect((await db.products.get(pid))!.stock).toBe(8)
  // With no open shift the sale simply has none.
  const later = await sales.completeSale({ lines: [{ productId: pid, name: 'PCM', qty: 1, unitPrice: 1000, unitCost: 500, discount: 0, taxable: false }], discount: 0, payments: [{ method: 'cash', amount: 1000 }], userId: 2 })
  expect(later.shiftId).toBeUndefined()
})
