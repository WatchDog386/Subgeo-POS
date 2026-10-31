// Keeps the relational tables (migrations/004_relational.sql) in step with
// sync_records. sync_records stays the source of truth for the tills; these
// tables are the same data with real columns and foreign keys, for reports,
// exports and anyone querying the database with SQL.
//
//   project(tbl, scope, id, data)   one record changed (data null = deleted)
//   rebuildRelational()             wipe and rebuild everything from sync_records
import { sql } from './db'
import { GLOBAL_TABLES, BRANCH_TABLES } from '../src/db/syncSchema'
import { chemCode } from '../src/db/seedData'

type Rec = Record<string, unknown>

/** Bump when the projection changes: the server rebuilds the tables on boot. */
export const RELATIONAL_VERSION = 2

const int = (v: unknown, d: number | null = null): number | null => {
  const n = Number(v)
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? d : Math.round(n)
}
const num = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v))
const bool = (v: unknown, d = true): number => (v === undefined || v === null ? (d ? 1 : 0) : v ? 1 : 0)
const lines = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]).filter((x) => x && typeof x === 'object') : [])

/** Id of a parent row if it exists (else NULL, so a missing parent never blocks a write). */
const existsCache = new Map<string, ReturnType<typeof sql.prepare>>()
function ref(table: string, id: unknown): number | null {
  const n = int(id)
  if (n === null) return null
  let q = existsCache.get(table)
  if (!q) {
    q = sql.prepare(`SELECT id FROM ${table} WHERE id = ?`)
    existsCache.set(table, q)
  }
  return q.get(n) ? n : null
}
const branchExists = (scope: number) => ref('branches', scope) !== null

/** Upsert keeping the row (never INSERT OR REPLACE: that deletes and cascades to the children). */
function upsert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row)
  const set = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`)
  sql
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')}) ON CONFLICT(id) DO UPDATE SET ${set.join(', ')}`)
    .run(row)
}
function replaceChildren(table: string, fk: string, parentId: number, rows: Record<string, unknown>[]) {
  sql.prepare(`DELETE FROM ${table} WHERE ${fk} = ?`).run(parentId)
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const ins = sql.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
  for (const r of rows) ins.run(r)
}
const remove = (table: string, id: number) => sql.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)

/** Money typed on a document ("1,746.00") → cents. */
function cents(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const DOC_DATE_KEYS = ['mrnDate', 'indentDate', 'poDate', 'supInvDate', 'vchDate', 'voucherDate', 'date', 'docDate', 'invoiceDate']
const DOC_PARTY_KEYS = ['vendorName', 'supplierName', 'customerName', 'customer', 'partyName', 'party']
const DOC_AMOUNT_KEYS = ['total', 'amount', 'approx', 'value']
const DOC_REF_KEYS = ['indentNo', 'lpoNo', 'quoteNo', 'dnNo', 'refNo']
const first = (v: Record<string, string>, keys: string[]) => {
  for (const k of keys) if (v[k] !== undefined && String(v[k]).trim() !== '') return String(v[k]).trim()
  return null
}

const byName = (table: 'suppliers' | 'customers', name: string | null, scope?: number): number | null => {
  if (!name) return null
  const row = (table === 'suppliers'
    ? sql.prepare('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE LIMIT 1').get(name)
    : sql.prepare('SELECT id FROM customers WHERE branch_id = ? AND name = ? COLLATE NOCASE LIMIT 1').get(scope, name)) as { id: number } | undefined
  return row?.id ?? null
}

/* ── One table each ───────────────────────────────────────────────────────── */
const PROJECTORS: Record<string, (id: number, d: Rec, scope: number) => void> = {
  branches: (id, d) =>
    upsert('branches', {
      id,
      number: int(d.number, 0),
      code: chemCode(int(d.number, 0) ?? 0),
      name: str(d.name) ?? chemCode(int(d.number, 0) ?? 0),
      location: str(d.location),
      phone: str(d.phone),
      active: bool(d.active),
      created_at: int(d.createdAt, 0),
    }),
  users: (id, d) =>
    upsert('users', {
      id,
      username: str(d.username) ?? `user${id}`,
      name: str(d.name) ?? '',
      role: str(d.role) ?? 'cashier',
      branch_id: d.role === 'owner' ? null : ref('branches', d.branchId),
      active: bool(d.active) && (d.role === 'owner' || ref('branches', d.branchId) !== null) ? 1 : 0,
      email: str(d.email),
      phone: str(d.phone),
    }),
  categories: (id, d) => upsert('categories', { id, name: str(d.name) ?? '', color: str(d.color) }),
  suppliers: (id, d) => upsert('suppliers', { id, name: str(d.name) ?? '', phone: str(d.phone), email: str(d.email), notes: str(d.notes) }),
  messages: (id, d) => {
    upsert('staff_messages', {
      id,
      from_id: ref('users', d.fromId),
      from_name: str(d.fromName) ?? '',
      to_id: ref('users', d.toId),
      to_name: str(d.toName) ?? 'EVERYONE',
      subject: str(d.subject) ?? '',
      body: str(d.body) ?? '',
      at: int(d.at, 0),
    })
    replaceChildren(
      'staff_message_reads',
      'message_id',
      id,
      [...new Set(Array.isArray(d.readBy) ? (d.readBy as unknown[]).map((u) => ref('users', u)).filter((u): u is number => u !== null) : [])].map((u) => ({ message_id: id, user_id: u })),
    )
  },
  products: (id, d, scope) =>
    upsert('products', {
      id,
      branch_id: scope,
      sku: str(d.sku) ?? '',
      barcode: str(d.barcode),
      name: str(d.name) ?? '',
      category_id: ref('categories', d.categoryId),
      supplier_id: ref('suppliers', d.supplierId),
      brand: str(d.brand),
      part_number: str(d.partNumber),
      shelf: str(d.location),
      cost: int(d.cost, 0),
      price: int(d.price, 0),
      stock: int(d.stock, 0),
      reorder_level: int(d.reorderLevel, 0),
      taxable: bool(d.taxable),
      serialized: bool(d.serialized, false),
      track_stock: bool(d.trackStock),
      active: bool(d.active),
      created_at: int(d.createdAt, 0),
      updated_at: int(d.updatedAt, 0),
    }),
  customers: (id, d, scope) =>
    upsert('customers', {
      id,
      branch_id: scope,
      name: str(d.name) ?? '',
      phone: str(d.phone),
      email: str(d.email),
      balance: int(d.balance, 0),
      credit_limit: int(d.creditLimit, 0),
      notes: str(d.notes),
      created_at: int(d.createdAt, 0),
    }),
  shifts: (id, d, scope) => {
    upsert('shifts', {
      id,
      branch_id: scope,
      user_id: ref('users', d.userId),
      opened_at: int(d.openedAt, 0),
      closed_at: int(d.closedAt),
      opening_float: int(d.openingFloat, 0),
      counted_cash: int(d.countedCash),
      expected_cash: int(d.expectedCash),
      notes: str(d.notes),
    })
    replaceChildren(
      'shift_cash_movements',
      'shift_id',
      id,
      lines(d.cashMovements)
        .filter((m) => m.type === 'in' || m.type === 'out')
        .map((m, i) => ({ shift_id: id, line_no: i + 1, type: m.type, amount: int(m.amount, 0), reason: str(m.reason), at: int(m.at, 0) })),
    )
  },
  sales: (id, d, scope) => {
    upsert('sales', {
      id,
      branch_id: scope,
      receipt_no: str(d.receiptNo) ?? String(id),
      created_at: int(d.createdAt, 0),
      customer_id: ref('customers', d.customerId),
      user_id: ref('users', d.userId),
      shift_id: ref('shifts', d.shiftId),
      status: ['completed', 'refunded', 'partially_refunded', 'voided'].includes(String(d.status)) ? d.status : 'completed',
      subtotal: int(d.subtotal, 0),
      discount: int(d.discount, 0),
      tax: int(d.tax, 0),
      total: int(d.total, 0),
      change_given: int(d.change, 0),
      refund_of: int(d.refundOf) === id ? null : ref('sales', d.refundOf),
      branch_label: str(d.branch),
      note: str(d.note),
    })
    replaceChildren(
      'sale_lines',
      'sale_id',
      id,
      lines(d.lines).map((l, i) => ({
        sale_id: id,
        line_no: i + 1,
        product_id: ref('products', l.productId),
        name: str(l.name) ?? '',
        sku: str(l.sku),
        qty: num(l.qty),
        unit_price: int(l.unitPrice, 0),
        unit_cost: int(l.unitCost, 0),
        discount: int(l.discount, 0),
        taxable: bool(l.taxable),
        serial: str(l.serial),
        refunded_qty: num(l.refundedQty),
        form: str(l.form),
        instruction: str(l.instruction),
        batch: str(l.batch),
        expiry: str(l.expiry),
      })),
    )
    replaceChildren(
      'sale_payments',
      'sale_id',
      id,
      lines(d.payments)
        .filter((p) => ['cash', 'mpesa', 'card', 'cheque', 'account'].includes(String(p.method)))
        .map((p, i) => ({ sale_id: id, line_no: i + 1, method: p.method, amount: int(p.amount, 0), reference: str(p.reference) })),
    )
  },
  parked: (id, d, scope) => {
    upsert('parked_sales', {
      id,
      branch_id: scope,
      label: str(d.label),
      created_at: int(d.createdAt, 0),
      discount: int(d.discount, 0),
      customer_id: ref('customers', d.customerId),
      user_id: ref('users', d.userId),
    })
    replaceChildren(
      'parked_sale_lines',
      'parked_id',
      id,
      lines(d.lines).map((l, i) => ({ parked_id: id, line_no: i + 1, product_id: ref('products', l.productId), name: str(l.name) ?? '', qty: num(l.qty), unit_price: int(l.unitPrice, 0), discount: int(l.discount, 0) })),
    )
  },
  movements: (id, d, scope) =>
    upsert('stock_movements', {
      id,
      branch_id: scope,
      product_id: ref('products', d.productId),
      change: int(d.change, 0),
      reason: ['sale', 'refund', 'receive', 'adjust', 'damage', 'count', 'transfer'].includes(String(d.reason)) ? d.reason : 'adjust',
      reference: str(d.reference),
      note: str(d.note),
      user_id: ref('users', d.userId),
      at: int(d.at, 0),
    }),
  purchaseOrders: (id, d, scope) => {
    upsert('purchase_orders', {
      id,
      branch_id: scope,
      po_no: str(d.poNo) ?? String(id),
      supplier_id: ref('suppliers', d.supplierId),
      status: ['draft', 'ordered', 'partial', 'received', 'cancelled'].includes(String(d.status)) ? d.status : 'draft',
      notes: str(d.notes),
      created_at: int(d.createdAt, 0),
      updated_at: int(d.updatedAt, 0),
    })
    replaceChildren(
      'purchase_order_lines',
      'po_id',
      id,
      lines(d.lines).map((l, i) => ({ po_id: id, line_no: i + 1, product_id: ref('products', l.productId), qty: int(l.qty, 0), unit_cost: int(l.unitCost, 0), received: int(l.received, 0) })),
    )
  },
  jobs: (id, d, scope) => {
    upsert('service_jobs', {
      id,
      branch_id: scope,
      job_no: str(d.jobNo) ?? String(id),
      customer_id: ref('customers', d.customerId),
      customer_name: str(d.customerName) ?? '',
      phone: str(d.phone),
      complaint: str(d.complaint),
      labour: int(d.labour, 0),
      status: ['open', 'in_progress', 'waiting_parts', 'ready', 'collected'].includes(String(d.status)) ? d.status : 'open',
      attendant: str(d.mechanic),
      sale_id: ref('sales', d.saleId),
      created_at: int(d.createdAt, 0),
      updated_at: int(d.updatedAt, 0),
    })
    replaceChildren(
      'service_job_lines',
      'job_id',
      id,
      lines(d.lines).map((l, i) => ({ job_id: id, line_no: i + 1, product_id: ref('products', l.productId), name: str(l.name) ?? '', qty: num(l.qty), unit_price: int(l.unitPrice, 0), discount: int(l.discount, 0) })),
    )
  },
  logs: (id, d, scope) =>
    upsert('activity_logs', {
      id,
      branch_id: scope,
      at: int(d.at, 0),
      kind: str(d.kind) ?? 'system',
      action: str(d.action) ?? '',
      detail: str(d.detail),
      user_id: ref('users', d.userId),
      user_name: str(d.userName),
    }),
  docs: (id, d, scope) => {
    const values = (d.values && typeof d.values === 'object' ? d.values : {}) as Record<string, string>
    const { attachment, attachmentName: _n, ...plain } = values
    const party = first(values, DOC_PARTY_KEYS)
    upsert('documents', {
      id,
      branch_id: scope,
      doc_type: str(d.slug) ?? 'unknown',
      doc_no: str(d.docNo) ?? str(values.docNo),
      doc_date: first(values, DOC_DATE_KEYS),
      party_name: party ? party.toUpperCase() : null,
      supplier_id: byName('suppliers', party),
      customer_id: byName('customers', party, scope),
      amount: cents(first(values, DOC_AMOUNT_KEYS)),
      status: str(values.status),
      ref_doc_no: first(values, DOC_REF_KEYS),
      has_attachment: attachment ? 1 : 0,
      values_json: JSON.stringify(plain),
      created_by: ref('users', d.createdBy),
      created_at: int(d.createdAt, 0),
      updated_at: int(d.updatedAt, int(d.createdAt, 0)),
    })
    replaceChildren(
      'document_lines',
      'document_id',
      id,
      lines(d.lines).map((l, i) => ({
        document_id: id,
        line_no: i + 1,
        product_id: ref('products', l.productId),
        name: str(l.name) ?? '',
        sku: str(l.sku),
        qty: num(l.qty),
        cost: int(l.cost, 0),
        rate: int(l.rate, 0),
        vat_pct: num(l.vatPct),
        vat: int(l.vat, 0),
        discount: int(l.discount, 0),
        total: int(l.total, 0),
        batch: str(l.batch),
        expiry: str(l.expiry),
        src_doc_type: str(l.srcSlug),
        src_doc_no: str(l.srcDocNo),
        src_line: int(l.srcLine),
      })),
    )
  },
  tasks: (id, d, scope) =>
    upsert('staff_tasks', {
      id,
      branch_id: scope,
      text: str(d.text) ?? '',
      doc_ref: str(d.doc),
      due_at: int(d.due),
      assigner_id: ref('users', d.assignerId),
      assigner_name: str(d.assigner),
      assignee_id: ref('users', d.assigneeId),
      assignee_name: str(d.assignee),
      status: d.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      created_at: int(d.createdAt, 0),
      completed_at: int(d.completedAt),
      completed_by: str(d.completedBy),
    }),
}

const TARGET: Record<string, string> = {
  branches: 'branches',
  users: 'users',
  categories: 'categories',
  suppliers: 'suppliers',
  messages: 'staff_messages',
  products: 'products',
  customers: 'customers',
  shifts: 'shifts',
  sales: 'sales',
  parked: 'parked_sales',
  movements: 'stock_movements',
  purchaseOrders: 'purchase_orders',
  jobs: 'service_jobs',
  logs: 'activity_logs',
  docs: 'documents',
  tasks: 'staff_tasks',
}

let failures = 0
/** Projection errors since boot (shown by npm run db:status). */
export const projectionFailures = () => failures

/**
 * Mirror one sync record. Never throws: a record the relational tables can't
 * take (e.g. its chemist is unknown) is skipped and stays safe in sync_records.
 */
export function project(tbl: string, scope: number, id: string, data: Rec | null): void {
  try {
    sql.transaction(() => {
      if (tbl === 'kv') {
        const branch = scope === 0 ? null : scope
        if (scope !== 0 && !branchExists(scope)) return
        sql.prepare('DELETE FROM app_values WHERE IFNULL(branch_id, 0) = ? AND key = ?').run(scope, id)
        if (data) sql.prepare('INSERT INTO app_values (branch_id, key, value_json) VALUES (?, ?, ?)').run(branch, id, JSON.stringify(data.value ?? null))
        return
      }
      const target = TARGET[tbl]
      const fn = PROJECTORS[tbl]
      const n = int(id)
      if (!target || !fn || n === null) return
      if (!data) {
        remove(target, n)
        return
      }
      if (scope !== 0 && !branchExists(scope)) return
      fn(n, data, scope)
    })()
  } catch (e) {
    failures++
    console.warn(`relational: ${tbl}/${scope}/${id} skipped — ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Every relational table, children first (the order to empty them in). */
const CLEAR_ORDER = [
  'app_values',
  'staff_tasks',
  'document_lines',
  'documents',
  'activity_logs',
  'service_job_lines',
  'service_jobs',
  'purchase_order_lines',
  'purchase_orders',
  'stock_movements',
  'parked_sale_lines',
  'parked_sales',
  'sale_payments',
  'sale_lines',
  'sales',
  'shift_cash_movements',
  'shifts',
  'customers',
  'products',
  'staff_message_reads',
  'staff_messages',
  'suppliers',
  'categories',
  'users',
  'branches',
]

/** Wipe the relational tables and rebuild them from sync_records. Returns rows projected. */
export function rebuildRelational(): number {
  let n = 0
  sql.transaction(() => {
    for (const t of CLEAR_ORDER) sql.prepare(`DELETE FROM ${t}`).run()
    const rows = sql.prepare('SELECT tbl, scope, id, data FROM sync_records WHERE deleted = 0 AND tbl = ? ORDER BY scope, seq')
    // Parents before children, so references resolve.
    for (const tbl of [...GLOBAL_TABLES, ...BRANCH_TABLES, 'kv']) {
      for (const r of rows.all(tbl) as { tbl: string; scope: number; id: string; data: string }[]) {
        project(r.tbl, r.scope, r.id, JSON.parse(r.data) as Rec)
        n++
      }
    }
    // A sale refunding a later-synced sale, or similar forward references: link them now.
    for (const r of rows.all('sales') as { scope: number; id: string; data: string }[]) {
      const d = JSON.parse(r.data) as Rec
      if (d.refundOf !== undefined) sql.prepare('UPDATE sales SET refund_of = ? WHERE id = ?').run(ref('sales', d.refundOf), int(r.id))
    }
    sql.prepare("INSERT INTO sync_meta (k, v) VALUES ('relational_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(RELATIONAL_VERSION)
  })()
  return n
}

/** Rebuild when the tables are new or the projection changed. Called on boot. */
export function ensureRelational(): void {
  const row = sql.prepare("SELECT v FROM sync_meta WHERE k = 'relational_version'").get() as { v: number } | undefined
  if (row?.v !== RELATIONAL_VERSION) rebuildRelational()
}
