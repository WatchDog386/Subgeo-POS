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

  it('applies what the buyer corrected: the name, the VAT and what a pack holds', async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    const m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
    const id = (await m.db.db.products.add({ sku: 'COF1', name: 'COFTA TABS', fitment: [], cost: 100, price: 200, stock: 1, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    await m.imp.receiveInvoice({
      lines: [
        { name: 'COFTA TABLETS (100S)', qty: 100, costCents: 100, productId: id, vat: true, packs: 1, perPack: 100, sellBy: 1, packCostCents: 10000 },
        { name: 'BENACOF SYRUP', code: 'BEN100', qty: 2, costCents: 9000, priceCents: 15000, vat: false, perPack: 1, sellBy: 1, contents: '100 ml' },
      ],
      vendor: 'V', invoiceNo: '1', totalCents: 0, expense: '', receivedBy: 'p',
    })
    const p = (await m.db.db.products.get(id))!
    expect([p.name, p.taxable, p.stock]).toEqual(['COFTA TABLETS (100S)', true, 101])
    const meds = await m.db.db.docs.where('slug').equals('medicine').toArray()
    expect(meds.find((d) => d.values.docNo === 'COF1')?.values).toMatchObject({ name: 'COFTA TABLETS (100S)', contents: '100 tabs' })
    expect(meds.find((d) => d.values.docNo === 'BEN100')?.values).toMatchObject({ name: 'BENACOF SYRUP', contents: '100 ml' })
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

describe('sales quote with units on quantities, a VAT % column and wrapped codes', () => {
  it('reads Philmed-style lines, the supplier on the right, number, date and total', () => {
    const pg: TextItem[] = [
      T(57, 796, 'Sales Quote SQ299284'), T(57, 775, 'November 9, 2026'),
      T(57, 704, 'SUBGEO PHARMACY UMOJA 3'), T(486, 704, 'PHILMED LIMITED'),
      T(57, 508, 'No.'), T(105, 508, 'Description'), T(261, 508, 'Quantity'), T(349, 518, 'Unit Price Excl.'), T(389, 508, 'VAT'), T(452, 508, 'VAT %'), T(483, 508, 'Line Amount Excl. VAT'),
      T(57, 482, 'ITM0491'), T(105, 482, 'PCM CALPOL SUSP 60ML'), T(288, 482, '5 WHL'), T(340, 482, '265.00'), T(447, 482, '0'), T(482, 482, '1,325.00'),
      T(57, 468, '0'),
      T(57, 187, 'ITM0546'), T(105, 187, 'SALBUTAMOL(VENTIL) BPTABS'), T(288, 187, '3 WHL'), T(340, 187, '50.00'), T(447, 187, '0'), T(482, 187, '150.00'),
      T(57, 174, '8'), T(105, 174, '100S'),
      T(340, 143, 'Total KSH Incl. VAT'), T(522, 143, '1,475.00'),
    ]
    const r = parseInvoiceText([pg])
    expect(r.lines.map((l) => [l.code, l.name, l.qty, l.unitPrice, l.amount])).toEqual([
      ['ITM04910', 'PCM CALPOL SUSP 60ML', 5, 265, 1325],
      ['ITM05468', 'SALBUTAMOL(VENTIL) BPTABS 100S', 3, 50, 150],
    ])
    expect([r.supplier, r.docNo, invoiceDate(r.date), r.total]).toEqual(['PHILMED LIMITED', 'SQ299284', '09-11-2026', 1475])
  })
})

describe('order documents (Daily Order Book): quantities, no prices', () => {
  it('reads a stock print whose quantity heading is "QTY / UNITS" (no item codes)', () => {
    const pg: TextItem[] = [
      T(29, 552, 'SUBGEO CHEMIST'),
      T(29, 539, 'PUR/GRN (DIRECT INVOICE +) | SUBGEO KWARE'),
      T(226, 490, 'DESCRIPTION'), T(502, 490, 'QTY / UNITS'), T(599, 490, 'UNIT PRICE'), T(701, 490, 'AMOUNT'),
      T(34, 473, 'ABZ tabs 1s'), T(537, 472, '27.000'),
      T(34, 395, 'Amoxicillin Capsules tab 500mg 100s'), T(532, 394, '432.000'),
      T(34, 426, 'Acnesol Cream 25gm'), T(543, 425, '5.000'),
      T(23, 17, 'PUR/GRN (Direct Invoice +) - Prices intentionally left blank for entry'), T(797, 17, 'Page 1'),
    ]
    const r = parseInvoiceText([pg])
    expect(r.lines.map((l) => [l.name, l.qty, l.unitPrice])).toEqual([
      ['ABZ tabs 1s', 27, 0],
      ['Acnesol Cream 25gm', 5, 0],
      ['Amoxicillin Capsules tab 500mg 100s', 432, 0],
    ])
    expect(r.unpriced).toBe(3)
  })

  const orderPage = (): TextItem[] => [
    T(214, 797, 'DAILY ORDER BOOK'),
    T(34, 774, 'CASH WHOLESALE 6'),
    T(38, 717, 'Account'), T(180, 717, 'Date'), T(271, 717, 'Order No'), T(361, 717, 'Delivery Note'),
    T(38, 700, 'CASH WHOLESALE 6'),
    T(29, 667, 'Item Code'), T(85, 667, 'Item Description'), T(328, 667, 'Units'), T(366, 667, 'Price (In)'), T(424, 667, 'Disc %'), T(517, 667, 'Total (Incl)'),
    T(29, 651, '001'), T(85, 651, 'ABNAI NASAL DROP'), T(333, 651, '6.00'),
    T(29, 634, '002'), T(85, 634, 'APC TABS'), T(328, 634, '104.00'),
    T(29, 618, '003'), T(85, 618, 'CLOB B'),
    T(29, 602, '004'), T(85, 602, 'FRANOL TABS'), T(333, 602, '4.00'), T(380, 602, '25.00'),
    T(40, 200, 'Removed By:'), T(100, 200, 'Name ______'), T(300, 200, 'Date ______________'),
    T(534, 23, 'Page 1'),
  ]
  it('reads code · description · units under the Units column, prices blank or typed', () => {
    const inv = parseInvoiceText([orderPage()])
    expect(inv.lines.map((l) => [l.code, l.name, l.qty, l.unitPrice])).toEqual([
      ['001', 'ABNAI NASAL DROP', 6, 0],
      ['002', 'APC TABS', 104, 0],
      ['004', 'FRANOL TABS', 4, 25],
    ])
    expect(inv.skipped).toEqual(['003 CLOB B'])
    expect(inv.unpriced).toBe(2)
    expect(inv.title).toBe('DAILY ORDER BOOK')
    expect(inv.docNo).toBeUndefined() // the empty Order No box is not "Delivery Note"
    expect(inv.date).toBeUndefined() // nor the signature line's "Date ______"
  })
  it('still refuses a priced row that does not add up', () => {
    const p = orderPage()
    p.push(T(29, 586, '005'), T(85, 586, 'BAD ROW'), T(333, 586, '3.00'), T(380, 586, '10.00'), T(530, 586, '99.00'))
    expect(parseInvoiceText([p]).lines.map((l) => l.name)).not.toContain('BAD ROW')
  })
  it('receives without prices: keeps the cost, row numbers never become codes, repeats top up', async () => {
    vi.resetModules()
    await Dexie.delete('subgeo-pos')
    const m = { db: await import('../db/db'), imp: await import('../medapp/pages/InvoiceImport') }
    const id = (await m.db.db.products.add({ sku: 'X9', name: 'ABNAI NASAL DROP', fitment: [], cost: 4500, price: 6000, stock: 1, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    expect(m.imp.matchProduct(await m.db.db.products.toArray(), '001', 'ABNAI NASAL DROP')?.id).toBe(id)
    await m.imp.receiveInvoice({
      lines: [
        { code: '001', name: 'ABNAI NASAL DROP', qty: 6, costCents: 0, productId: id, vat: false },
        { code: '002', name: 'APC TABS', qty: 80, costCents: 0, priceCents: 500, vat: false },
        { code: '026', name: 'APC TABS', qty: 57, costCents: 0, priceCents: 500, vat: false },
      ],
      vendor: 'CASH WHOLESALE 6', invoiceNo: '', totalCents: 0, expense: '', receivedBy: 'p',
    })
    const a = (await m.db.db.products.get(id))!
    expect([a.stock, a.cost]).toEqual([7, 4500])
    const apc = (await m.db.db.products.toArray()).filter((p) => p.name === 'APC TABS')
    expect(apc).toHaveLength(1)
    expect(apc[0].stock).toBe(137)
    expect(apc[0].sku).toMatch(/^PRD00-/)
  })
})
