// Which till tables sync, and how. Shared by the till (src/db/db.ts, sync.ts)
// and the server (server/sync.ts), so it must not import Dexie or the DOM.

/** Tables shared by every chemist (company-wide). */
// Order matters: a new chemist must reach the server before the cashiers assigned to it.
export const GLOBAL_TABLES = ['branches', 'users', 'categories', 'suppliers', 'messages'] as const
/** Tables that belong to one chemist. Parents come before the records that
 * point at them (a sale names its shift), so the server always has the parent
 * when it links the child in the relational tables. */
export const BRANCH_TABLES = ['products', 'customers', 'shifts', 'sales', 'parked', 'movements', 'purchaseOrders', 'jobs', 'logs', 'docs', 'tasks'] as const
export const SYNCED_TABLES: readonly string[] = [...GLOBAL_TABLES, ...BRANCH_TABLES, 'kv']

/** Fields that are counters: merged by adding deltas instead of overwriting. */
export const COUNTER_FIELDS: Record<string, string[]> = { products: ['stock'], customers: ['balance'] }

/** kv keys shared by all chemists. Everything else in kv belongs to the chemist. */
export const GLOBAL_KV_KEYS = new Set(['settings', 'medapp:defaults'])
/** kv keys that never leave the device. */
export const isLocalKvKey = (key: string) => key.startsWith('_local:')
/** kv keys holding running document numbers — merged with max() so numbers never go backwards. */
export const isSeqKvKey = (key: string) => key.startsWith('seq:') || key.startsWith('medapp:seq:')

export const isMetaField = (k: string) => k.startsWith('_')
