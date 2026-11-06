// CASH COLLECTION DEBTORS + OTC: sections, SUB TOTALs and the GRAND TOTAL.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { Sale } from '../db/types'

let m: { db: typeof import('../db/db'); cc: typeof import('../medapp/reports/cashCollection'); rp: typeof import('../medapp/reports/reportPrint') }
const at = (d: number) => new Date(2026, 10, d, 10).getTime()
const sale = (d: number, payments: Sale['payments'], change = 0, extra: Partial<Sale> = {}): Sale =>
  ({ receiptNo: `R${d}`, createdAt: at(d), lines: [], subtotal: 0, discount: 0, tax: 0, total: 0, payments, change, userId: 1, status: 'completed', ...extra }) as Sale

beforeEach(async () => {
  vi.resetModules()
  await Dexie.delete('subgeo-pos')
  m = { db: await import('../db/db'), cc: await import('../medapp/reports/cashCollection'), rp: await import('../medapp/reports/reportPrint') }
  await m.db.db.sales.bulkAdd([
    sale(2, [{ method: 'cash', amount: 50000 }, { method: 'mpesa', amount: 20000 }], 5000), // 450 cash + 200 mpesa
    sale(3, [{ method: 'account', amount: 30000 }]), // on account: nothing collected
    sale(4, [{ method: 'card', amount: 12000 }]),
    sale(20, [{ method: 'cash', amount: 99900 }]), // outside the period
  ])
  const doc = (values: Record<string, string>) => ({ slug: 'final-bill-receipt', docNo: values.docNo, values, createdAt: at(1), updatedAt: at(1) })
  await m.db.db.docs.bulkAdd([
    doc({ docNo: 'FBR-1-26', date: '03-11-2026', customer: 'ABC CLINIC', depositTo: 'CASH', total: '1000.00' }),
    doc({ docNo: 'FBR-2-26', date: '04-11-2026', customer: 'XYZ', depositTo: 'MPESA', total: '250.00' }),
    doc({ docNo: 'FBR-3-26', date: '05-11-2026', customer: 'XYZ', depositTo: 'BANK', cheque: '000123', total: '300.00' }),
    doc({ docNo: 'FBR-4-26', date: '25-11-2026', customer: 'LATE', total: '700.00' }),
  ] as never)
})

describe('cash collection report', () => {
  it('lists OTC bills and debtors receipts, each with a SUB TOTAL, then the GRAND TOTAL', async () => {
    const r = await m.cc.cashCollection('01-11-2026', '10-11-2026')
    const kinds = r.rows.map((x) => x._kind ?? 'line')
    expect(kinds).toEqual(['head', 'line', 'line', 'sub', 'head', 'line', 'line', 'line', 'sub', 'total'])
    const sub = r.rows.filter((x) => x._kind === 'sub')
    expect([sub[0].cash, sub[0].mpesa, sub[0].card, sub[0].total]).toEqual(['450.00', '200.00', '120.00', '770.00'])
    expect([sub[1].cash, sub[1].mpesa, sub[1].cheque, sub[1].total]).toEqual(['1000.00', '250.00', '300.00', '1550.00'])
    const g = r.rows.find((x) => x._kind === 'total')!
    expect([g.date, g.cash, g.mpesa, g.card, g.cheque, g.total]).toEqual(['GRAND TOTAL', '1450.00', '450.00', '120.00', '300.00', '2320.00'])
    // Totals are never in the lines.
    expect(r.rows.filter((x) => !x._kind).some((x) => /TOTAL/.test(x.date))).toBe(false)
  })
  it('prints every row with the sub totals and the grand total set apart', async () => {
    const r = await m.cc.cashCollection('01-11-2026', '10-11-2026')
    const html = m.rp.reportHtml({ company: 'SUBGEO CHEMIST LTD - SUBGEO12', title: 'CASH COLLECTION DEBTORS + OTC', period: 'From 01-11-2026 to 10-11-2026', cols: r.cols, rows: r.rows })
    expect((html.match(/<tr class="sub">/g) ?? []).length).toBe(2)
    expect((html.match(/<tr class="total">/g) ?? []).length).toBe(1)
    expect((html.match(/<tr class="head">/g) ?? []).length).toBe(2)
    expect(html).toContain('thead{display:table-header-group}')
    expect(html).toContain('5 line(s)')
    expect(m.rp.filterReport(r.rows, 'xyz').map((x) => x._kind ?? x.party)).toEqual(['head', 'sub', 'head', 'XYZ', 'XYZ', 'sub', 'total'])
  })
})
