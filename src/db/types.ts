// All money values are stored as integer cents (KES x 100) to avoid float drift.

export type Role = 'owner' | 'manager' | 'cashier' | 'purchase'

/** A chemist (pharmacy branch). Shown as CHEM<number>, e.g. CHEM1. */
export interface Branch {
  id?: number
  /** Chemist number, unique: 1 → CHEM1. */
  number: number
  name: string
  location?: string
  phone?: string
  active: boolean
  createdAt: number
}

export interface User {
  id?: number
  /** Display name (shown in the header). */
  name: string
  /** Sign-in name, unique, stored lower-case. */
  username: string
  /** sha256("<salt>:<password>") — see src/lib/sha256.ts. */
  passHash: string
  salt: string
  role: Role
  active: boolean
  /** Chemist the user works in. Required for cashiers and managers; the owner (admin) has none and sees every chemist. */
  branchId?: number
  /** Optional profile details shown on the Profile page. */
  email?: string
  phone?: string
  about?: string
  /** Optional profile photo, stored as a data URL. */
  image?: string
}

export interface Category {
  id?: number
  name: string
  color: string
}

export interface Supplier {
  id?: number
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface Product {
  id?: number
  sku: string
  barcode?: string
  name: string
  categoryId?: number
  brand?: string
  /** Manufacturer / OEM part number, used when matching a customer's old part. */
  partNumber?: string
  /** Bike models this part fits, e.g. "Ekon 450". Empty = universal. */
  fitment: string[]
  cost: number
  price: number
  stock: number
  reorderLevel: number
  supplierId?: number
  /** Shelf / bin location in the store room. */
  location?: string
  /** Optional product photo, stored as a data URL. */
  image?: string
  taxable: boolean
  /** Serial-tracked items (batteries, controllers, motors) ask for a serial at sale time. */
  serialized: boolean
  /** Labour and services don't carry stock. */
  trackStock: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface Customer {
  id?: number
  name: string
  phone?: string
  email?: string
  bikeModel?: string
  plate?: string
  /** Amount the customer owes the shop (on-account / credit sales). */
  balance: number
  creditLimit: number
  notes?: string
  createdAt: number
}

export type PaymentMethod = 'cash' | 'mpesa' | 'card' | 'cheque' | 'account'

export interface Payment {
  method: PaymentMethod
  amount: number
  /** M-Pesa confirmation code, card approval code, etc. */
  reference?: string
}

export interface SaleLine {
  productId?: number
  /** Free-text lines (labour, misc) have no productId. */
  name: string
  sku?: string
  qty: number
  unitPrice: number
  unitCost: number
  /** Discount applied to the whole line, in cents. */
  discount: number
  taxable: boolean
  serial?: string
  refundedQty?: number
  /** Pharmacy details typed on the OTC bill: dosage form, how to take it, batch and expiry. */
  form?: string
  instruction?: string
  batch?: string
  expiry?: string
}

export type SaleStatus = 'completed' | 'refunded' | 'partially_refunded' | 'voided'

export interface Sale {
  id?: number
  receiptNo: string
  createdAt: number
  lines: SaleLine[]
  subtotal: number
  /** Cart-level discount, applied after line discounts. */
  discount: number
  tax: number
  total: number
  payments: Payment[]
  change: number
  customerId?: number
  userId: number
  shiftId?: number
  status: SaleStatus
  note?: string
  /** For refund records: the receipt being refunded. */
  refundOf?: number
  /** Chemist that issued it, as printed on the receipt, e.g. "CHEM2 - SCL KAYOLE". */
  branch?: string
}

export interface ParkedSale {
  id?: number
  label: string
  createdAt: number
  lines: SaleLine[]
  discount: number
  customerId?: number
  userId: number
}

/** transfer: stock moved between chemists by the admin. */
export type MovementReason = 'sale' | 'refund' | 'receive' | 'adjust' | 'damage' | 'count' | 'transfer'

export interface StockMovement {
  id?: number
  productId: number
  change: number
  reason: MovementReason
  reference?: string
  note?: string
  userId?: number
  at: number
}

export interface PurchaseOrderLine {
  productId: number
  qty: number
  unitCost: number
  received: number
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id?: number
  poNo: string
  supplierId?: number
  lines: PurchaseOrderLine[]
  status: PurchaseOrderStatus
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface CashMovement {
  type: 'in' | 'out'
  amount: number
  reason: string
  at: number
}

export interface Shift {
  id?: number
  userId: number
  openedAt: number
  closedAt?: number
  openingFloat: number
  cashMovements: CashMovement[]
  /** Filled in when the shift is closed. */
  countedCash?: number
  expectedCash?: number
  notes?: string
}

export type JobStatus = 'open' | 'in_progress' | 'waiting_parts' | 'ready' | 'collected'

export interface ServiceJob {
  id?: number
  jobNo: string
  customerId?: number
  customerName: string
  phone?: string
  bikeModel?: string
  plate?: string
  complaint: string
  lines: SaleLine[]
  labour: number
  status: JobStatus
  mechanic?: string
  createdAt: number
  updatedAt: number
  saleId?: number
}

export interface Settings {
  shopName: string
  address: string
  phone: string
  kraPin: string
  vatRate: number
  pricesIncludeVat: boolean
  receiptFooter: string
  currency: string
  mpesaTill: string
  apiUrl: string
  dosageForms: string[]
  paperWidth: 58 | 80
  autoPrint: boolean
  openDrawerOnCash: boolean
  /** Payment methods shown in the checkout tender list. At least one must stay enabled. */
  enabledPayments: PaymentMethod[]
  /** Which alert groups the Notifications page shows. */
  notifyLowStock: boolean
  notifyOwing: boolean
  notifyJobUpdates: boolean
}

export type LogKind = 'auth' | 'sale' | 'stock' | 'shift' | 'settings' | 'user' | 'system'

export interface LogEntry {
  id?: number
  at: number
  kind: LogKind
  action: string
  detail?: string
  userId?: number
  userName?: string
}

/** A document of a medapp transaction screen (purchase indent, LPO, GRN,
 * direct invoice, petty cash voucher, quotation, medicine master entry…).
 * One record per document, so two tills saving at the same time never
 * overwrite each other. */
export interface DocRecord {
  id: number
  /** Transaction screen it belongs to, e.g. "purchase-indent". */
  slug: string
  /** Running document number, e.g. "PI-3-26" (copied from values.docNo). */
  docNo?: string
  /** The screen's fields, keyed by field name, as typed (dates dd-mm-yyyy, money 0.00). */
  values: Record<string, string>
  /** Product lines (quotations, delivery notes, invoices, credit notes). */
  lines?: DocLine[]
  createdAt: number
  updatedAt?: number
  createdBy?: number
}

/** One product line of a whole-sale document. Money in cents. */
export interface DocLine {
  productId?: number
  name: string
  sku?: string
  qty: number
  cost: number
  rate: number
  vatPct: number
  vat: number
  discount: number
  total: number
  batch?: string
  expiry?: string
  /** The document this line was adjusted from (ADJUST …): its screen, number and line index. */
  srcSlug?: string
  srcDocNo?: string
  srcLine?: number
}

/** A task the admin (or anyone) assigns to staff of a chemist (Home → To-Do List). */
export interface StaffTask {
  id: number
  text: string
  doc?: string
  createdAt: number
  due?: number
  assignerId?: number
  assigner: string
  /** Undefined = anyone at the chemist. */
  assigneeId?: number
  assignee: string
  status: 'PENDING' | 'COMPLETED'
  completedAt?: number
  completedBy?: string
}

/** Internal message between staff (company-wide, every chemist). */
export interface StaffMessage {
  id?: number
  fromId: number
  fromName: string
  /** Undefined = every member of staff. */
  toId?: number
  toName: string
  subject: string
  body: string
  at: number
  /** Users who opened it. */
  readBy: number[]
}
