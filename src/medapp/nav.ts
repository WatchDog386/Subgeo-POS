// Menus of the legacy medapp, word for word (including its original
// spellings such as "Isse Return", "Expiary Medicinies", "Facilty Name").

export interface MenuItem {
  slug: string
  label: string
}
export interface MenuGroup {
  label: string
  items: MenuItem[]
}

export const MODULE_GROUPS: MenuGroup[] = [
  {
    label: 'RETAIL SALES',
    items: [
      { slug: 'otc-bill', label: 'OTC Medicine Issued/Bill' },
      { slug: 'otc-return', label: 'OTC Medicine Isse Return' },
      { slug: 'service-bill', label: 'Service Request/Bill' },
    ],
  },
  {
    label: 'WHOLE SALES',
    items: [
      { slug: 'sales-quotation', label: 'Sales Quotation' },
      { slug: 'delivery-note', label: 'Delivery Note' },
      { slug: 'credit-note', label: 'Credit Note' },
      { slug: 'whole-sale-invoice', label: 'Whole Sale Invoice' },
      { slug: 'credit-note-direct', label: 'Credit Note - Direct Invoice' },
      { slug: 'final-bill-receipt', label: 'Final Bill Receipt' },
    ],
  },
  {
    label: 'PHARMACY PURCHASES',
    items: [
      { slug: 'party-master', label: 'Party Master' },
      { slug: 'services-master', label: 'Services Master' },
    ],
  },
]

export function moduleGroupOf(slug: string, groups: MenuGroup[] = MODULE_GROUPS): MenuGroup | undefined {
  return groups.find((g) => g.items.some((i) => i.slug === slug))
}

/** Modules sidebar for the purchase dashboard ("PURCHASE" login — screenshots
 * 31 Oct 2026): the purchasing steps, medicine master and petty cash. */
export const PURCHASE_MODULE_GROUPS: MenuGroup[] = [
  {
    label: 'PURCHASES',
    items: [
      { slug: 'purchase-indent', label: 'STEP 1: PURCHASE INDENT' },
      { slug: 'local-purchase-order', label: 'STEP 2: LOCAL PURCHASE ORDER' },
      { slug: 'pur-inv-grn', label: 'STEP 3: GRN- Good Recived Note' },
      { slug: 'pur-grn-direct-invoice', label: 'Pur/GRN (Direct Invoice)' },
      { slug: 'medicine', label: 'Medicine' },
      { slug: 'party-master', label: 'Party Master' },
    ],
  },
  {
    label: 'PETTY CASH ISSUE',
    items: [{ slug: 'petty-cash-voucher', label: 'Petty Cash Voucher' }],
  },
]

/** Reports tab: the "Report List" tree. */
export const REPORT_TREE: MenuItem[] = [
  { slug: 'account-statement', label: 'Account Statement' },
  { slug: 'os-debtor', label: 'OS Debtor' },
  { slug: 'os-creditor', label: 'OS Creditor' },
  { slug: 'all-debtor-ageing', label: 'All Debtor Ageing' },
  { slug: 'all-creditor-ageing', label: 'All Creditor Ageing' },
  { slug: 'cash-collection', label: 'Cash Collection DEBTORS + OTC' },
  { slug: 'expiry-medicines', label: 'Expiary Medicinies Report' },
  { slug: 'otc-medicine-issue', label: 'OTC MEDICINE ISSUE' },
]

/** Reports tab: the stack of blue buttons below the tree. */
export const REPORT_ITEMS: MenuItem[] = [
  { slug: 'month-wise', label: 'Month-Wise Analysis' },
  { slug: 'stock', label: 'Stock Report' },
  { slug: 'reorder', label: 'Stock Reorder/EOQ Analysis' },
  { slug: 'abc', label: 'ABC Analysis' },
  { slug: 'ageing', label: 'Ageing Report' },
  { slug: 'time-table', label: 'Time Table Allocation' },
  { slug: 'mis-location', label: 'MIS Location-wise' },
  { slug: 'price-comparison', label: 'Price Comparison Statement' },
  { slug: 'outstanding', label: 'Outstanding Report' },
  { slug: 'receivables', label: 'Receivables Report' },
  { slug: 'payables', label: 'Payables Report' },
  { slug: 'non-compliance', label: 'Non-Compliance Report' },
  { slug: 'annexure', label: 'Annexure  Reports' },
  { slug: 'brs', label: 'BRS Report' },
  { slug: 'audit-trail', label: 'Audit Trail Report' },
  { slug: 'exception', label: 'Exception Report' },
  { slug: 'ancillary-ledger', label: 'Ancillary party stock ledger' },
  { slug: 'policy-comparison', label: 'Policy Comparison Report' },
  { slug: 'budget', label: 'Budget  Analysis' },
]

export const UTILITY_ITEMS: MenuItem[] = [
  { slug: 'auto-generate', label: 'Auto Generate' },
  { slug: 'document-center', label: 'Document Center' },
  { slug: 'auto-indent', label: 'Auto Indent' },
  { slug: 'others', label: 'Others' },
  { slug: 'force-close', label: 'Force To Close Transaction' },
  { slug: 'regenerate-link', label: 'ReGenerate Link Transaction' },
  { slug: 'payroll', label: 'Pay Roll Automation' },
  { slug: 'export-viewdata', label: 'Export ViewData' },
  { slug: 'product-automation', label: 'Product Automation' },
  { slug: 'transaction-automation', label: 'Transaction Automation' },
  { slug: 'reconciliation', label: 'Reconciliation' },
  { slug: 'stock-update', label: 'Stock Update Automation' },
  { slug: 'ac-update', label: 'A/C Update Automation' },
  { slug: 'user-management', label: 'User Management' },
  { slug: 'data-management', label: 'Data Management' },
  { slug: 'auto-number-reset', label: 'Auto Number Reset' },
  { slug: 'sync', label: 'OffLine/OnLine Synchronization' },
  { slug: 'default-values', label: 'Default Values Management' },
  { slug: 'adjust-fields', label: 'Adjust Fields' },
  { slug: 'tree-style-mrp', label: 'Tree Style Mrp' },
  { slug: 'update-ac-bal', label: 'Update A/C Bal' },
]

/** Utilities whose sidebar button expands an (empty) white panel when active. */
export const UTILITY_EXPANDS = new Set(['document-center'])

/** Every transaction known to the Home → Quick Access grid and Set Favorites. */
export interface Transaction {
  module: string
  label: string
  role: string
  description: string
  to?: string
}

const T = (module: string, label: string, to?: string, description = ''): Transaction => ({
  module,
  label,
  role: 'Pharmacy',
  description,
  to,
})

export const TRANSACTIONS: Transaction[] = [
  T('', 'Purchase Indent', '/purchasing'),
  T('', 'Local Purchase Order', '/purchasing'),
  T('', 'Pur Inv/GRN', '/purchasing'),
  T('', 'Stock Transfers Request', '/inventory'),
  T('', 'Stock Transfer Internal', '/inventory'),
  T('', 'Stock Transfer Issue Internal', '/inventory'),
  T('', 'Medicine', '/inventory'),
  T('ACCOUNTS MASTERS', 'Party Master', '/modules/party-master'),
  T('', 'Services Master', '/modules/services-master'),
  T('', 'MOLECULAR NAME', '/inventory'),
  T('RETAIL SALES', 'OTC Medicine Issued/Bill', '/modules/otc-bill'),
  T('', 'OTC Medicine Isse Return', '/modules/otc-return'),
  T('', 'Service Request/Bill', '/modules/service-bill'),
  T('WHOLE SALES', 'Sales Quotation', '/modules/sales-quotation'),
  T('', 'Delivery Note', '/modules/delivery-note'),
  T('', 'Credit Note', '/modules/credit-note'),
  T('', 'Whole Sale Invoice', '/modules/whole-sale-invoice'),
  T('', 'Credit Note - Direct Invoice', '/modules/credit-note-direct'),
  T('', 'Final Bill Receipt', '/modules/final-bill-receipt'),
  T('BILLING', 'IP Ambulance Bill', '/service'),
  T('', 'Consolidate Bills Credit', '/customers'),
  T('', 'Consult', '/service'),
  T('', 'Medicine Issue Note', '/sell'),
  T('', 'Medicine Returns', '/sales'),
  T('', 'Miscellanious', '/sell'),
  T('STORES', 'Movie Issue', '/inventory'),
  T('', 'Movie Request', '/purchasing'),
  T('', 'Movie Issue...', '/inventory'),
  T('', 'Movie Return...', '/inventory'),
  T('', 'Stock Entry (Opening)', '/inventory'),
  T('', 'Stock Adjust -', '/inventory'),
  T('ACCOUNTS', 'Receipt Voucher', '/customers'),
  T('', 'Payment Voucher', '/purchasing'),
  T('', 'Cash In / Out', '/shift'),
  T('', 'Day Shift Open/Close', '/shift'),
  T('ADMINISTRATION', 'User Management', '/utilities/user-management'),
  T('', 'Audit Logs', '/logs'),
  T('', 'Settings', '/settings'),
  T('', 'Notifications', '/notifications'),
  T('', 'Messages', '/messages'),
]

export function transactionTo(label: string): string | undefined {
  return TRANSACTIONS.find((t) => t.label === label)?.to
}
