// CASH COLLECTION DEBTORS + OTC: money actually collected in the period,
//   OTC BILLS          every bill's cash / M-Pesa / card / cheque  → SUB TOTAL
//   DEBTORS RECEIPTS   Final Bill Receipts (paid in by credit customers) → SUB TOTAL
//   GRAND TOTAL
import { db } from '../../db/db'
import { toCents } from '../../lib/money'
import { amt, billNo, dmy, getMedDefaults, inRange, paidBy, parseDmy } from '../data'
import type { Col } from '../ui'
import type { ReportRow } from './reportPrint'

const C = (key: string, label: string, width: number, align?: 'right'): Col => ({ key, label, width, align })
export const CASH_COLS: Col[] = [C('date', 'Date', 100), C('rec', 'Rec No', 150), C('party', 'Received From', 170), C('cash', 'Cash', 100, 'right'), C('mpesa', 'Mpesa', 100, 'right'), C('card', 'Credit Card', 100, 'right'), C('cheque', 'Cheque', 100, 'right'), C('total', 'Total Rec Amt', 120, 'right')]

type Sums = { cash: number; mpesa: number; card: number; cheque: number; total: number }
const zero = (): Sums => ({ cash: 0, mpesa: 0, card: 0, cheque: 0, total: 0 })
const add = (a: Sums, b: Sums) => (Object.keys(a) as (keyof Sums)[]).forEach((k) => (a[k] += b[k]))
const cells = (s: Sums) => ({ cash: amt(s.cash), mpesa: amt(s.mpesa), card: amt(s.card), cheque: amt(s.cheque), total: amt(s.total) })

/** How a Final Bill Receipt was paid: a cheque number, else the account it went to. */
export function receiptMethod(values: Record<string, string>): keyof Omit<Sums, 'total'> {
  if ((values.cheque ?? '').trim()) return 'cheque'
  const to = (values.depositTo ?? '').toUpperCase()
  if (/M-?PESA|MOBILE/.test(to)) return 'mpesa'
  if (/CARD|VISA|MASTER|PDQ/.test(to)) return 'card'
  if (/CHEQUE|CHQ/.test(to)) return 'cheque'
  return 'cash'
}

export async function cashCollection(from: string, to: string): Promise<{ cols: Col[]; rows: ReportRow[]; totals: { otc: Sums; debtors: Sums; grand: Sums } }> {
  const d = await getMedDefaults()
  const rows: ReportRow[] = []
  // OTC (and service) bills: what was paid at the till, less change given.
  const otc = zero()
  const sales = (await db.sales.orderBy('createdAt').toArray()).filter((s) => inRange(s.createdAt, from, to))
  const custName = new Map((await db.customers.toArray()).map((c) => [c.id!, c.name]))
  const otcRows: ReportRow[] = []
  for (const s of sales) {
    const v: Sums = { cash: paidBy(s, 'cash'), mpesa: paidBy(s, 'mpesa'), card: paidBy(s, 'card'), cheque: paidBy(s, 'cheque'), total: 0 }
    v.total = v.cash + v.mpesa + v.card + v.cheque
    if (!v.total) continue // all on account: nothing collected
    add(otc, v)
    otcRows.push({ date: dmy(s.createdAt), rec: billNo(s, d.billPrefix), party: ((s.customerId !== undefined ? custName.get(s.customerId) : undefined) || s.patientName || (s.refundOf ? 'REFUND' : 'OTC CLIENT')).toUpperCase(), ...cells(v) })
  }
  // Debtors: Final Bill Receipts dated in the period.
  const debtors = zero()
  const receipts = (await db.docs.where('slug').equals('final-bill-receipt').toArray())
    .map((r) => ({ r, at: parseDmy((r.values.date ?? '').replace(/\//g, '-')) ?? r.createdAt }))
    .filter(({ at }) => inRange(at, from, to))
    .sort((a, b) => a.at - b.at)
  const debtRows: ReportRow[] = []
  for (const { r, at } of receipts) {
    const amount = toCents(r.values.total || '0')
    if (!amount) continue
    const v: Sums = zero()
    v[receiptMethod(r.values)] = amount
    v.total = amount
    add(debtors, v)
    debtRows.push({ date: dmy(at), rec: r.values.docNo || r.docNo || '', party: (r.values.customer ?? '').toUpperCase(), ...cells(v) })
  }
  const grand = zero()
  add(grand, otc)
  add(grand, debtors)
  if (otcRows.length || debtRows.length) {
    rows.push({ _kind: 'head', date: 'OTC BILLS' })
    rows.push(...otcRows)
    rows.push({ _kind: 'sub', date: 'SUB TOTAL', rec: 'OTC BILLS', party: `${otcRows.length} bill(s)`, ...cells(otc) })
    rows.push({ _kind: 'head', date: 'DEBTORS RECEIPTS' })
    rows.push(...debtRows)
    rows.push({ _kind: 'sub', date: 'SUB TOTAL', rec: 'DEBTORS', party: `${debtRows.length} receipt(s)`, ...cells(debtors) })
    rows.push({ _kind: 'total', date: 'GRAND TOTAL', rec: '', party: '', ...cells(grand) })
  }
  return { cols: CASH_COLS, rows, totals: { otc, debtors, grand } }
}
