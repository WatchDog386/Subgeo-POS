// Navigation definitions for the ERP-style shell, mirroring the old medapp
// menus (RETAIL SALES / WHOLE SALES / PHARMACY PURCHASES, Reports list,
// Utilities list). Each entry points to a route inside the app.

export interface ErpLink {
  label: string
  to: string
  perm?: string
}

export interface ErpMenuGroup {
  label: string
  items: ErpLink[]
}

export const MODULE_GROUPS: ErpMenuGroup[] = [
  {
    label: 'RETAIL SALES',
    items: [
      { label: 'OTC Medicine Issued/Bill', to: '/sell' },
      { label: 'OTC Medicine Issue Return', to: '/sales' },
      { label: 'Service Request/Bill', to: '/service' },
    ],
  },
  {
    label: 'WHOLE SALES',
    items: [
      { label: 'Sales Quotation', to: '/sales' },
      { label: 'Delivery Note', to: '/sales' },
      { label: 'Credit Note', to: '/sales' },
      { label: 'Whole Sale Invoice', to: '/sales' },
      { label: 'Credit Note - Direct Invoice', to: '/sales' },
      { label: 'Final Bill Receipt', to: '/sales' },
    ],
  },
  {
    label: 'PHARMACY PURCHASES',
    items: [
      { label: 'Party Master', to: '/customers' },
      { label: 'Services Master', to: '/products' },
      { label: 'Local Purchase Order / GRN', to: '/purchasing', perm: 'purchasing' },
    ],
  },
]

export const HOME_GROUPS: ErpMenuGroup[] = [
  {
    label: 'DAILY',
    items: [
      { label: 'To-Do / Quick Access', to: '/home' },
      { label: 'OTC Medicine Issued/Bill', to: '/sell' },
      { label: 'Sales Register', to: '/sales' },
      { label: 'Open / Close Shift', to: '/shift' },
    ],
  },
  {
    label: 'SHOP MASTERS',
    items: [
      { label: 'Party Master', to: '/customers' },
      { label: 'Medicines & Services', to: '/products' },
      { label: 'Stock / Bin', to: '/inventory', perm: 'inventory' },
      { label: 'Purchase Orders', to: '/purchasing', perm: 'purchasing' },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'User Management', to: '/staff', perm: 'users' },
      { label: 'Notifications', to: '/notifications' },
      { label: 'Settings', to: '/settings', perm: 'settings' },
      { label: 'Audit Logs', to: '/logs', perm: 'logs' },
      { label: 'My Profile', to: '/profile' },
    ],
  },
]

export const FAVOURITES: ErpLink[] = [
  { label: 'New Sale (OTC Bill)', to: '/sell' },
  { label: 'Sales Register', to: '/sales' },
  { label: 'Medicines & Services', to: '/products' },
  { label: 'Party Master', to: '/customers' },
  { label: 'Stock Report', to: '/reports/stock' },
  { label: 'Receivables', to: '/reports/receivables' },
]

export const REPORT_ITEMS: ErpLink[] = [
  { label: 'Report List', to: '/reports/list' },
  { label: 'Month-Wise Analysis', to: '/reports/month-wise' },
  { label: 'Stock Report', to: '/reports/stock' },
  { label: 'Stock Reorder/EOQ Analysis', to: '/reports/reorder' },
  { label: 'ABC Analysis', to: '/reports/abc' },
  { label: 'Ageing Report', to: '/reports/ageing' },
  { label: 'MIS Location-wise', to: '/reports/location-wise' },
  { label: 'Price Comparison Statement', to: '/reports/price-comparison' },
  { label: 'Outstanding Report', to: '/reports/outstanding' },
  { label: 'Receivables Report', to: '/reports/receivables' },
  { label: 'Payables Report', to: '/reports/payables' },
  { label: 'Non-Compliance Report', to: '/reports/non-compliance' },
  { label: 'BRS Report', to: '/reports/brs' },
  { label: 'Audit Trail Report', to: '/reports/audit-trail' },
  { label: 'Exception Report', to: '/reports/exception' },
  { label: 'Ancillary Party Stock Ledger', to: '/reports/party-ledger' },
  { label: 'Budget Analysis', to: '/reports/budget' },
]

export const UTILITY_ITEMS: ErpMenuGroup[] = [
  {
    label: 'AUTOMATION',
    items: [
      { label: 'Product Automation', to: '/inventory', perm: 'inventory' },
      { label: 'Stock Update Automation', to: '/inventory', perm: 'inventory' },
      { label: 'A/C Update Automation', to: '/customers' },
      { label: 'Reconciliation', to: '/shift' },
    ],
  },
  {
    label: 'MASTERS',
    items: [
      { label: 'User Management', to: '/staff', perm: 'users' },
      { label: 'Document Center', to: '/helpdocs' },
      { label: 'Adjust Fields', to: '/settings', perm: 'settings' },
    ],
  },
  {
    label: 'DATA',
    items: [
      { label: 'Data Management', to: '/settings', perm: 'settings' },
      { label: 'Export ViewData (CSV)', to: '/utilities/export' },
      { label: 'OffLine/OnLine Synchronization', to: '/settings', perm: 'settings' },
    ],
  },
]

export const REPORT_TREE: { title: string; items: string[] } = {
  title: 'Report List',
  items: [
    'OS Creditor Statement',
    'OS Debtor Statement',
    'Account Statement',
    'Expiry Medicines Report',
    'OTC Medicine Issue',
    'Party Master Report',
  ],
}
