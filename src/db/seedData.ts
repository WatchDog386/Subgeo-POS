// Starter records shared by the till (src/db/seed.ts) and the server
// (server/sync.ts). Both sides create them with the SAME ids and hashes, so a
// fresh till and the server agree on day one and nothing conflicts on sync.
import { hashPassword } from '../lib/sha256'
import type { Branch, User } from './types'

export const SEED_BRANCH: Branch & { id: number } = {
  id: 1,
  number: 1,
  // Rename it in Chemists → Edit after the first sign-in.
  name: 'CHEMIST 1',
  location: '',
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

/** subgeo / 0001 — the cashier of SUBGEO1 (cashiers share the user name; the password picks the chemist). */
export const SEED_CASHIER: User & { id: number } = {
  id: 2,
  name: 'SUBGEO',
  username: 'subgeo',
  salt: 'seed-cashier',
  passHash: hashPassword('seed-cashier', '0001'),
  role: 'cashier',
  active: true,
  branchId: 1,
}

/** purchase / subgeo22 — the purchases dashboard, run by the admin (admin rights). */
export const SEED_PURCHASE: User & { id: number } = {
  id: 3,
  name: 'PURCHASE',
  username: 'purchase',
  salt: 'seed-purchase',
  passHash: hashPassword('seed-purchase', 'subgeo22'),
  role: 'purchase',
  active: true,
  branchId: 1,
}

export const SEED_USERS = [SEED_ADMIN, SEED_CASHIER, SEED_PURCHASE]

/** "SUBGEO1" for chemist number 1 (the chemists are SUBGEO1 … SUBGEO12). */
/** The head-office pharmacy "HQ" is kept on this chemist number (shown as HQ, not SUBGEO100). */
export const HQ_NUMBER = 100

/** The code a chemist gets when the admin sets none: SUBGEO<number>, or HQ. */
export function defaultChemCode(number: number | undefined): string {
  if (number === HQ_NUMBER) return 'HQ'
  return number ? `SUBGEO${number}` : ''
}

/** Codes the admin typed for chemists (Utilities → Chemists), by chemist number. */
const customCodes = new Map<number, string>()

/** Keep the custom codes in step with the chemist list (call whenever it changes). */
export function registerChemCodes(list: { number: number; code?: string }[]): void {
  customCodes.clear()
  for (const b of list) {
    const c = normChemCode(b.code)
    if (c) customCodes.set(b.number, c)
  }
}

/** A typed chemist code as stored: trimmed, upper case, single spaces. Blank = use the default. */
export function normChemCode(code: string | undefined): string {
  return (code ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Why a typed chemist code can't be used, or undefined when it can (blank is fine: the default). */
export function chemCodeProblem(code: string, number: number, all: { number: number; code?: string }[]): string | undefined {
  const c = normChemCode(code)
  if (!c) return undefined
  if (c.length > 24) return 'Chemist code: 24 characters at most'
  if (!/^[A-Z0-9][A-Z0-9 .&'-]*$/.test(c)) return 'Chemist code: letters, numbers, spaces and . & \' - only'
  const other = all.find((b) => b.number !== number && (normChemCode(b.code) || defaultChemCode(b.number)) === c)
  if (other) return `Chemist code ${c} is already used by chemist No. ${other.number}`
  // Never take another chemist's default code (SUBGEO5 for chemist 7 would confuse everyone).
  if (/^SUBGEO\d+$/.test(c) && c !== defaultChemCode(number)) return `${c} is the default code of another chemist number — pick a name`
  return undefined
}

/** The chemist's code everywhere it is shown: the admin's own code, else SUBGEO<number> / HQ. */
export function chemCode(number: number | undefined): string {
  if (number === undefined || number === null) return ''
  return customCodes.get(number) ?? defaultChemCode(number)
}
