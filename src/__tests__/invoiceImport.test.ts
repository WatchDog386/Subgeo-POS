// Supplier invoice PDF import (Pur/GRN Direct Invoice → Upload Supplier Invoice).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { invoiceDate, parseInvoiceText, type TextItem } from '../lib/invoiceParse'

const T = (x: number, y: number, str: string): TextItem => ({ x, y, str })

/** A page laid out like a typical Kenyan distributor's proforma. */
function page(items: [string, string, string, string, string][], opts: { last?: boolean; header?: boolean } = {}): TextItem[] {
  const out: TextItem[] = [
    T(32, 823, 'ACME PHARMA DISTRIBUTORS LTD'),
    T(310, 826, '0789 444 777 | 0789 903 000'),
    T(32, 803, '2ND FLOOR, SOME MALL'),
    T(319, 695, 'PI #'),
    T(419, 695, '777001'),
    T(319, 675, 'Quotation Date'),
    T(419, 675, '28/10/26'),
    T(319, 610, 'Total Amount'),
    T(414, 610, 'KSh 1,516.00'),
    T(32, 517, 'Item'),
    T(82, 517, 'Description'),
    T(354, 517, 'Quantity'),
    T(433, 517, 'Unit Price'),
    T(540, 517, 'Amount'),
  ]
  let y = 498
  for (const [code, name, qty, price, amount] of items) {
    // The item code sits a point lower than the rest of the row in these PDFs.
    out.push(T(32, y - 1, code), T(82, y, name), T(373, y, qty), T(448, y, price), T(545, y, amount))
    y -= 20
  }
  if (opts.last) out.push(T(403, 451, 'Subtotal'), T(508, 451, 'KSh 1,500.00'), T(403, 420, 'VAT 16%'), T(533, 420, 'KSh 16'), T(403, 397, 'Total Amount'), T(506, 397, 'KSh 1,516.00'))
  out.push(T(280, 116, '28/10/26'), T(282, 78, '1'), T(293, 78, 'of'), T(308, 78, '2'))
  return out
}

describe('reading the invoice', () => {
  it('finds every line, the supplier, number, date and totals', () => {
    const inv = parseInvoiceText([
      page([
        ['I07302', 'Benacof Paediatric (60ml)', '10', 'KSh 42.9', 'KSh 429'],
        ['I02007', 'Good Morning Lung Tonic (60ml)', '5', 'KSh 79.9', 'KSh 399.5'],
      ]),
      page([['I04340', 'Ventolin Inhaler (200D)', '1', 'KSh 671.5', 'KSh 671.5']], { last: true }),
    ])
    expect(inv.supplier).toBe('ACME PHARMA DISTRIBUTORS LTD')
    expect(inv.docNo).toBe('777001')
    expect(inv.date).toBe('28/10/26')
    expect(inv.subtotal).toBe(1500)
    expect(inv.vat).toBe(16)
    expect(inv.total).toBe(1516)
    expect(inv.lines.map((l) => [l.code, l.name, l.qty, l.unitPrice, l.amount, l.page])).toEqual([
      ['I07302', 'Benacof Paediatric (60ml)', 10, 42.9, 429, 1],
      ['I02007', 'Good Morning Lung Tonic (60ml)', 5, 79.9, 399.5, 1],
      ['I04340', 'Ventolin Inhaler (200D)', 1, 671.5, 671.5, 2],
    ])
    expect(inv.linesTotal).toBe(1500)
  })

  it('joins a description that wraps onto the next line', () => {
    const p = page([['I01326', 'Disposable Syringe 10ml WITHOUT', '2', 'KSh 355', 'KSh 710']])
    p.push(T(82, 488, 'Needle (100s)'))
    expect(parseInvoiceText([p]).lines[0].name).toBe('Disposable Syringe 10ml WITHOUT Needle (100s)')
  })

  it('ignores rows that do not add up (headers, phone numbers, totals)', () => {
    const p = page([['I1', 'Real item', '2', 'KSh 10', 'KSh 20']])
    p.push(T(82, 300, 'Looks like an item'), T(373, 300, '3'), T(448, 300, 'KSh 10'), T(545, 300, 'KSh 99'))
    expect(parseInvoiceText([p]).lines.map((l) => l.name)).toEqual(['Real item'])
  })

  it('converts dd/mm/yy to the app date', () => {
    expect(invoiceDate('28/10/26')).toBe('28-10-2026')
    expect(invoiceDate('5.1.2027')).toBe('05-01-2027')
    expect(invoiceDate('soon')).toBeUndefined()
  })
})

describe('receiving the invoice into stock', () => {
  type Mods = { db: typeof import('../db/db'); imp: typeof import('../medapp/pages/InvoiceImport') }
  let m: Mods
  let calpol = 0
  beforeEach(async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
    calpol = (await m.db.db.products.add({ sku: 'I00646', name: 'CALPOL SUSPENSION (60ML)', cost: 20000, price: 35000, stock: 4, reorderLevel: 2, fitment: [], taxable: false, serialized: false, trackStock: true, active: true, createdAt: 0, updatedAt: 0 })) as number
  })

  it('matches by item code, then by name', async () => {
    const all = await m.db.db.products.toArray()
    expect(m.imp.matchProduct(all, 'i00646', 'whatever')?.id).toBe(calpol)
    expect(m.imp.matchProduct(all, 'X9', 'Calpol Suspension (60ml)')?.id).toBe(calpol)
    expect(m.imp.matchProduct(all, 'X9', 'Calpol Suspension (100ml)')).toBeUndefined()
  })

  it('tops up stock, updates cost, creates new medicines and files one MRN with the PDF', async () => {
    const r = await m.imp.receiveInvoice({
      lines: [
        { code: 'I00646', name: 'Calpol Suspension (60ml)', qty: 3, costCents: 24900, productId: calpol, vat: false },
        { code: 'I04340', name: 'Ventolin Inhaler (200D)', qty: 5, costCents: 49900, priceCents: m.imp.priceFromMarkup(499, 33) * 100, vat: true },
      ],
      vendor: 'Victoria Healthcare Limited',
      invoiceNo: '1513144',
      invoiceDate: '28-10-2026',
      totalCents: 3_242_00,
      expense: 'purchases medicine',
      receivedBy: 'purchase',
      attachment: { name: 'so.pdf', data: 'data:application/pdf;base64,AA==' },
    })
    expect(r).toMatchObject({ added: 1, updated: 1 })
    const c = (await m.db.db.products.get(calpol))!
    expect([c.stock, c.cost, c.price]).toEqual([7, 24900, 35000])
    const v = (await m.db.db.products.where('sku').equals('I04340').first())!
    expect([v.name, v.stock, v.cost, v.price, v.taxable, v.active]).toEqual(['VENTOLIN INHALER (200D)', 5, 49900, 66400, true, true])
    const sup = (await m.db.db.suppliers.toArray()).map((s) => s.name)
    expect(sup).toEqual(['VICTORIA HEALTHCARE LIMITED'])
    expect(v.supplierId).toBeDefined()
    const doc = (await m.db.db.docs.get(r.docId))!
    expect(doc.slug).toBe('pur-grn-direct-invoice')
    expect(doc.values).toMatchObject({ invoice: '1513144', vendorName: 'VICTORIA HEALTHCARE LIMITED', total: '3242.00', expense: 'PURCHASES MEDICINE', status: 'GOOD RECEIVED', attachmentName: 'so.pdf', invoiceDate: '28-10-2026' })
    expect(doc.lines?.map((l) => [l.name, l.qty, l.cost, l.total])).toEqual([
      ['CALPOL SUSPENSION (60ML)', 3, 24900, 74700],
      ['VENTOLIN INHALER (200D)', 5, 49900, 249500],
    ])
    const mv = await m.db.db.movements.toArray()
    expect(mv.map((x) => [x.change, x.reason, x.reference])).toEqual([
      [3, 'receive', r.docNo],
      [5, 'receive', r.docNo],
    ])
  })

  it('receives nothing when a new medicine has no selling price', async () => {
    await expect(
      m.imp.receiveInvoice({ lines: [{ code: 'NEW1', name: 'New Thing', qty: 1, costCents: 100, vat: false }], vendor: 'X', invoiceNo: '1', totalCents: 100, expense: '', receivedBy: 'p' }),
    ).rejects.toThrow(/selling price/)
    expect(await m.db.db.products.count()).toBe(1)
    expect(await m.db.db.docs.count()).toBe(0)
    expect((await m.db.db.products.get(calpol))!.stock).toBe(4)
  })
})

describe('Best Price from an uploaded invoice', () => {
  let m: { db: typeof import('../db/db'); imp: typeof import('../medapp/pages/InvoiceImport') }
  beforeEach(async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
  })
  it('sets it on matched and new medicines', async () => {
    const id = (await m.db.db.products.add({ sku: 'X1', name: 'X ONE', fitment: [], cost: 100, price: 500, stock: 0, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    await m.imp.receiveInvoice({
      lines: [
        { name: 'X ONE', qty: 2, costCents: 120, productId: id, bestCents: 400, vat: false },
        { code: 'N1', name: 'NEW ONE', qty: 1, costCents: 100, priceCents: 300, bestCents: 250, vat: false },
      ],
      vendor: 'V', invoiceNo: '1', totalCents: 340, expense: '', receivedBy: 'p',
    })
    expect((await m.db.db.products.get(id))!.minPrice).toBe(400)
    expect((await m.db.db.products.where('sku').equals('N1').first())!.minPrice).toBe(250)
  })
})

describe('packs on supplier invoices', () => {
  it('reads pieces per pack from the description, not volumes or strengths', async () => {
    const { packSizeFrom } = await import('../medapp/pages/InvoiceImport')
    expect(packSizeFrom('SURGICAL FACE MASK (50S) - AKSHAR BLUE')).toBe(50)
    expect(packSizeFrom("BECOACTIN TABLETS (30'S)")).toBe(30)
    expect(packSizeFrom('AGYCIN 500MG TABLETS (3S) AZITHROMYCIN')).toBe(3)
    expect(packSizeFrom('PANADOL 10X10')).toBe(100)
    expect(packSizeFrom('GLOVES PACK OF 100')).toBe(100)
    expect(packSizeFrom('AMOXIL 500MG 100 CAPS')).toBe(100)
    expect(packSizeFrom('CALPOL SUSPENSION (60ML)')).toBe(1)
    expect(packSizeFrom('HEMOFORCE FAMILY SYRUP 200ML')).toBe(1)
    expect(packSizeFrom('ABZ TABLETS (1S)')).toBe(1)
  })
  it('units = packs × pcs ÷ sell-by; cost of 1 = pack cost ÷ units in a pack', async () => {
    const { lineUnits, sellByChoices } = await import('../medapp/pages/InvoiceImport')
    expect(lineUnits(2, 100, 1, 31500)).toEqual({ units: 200, unitCost: 315 })
    expect(lineUnits(3, 10, 2, 1000)).toEqual({ units: 15, unitCost: 200 })
    expect(lineUnits(4, 30, 30, 12000)).toEqual({ units: 4, unitCost: 12000 })
    expect(lineUnits(5, 1, 1, 24900)).toEqual({ units: 5, unitCost: 24900 })
    expect(lineUnits(1, 15, 2, 100).error).toMatch(/Sell By must divide/)
    expect(lineUnits(0, 10, 1, 100).error).toMatch(/Qty/)
    expect(lineUnits(1, 0, 1, 100).error).toMatch(/Pcs\/Pack/)
    expect(sellByChoices(10).map((c) => c.value)).toEqual([1, 2, 5, 10])
    expect(sellByChoices(3).map((c) => c.value)).toEqual([1, 3])
    expect(sellByChoices(1).map((c) => c.value)).toEqual([1])
  })
  it('receives pieces at the cost of one and remembers the pack size', async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    const m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
    const id = (await m.db.db.products.add({ sku: 'I00046', name: 'ACTION TABLETS (100S)', fitment: [], cost: 31500, price: 40000, stock: 0, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    const r = await m.imp.receiveInvoice({
      lines: [{ name: 'ACTION TABLETS (100S)', qty: 200, costCents: 315, priceCents: 500, bestCents: 400, productId: id, vat: false, packs: 2, perPack: 100, sellBy: 1, packCostCents: 31500 }],
      vendor: 'VICTORIA', invoiceNo: '9', totalCents: 63000, expense: '', receivedBy: 'p',
    })
    const p = (await m.db.db.products.get(id))!
    expect([p.stock, p.cost, p.price, p.minPrice]).toEqual([200, 315, 500, 400])
    const doc = (await m.db.db.docs.get(r.docId))!
    expect(doc.lines?.[0]).toMatchObject({ qty: 200, cost: 315, total: 63000, packs: 2, perPack: 100, sellBy: 1 })
    const med = (await m.db.db.docs.where('slug').equals('medicine').toArray())[0]
    expect(med.values).toMatchObject({ docNo: 'I00046', packSize: '100', sellBy: '1' })
  })
})

describe('old per-pack stock', () => {
  it('is converted to units, with its prices per unit, before the delivery is added', async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    const m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
    const id = (await m.db.db.products.add({ sku: 'I00046', name: 'ACTION TABLETS (100S)', fitment: [], cost: 31500, price: 41900, minPrice: 40000, stock: 2, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    await m.imp.receiveInvoice({
      lines: [{ name: 'ACTION TABLETS (100S)', qty: 100, costCents: 315, productId: id, vat: false, packs: 1, perPack: 100, sellBy: 1, packCostCents: 31500, convertFactor: 100 }],
      vendor: 'V', invoiceNo: '10', totalCents: 31500, expense: '', receivedBy: 'p',
    })
    const p = (await m.db.db.products.get(id))!
    expect([p.stock, p.price, p.minPrice, p.cost]).toEqual([300, 419, 400, 315])
  })
})
