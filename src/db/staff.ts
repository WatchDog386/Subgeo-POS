import { db } from './db'
import { logActivity } from './logs'
import { chemCode } from './seedData'
import { hashPassword, newSalt } from '../lib/sha256'
import type { Role, User } from './types'

export const PASSWORD_MIN = 4
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/

export interface StaffInput {
  id?: number
  name: string
  username: string
  /** Required for a new account; blank keeps the current password. */
  password?: string
  role: Role
  /** Chemist id; required for cashiers and managers. */
  branchId?: number
  active: boolean
  email?: string
  phone?: string
  about?: string
}

/**
 * Create or update a staff account. Used by the admin's User Management and
 * Staff screens. The server re-checks the same rules when it syncs.
 */
export async function saveStaff(input: StaffInput, actor?: User | null): Promise<User> {
  const name = input.name.trim()
  const username = input.username.trim().toLowerCase()
  if (!name) throw new Error('Name is required')
  if (!USERNAME_RE.test(username)) throw new Error('User name: 2-32 letters, digits, dot, dash or underscore (no spaces)')
  const users = await db.users.toArray()
  const existing = input.id !== undefined ? users.find((u) => u.id === input.id) : undefined
  if (input.id !== undefined && !existing) throw new Error('That user no longer exists')
  if (users.some((u) => u.username === username && u.id !== input.id)) throw new Error(`User name "${username}" is already taken`)
  const password = input.password ?? ''
  if (!existing && !password) throw new Error('Set a password for the new user')
  if (password && password.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters`)

  let branchId: number | undefined
  if (input.role !== 'owner') {
    if (!input.branchId) throw new Error('Pick the chemist (CHEM number) this user works in')
    const b = await db.branches.get(input.branchId)
    if (!b) throw new Error('That chemist does not exist')
    branchId = b.id
  }
  const owners = users.filter((u) => u.role === 'owner' && u.active && u.id !== input.id)
  if (owners.length === 0 && (input.role !== 'owner' || !input.active)) throw new Error('Keep at least one active admin')

  const salt = password ? newSalt() : existing!.salt
  const rec: User = {
    ...(existing ?? {}),
    name,
    username,
    salt,
    passHash: password ? hashPassword(salt, password) : existing!.passHash,
    role: input.role,
    branchId,
    active: input.active,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    about: input.about?.trim() || undefined,
  }
  if (existing) {
    rec.id = existing.id
    await db.users.put(rec)
  } else {
    rec.id = await db.users.add(rec)
  }
  const where = branchId ? chemCode((await db.branches.get(branchId))?.number) : 'all chemists'
  await logActivity('user', `${existing ? 'Updated' : 'Added'} user ${username}`, {
    detail: `${input.role} · ${where}${input.active ? '' : ' · disabled'}${password && existing ? ' · password reset' : ''}`,
    userId: actor?.id,
    userName: actor?.name,
  })
  return rec
}
