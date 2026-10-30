// Admin-only menu data (legacy EMR-Lite 9.5.21 admin screenshots in
// public/pos). The cashier data in nav.ts is shared and must not change.
import type { MenuGroup, MenuItem, Transaction } from './nav'
import { REPORT_ITEMS, UTILITY_ITEMS } from './nav'

export const ADMIN_MODULE_GROUPS: MenuGroup[] = [
  {
    label: 'RETAIL SALES',
    items: [
      { slug: 'otc-bill', label: 'OTC Medicine Issue/Bill' },
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
      { slug: 'supplier-payment', label: 'Supplier Payment' },
    ],
  },
  {
    label: 'PARTY MASTER',
    items: [{ slug: 'party-master', label: 'Party Master' }],
  },
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
]

export function adminModuleGroupOf(slug: string): MenuGroup | undefined {
  return ADMIN_MODULE_GROUPS.find((g) => g.items.some((i) => i.slug === slug))
}

/** Reports tab tree (screenshot 14.47.15 (1)). */
export const ADMIN_REPORT_TREE: MenuItem[] = [
  { slug: 'account-statement', label: 'Account Statement' },
  { slug: 'os-debtor', label: 'OS Debtor' },
  { slug: 'os-creditor', label: 'OS Creditor' },
  { slug: 'all-debtor-ageing', label: 'All Debtor Ageing' },
  { slug: 'all-creditor-ageing', label: 'All Creditor Ageing' },
  { slug: 'daily-sales', label: 'Daily Sales Report' },
  { slug: 'cash-collection', label: 'Cash Collection DEBTORS + OTC' },
  { slug: 'medicine-list', label: 'MEDICINE LIST' },
  { slug: 'expiry-medicines', label: 'Expiary Medicines Report' },
  { slug: 'otc-medicine-issue', label: 'OTC MEDICINE ISSUE' },
]

/** Blue report buttons below the tree are identical to the cashier. */
export const ADMIN_REPORT_ITEMS: MenuItem[] = REPORT_ITEMS

/** Utilities sidebar: cashier list + the three admin-only screens appended. */
export const ADMIN_UTILITY_ITEMS: MenuItem[] = [
  ...UTILITY_ITEMS,
  { slug: 'role-wise-transaction-process', label: 'Role Wise Transaction Process' },
  { slug: 'tally-to-n360i', label: 'Tally to N360i' },
  { slug: 'db-utility', label: 'DB Utility' },
]

const A = (module: string, label: string, to?: string, description = ''): Transaction => ({
  module,
  label,
  role: 'Admin',
  description,
  to,
})

/** Quick Access rows in the admin home (role column shows Admin). */
export const ADMIN_TRANSACTIONS: Transaction[] = [
  A('', 'Purchase Indent', '/purchasing'),
  A('', 'Local Purchase Order', '/purchasing'),
  A('', 'Pur Inv/GRN', '/purchasing'),
  A('', 'Stock Transfers Request', '/inventory'),
  A('', 'Stock Transfer Internal', '/inventory'),
  A('', 'Stock Transfer Issue Internal', '/inventory'),
  A('', 'Medicine', '/inventory'),
  A('ACCOUNTS MASTERS', 'Party Master', '/modules/party-master'),
  A('', 'Services Master', '/modules/services-master'),
  A('', 'MOLECULAR NAME', '/inventory'),
  A('RETAIL SALES', 'OTC Medicine Issue/Bill', '/modules/otc-bill'),
  A('', 'OTC Medicine Isse Return', '/modules/otc-return'),
  A('', 'Service Request/Bill', '/modules/service-bill'),
  A('WHOLE SALES', 'Sales Quotation', '/modules/sales-quotation'),
  A('', 'Delivery Note', '/modules/delivery-note'),
  A('', 'Credit Note', '/modules/credit-note'),
  A('', 'Whole Sale Invoice', '/modules/whole-sale-invoice'),
  A('', 'Credit Note - Direct Invoice', '/modules/credit-note-direct'),
  A('', 'Final Bill Receipt', '/modules/final-bill-receipt'),
  A('', 'Supplier Payment', '/modules/supplier-payment'),
  A('BILLING', 'IP Ambulance Bill', '/service'),
  A('', 'Consolidate Bills Credit', '/customers'),
  A('', 'Consult', '/service'),
  A('', 'Medicine Issue Note', '/sell'),
  A('', 'Medicine Returns', '/sales'),
  A('', 'Miscellanious', '/sell'),
  A('STORES', 'Movie Issue', '/inventory'),
  A('', 'Movie Request', '/purchasing'),
  A('', 'Movie Issue...', '/inventory'),
  A('', 'Movie Return...', '/inventory'),
  A('', 'Stock Entry (Opening)', '/inventory'),
  A('', 'Stock Adjust -', '/inventory'),
  A('ACCOUNTS', 'Receipt Voucher', '/customers'),
  A('', 'Payment Voucher', '/purchasing'),
  A('', 'Cash In / Out', '/shift'),
  A('', 'Day Shift Open/Close', '/shift'),
  A('ADMINISTRATION', 'User Management', '/utilities/user-management'),
  A('', 'Audit Logs', '/logs'),
  A('', 'Settings', '/settings'),
  A('', 'Notifications', '/notifications'),
  A('', 'Messages', '/messages'),
]

/** Set Favorites left catalogue (screenshot 14.40.06 (11)). */
export const ADMIN_FAVOURITE_CATALOGUE: string[] = [
  'Lab Bill',
  'Mode of Adjustment',
  'Lions Admission Notes',
  'Adult/Child',
  'Age In',
  'Allergies',
  'Allocation Of Vehicle',
  'Allocation Of Vehicle',
  'Ambulance Service',
  'IP Ambulance Bill',
  'Asset Master',
]

/** Admin home Reports section links (screenshot 14.55.52 (5)). */
export const ADMIN_HOME_REPORT_LINKS: string[] = [
  'Account Statement',
  'OS Debtor',
  'OS Creditor',
  'All Debtor Ageing',
  'All Creditor Ageing',
  'Daily Sales Report',
  'Cash Collection DEBTORS + OTC',
  'MEDICINE LIST',
  'Expiary Medicinies Report',
  'OTC MEDICINE ISSUE',
]

/** Admin home Charts section links. */
export const ADMIN_HOME_CHART_LINKS: string[] = [
  'OP VISIT REGISTER_DOCTOR',
  'OP VISIT REGISTER_DEPARTMENT',
  'LAB TEST',
  'SERVICE CHART',
  'MEDICINE COMPARISON',
  'MEDICINE GROUP',
  'MEDICINE PURCHASE',
]
