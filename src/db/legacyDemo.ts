// One-off clean-up data. Old builds seeded sample rows (copied from the
// legacy system's screenshots) into the document registers. They are listed
// here ONLY so the upgrade can recognise and drop their exact copies; nothing
// is ever seeded from this list. Shared by the till (src/db/db.ts) and the
// server (server/legacy.ts), so it imports nothing.

type Legacy = { id: number; values: Record<string, string> }
const K = { vendorName: 'KENTONS LIMITED', address: 'P.O BOX KISUMU' }
const L = 'SCL UMOJA 3'
const G = (n: number, docNo: string, mrnDate: string, invoice: string, vendorName: string, total: string): Legacy => ({
  id: n,
  values: { docNo, mrnDate, invoice, vendorName, total, expense: 'PURCHASES MEDICINE', receivedBy: 'PURCHASE', status: 'GOOD RECEIVED' },
})
const M = (n: number, docNo: string, name: string, group: string, uom: string, retail: string, cost: string, packSize: string): Legacy => ({
  id: n,
  values: { docNo, name, group, uom, retail, whole: retail, cost, packSize, type: 'S' },
})
const P = (n: number, v: Record<string, string>): Legacy => ({ id: n, values: { location: L, ...v } })

const LEGACY_DEMO: Record<string, Legacy[]> = {
  'supplier-payment': [{ id: 1, values: { docNo: 'REM-1-24', voucherDate: '15-01-2024', supplierName: 'ADWEL PHARMACY', fromAccount: 'null', refNo: '-', ref: 'PAYMENT FOR OCT TO DEC INVOICES' } }],
  'purchase-indent': [
    P(1, { docNo: 'PI-1-24', indentDate: '15-01-2024', indentor: 'ADMIN', status: 'INDENT APPROVED', purpose: 'reorder', approx: '2000.00' }),
    P(2, { docNo: 'PI-1-21', indentDate: '17-03-2021', indentor: 'PHARM', status: 'INDENT APPROVED', purpose: 'STOCK', approx: '0.00' }),
    P(3, { docNo: 'PI-1-20', indentDate: '24-07-2020', indentor: 'PURCHASE', status: 'INDENT APPROVED', purpose: 'REORDER', approx: '0.00' }),
  ],
  'local-purchase-order': [
    P(1, { poDate: '02-02-2024', indentDate: '', docNo: 'PO-11-24', ...K }),
    P(2, { poDate: '01-02-2024', indentDate: '', docNo: 'PO-10-24', ...K }),
    P(3, { poDate: '26-01-2024', indentDate: '', docNo: 'PO-9-24', ...K }),
    P(4, { indentNo: '006', poDate: '22-01-2024', indentDate: '', docNo: 'PO-8-24', ...K }),
    P(5, { poDate: '22-01-2024', indentDate: '', docNo: 'PO-7-24', vendorName: '', address: '' }),
    P(6, { indentNo: '005', poDate: '17-01-2024', indentDate: '17/1/2024', docNo: 'PO-6-24', ...K }),
    P(7, { poDate: '17-01-2024', indentDate: '', docNo: 'PO-5-24', vendorName: '', address: '' }),
    P(8, { indentNo: '004', poDate: '17-01-2024', indentDate: '', docNo: 'PO-4-24', ...K }),
    P(9, { indentNo: 'PI-1-24', poDate: '15-01-2024', indentDate: '15-01-2024', docNo: 'PO-3-24', vendorName: 'ADWEL PHARMACY', address: '' }),
    P(10, { indentNo: '003', poDate: '13-01-2024', indentDate: '', docNo: 'PO-2-23', ...K }),
    P(11, { indentNo: '1', poDate: '28-12-2023', indentDate: '', docNo: 'PO-1-23', ...K }),
  ],
  'pur-inv-grn': [P(1, { supInvDate: '15-01-2024', docNo: 'GRN-1-24', lpoNo: 'PO-3-24', lpoDate: '15-01-2024', vendorName: 'ADWEL PHARMACY', phoneNo: '', faxNo: '' })],
  'pur-grn-direct-invoice': [
    G(1, 'MRN-300-26', '20-10-2026', '174357', 'TABACAN LTD', '166.00'),
    G(2, 'MRN-299-26', '19-10-2026', '21436547', 'TABACAN LTD', '626.00'),
    G(3, 'MRN-298-26', '17-10-2026', '21111456', 'TABACAN LTD', '400.00'),
    G(4, 'MRN-297-26', '17-10-2026', '1212153', 'TABACAN LTD', '645.00'),
    G(5, 'MRN-296-26', '17-10-2026', '21435352', 'VICTORIA HEALTHCARE LIMITED', '1746.00'),
    G(6, 'MRN-295-26', '17-10-2026', '1325546', 'TABACAN LTD', '532.00'),
    G(7, 'MRN-294-26', '16-10-2026', '112345', 'TABACAN LTD', '500.00'),
    G(8, 'MRN-293-26', '15-10-2026', '12143643', 'TABACAN LTD', '1000.00'),
    G(9, 'MRN-292-26', '13-10-2026', '21124523', 'TABACAN LTD', '325.00'),
    G(10, 'MRN-291-26', '08-10-2026', '530087', 'VICTORIA HEALTHCARE LIMITED', '2958.00'),
    G(12, 'MRN-290-26', '07-10-2026', '12334546', 'TABACAN LTD', '1500.00'),
  ],
  medicine: [
    M(1, 'PRD00-34-26', 'COFANART SYP 60ML', 'SYRUPS', 'ML', '300.00', '120.00', '1.00'),
    M(2, 'PRD00-33-26', 'MICROMOL SYP 100ML', 'SYRUPS', 'ML', '150.00', '25.00', '1.00'),
    M(3, 'PRD00-32-26', 'SCALPEL', 'SURGICALS', '20MG', '20.00', '15.00', '100.00'),
    M(4, 'PRD00-31-25', 'OJEN OZ', 'TABS/CAPSULES', 'MG', '650.00', '340.00', '1.00'),
    M(5, 'PRD00-30-25', 'TRIDAHIST 100 MLS', 'SYRUPS', 'ML', '150.00', '45.00', '1.00'),
    M(6, 'PRD00-29-25', 'UNIVIR CREAM 10MG', 'CREAMS', 'MG', '300.00', '0.00', '1.00'),
    M(7, 'PRD00-28-25', 'HERBIGOR SYRP 100MLS', 'SYRUPS', 'MLS', '450.00', '0.00', '1.00'),
    M(8, 'PRD00-27-25', 'TRIPACOF EXP 60ML', 'SYRUPS', 'MLS', '100.00', '0.00', '1.00'),
    M(9, 'PRD00-26-25', 'PIRITON SYRP GEN 100MLS', 'SYRUPS', 'MLS', '150.00', '0.00', '1.00'),
    M(10, 'PRD00-25-25', 'ABZ ALTOA SUSP 10ML', 'SYRUPS', 'MLS', '70.00', '0.00', '1.00'),
    M(11, 'PRD00-24-25', 'ABZ NILWORM TABS', 'TABS/CAPSULES', 'MG', '50.00', '0.00', '100.00'),
  ],
}

/** True for an exact copy of a sample row seeded by old builds. */
export function isLegacyDemoDoc(slug: string, doc: { id: number; values: Record<string, string> }): boolean {
  const sample = LEGACY_DEMO[slug]?.find((s) => s.id === doc.id)
  return !!sample && JSON.stringify(sample.values) === JSON.stringify(doc.values)
}

/* ── Old kv-list storage → one record per document / task ──────────────── */
export const LEGACY_DOCS_PREFIX = 'medapp:docs:'
export const LEGACY_TASKS_KEY = 'medapp:tasks'

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Stable id for a document that lived in an old kv list. Every till and the
 * server compute the same id, so converting twice never duplicates. Ids stay
 * below 1e11, far under the till's generated ids (~4e14), so they never clash. */
export function legacyDocId(slug: string, oldId: number): number {
  return (fnv1a(slug) % 1_000_000) * 100_000 + (oldId % 100_000)
}

type OldDoc = { id: number; createdAt: number; values: Record<string, string> }

/** Records of the new `docs` table for an old `medapp:docs:<slug>` kv list (demo rows dropped). */
export function convertLegacyDocs(key: string, list: unknown): { id: number; slug: string; docNo?: string; values: Record<string, string>; createdAt: number; updatedAt: number }[] {
  const slug = key.slice(LEGACY_DOCS_PREFIX.length)
  if (!slug || !Array.isArray(list)) return []
  return (list as OldDoc[])
    .filter((d) => d && typeof d.id === 'number' && d.values && typeof d.values === 'object' && !isLegacyDemoDoc(slug, d))
    .map((d) => ({ id: legacyDocId(slug, d.id), slug, docNo: d.values.docNo || undefined, values: d.values, createdAt: Number(d.createdAt) || 0, updatedAt: Number(d.createdAt) || 0 }))
}

/** Records of the new `tasks` table for the old `medapp:tasks` kv list. Task ids were creation times: kept. */
export function convertLegacyTasks(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, unknown>[]).filter((t) => t && typeof t.id === 'number' && typeof t.text === 'string')
}
