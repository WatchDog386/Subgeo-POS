// Starter records shared by the till (src/db/seed.ts) and the server
// (server/sync.ts). Both sides create them with the SAME ids and hashes, so a
// fresh till and the server agree on day one and nothing conflicts on sync.
import { hashPassword } from '../lib/sha256'
import type { Branch, User } from './types'

export const SEED_BRANCH: Branch & { id: number } = {
  id: 1,
  number: 1,
  name: 'SCL UMOJA 3',
  location: 'UMOJA 3',
  phone: '',
  active: true,
  createdAt: 0,
}

/** admin / subgeo22 — the owner, sees every chemist. Change the password after the first sign-in. */
export const SEED_ADMIN: User & { id: number } = {
  id: 1,
  name: 'ADMIN',
  username: 'admin',
  salt: 'seed-admin',
  passHash: hashPassword('seed-admin', 'subgeo22'),
  role: 'owner',
  active: true,
}

/** subgeo / 0000 — the cashier of CHEM1. */
export const SEED_CASHIER: User & { id: number } = {
  id: 2,
  name: 'SUBGEO',
  username: 'subgeo',
  salt: 'seed-cashier',
  passHash: hashPassword('seed-cashier', '0000'),
  role: 'cashier',
  active: true,
  branchId: 1,
}

/** purchase — the purchases dashboard (indents, POs, GRNs, medicine master).
 * Signs in with NO password: an empty-password hash is only accepted for this
 * role (see server/sync.ts auth/login and session.tsx). */
export const SEED_PURCHASE: User & { id: number } = {
  id: 3,
  name: 'PURCHASE',
  username: 'purchase',
  salt: 'seed-purchase',
  passHash: hashPassword('seed-purchase', ''),
  role: 'purchase',
  active: true,
  branchId: 1,
}

export const SEED_USERS = [SEED_ADMIN, SEED_CASHIER, SEED_PURCHASE]

/** "CHEM1" for chemist number 1. */
export function chemCode(number: number | undefined): string {
  return number ? `CHEM${number}` : ''
}
