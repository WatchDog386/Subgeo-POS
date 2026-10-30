// Tasks the admin assigns to staff of a chemist (Home → To-Do List → Task To-Do).
// Stored per chemist in kv ('medapp:tasks'), so they sync with that chemist.
import { db } from '../db/db'
import type { User } from '../db/types'
import { getKv, setKv, useKv } from './data'

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

const KEY = 'medapp:tasks'

export function useTasks(): StaffTask[] {
  return useKv<StaffTask[]>(KEY, [])
}

async function update(fn: (list: StaffTask[]) => StaffTask[]): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    await setKv(KEY, fn(await getKv<StaffTask[]>(KEY, [])))
  })
}

export async function addTask(t: Omit<StaffTask, 'id' | 'createdAt' | 'status'>): Promise<void> {
  if (!t.text.trim()) throw new Error('Describe the task')
  await update((list) => [{ ...t, text: t.text.trim(), id: Date.now(), createdAt: Date.now(), status: 'PENDING' }, ...list])
}

export async function setTaskStatus(id: number, status: StaffTask['status'], by?: User | null): Promise<void> {
  await update((list) =>
    list.map((t) => (t.id === id ? { ...t, status, completedAt: status === 'COMPLETED' ? Date.now() : undefined, completedBy: status === 'COMPLETED' ? by?.name : undefined } : t)),
  )
}

export async function deleteTask(id: number): Promise<void> {
  await update((list) => list.filter((t) => t.id !== id))
}

/** Pending tasks a user should see: assigned to them, or to anyone at the chemist. */
export function tasksFor(list: StaffTask[], user: User | null): StaffTask[] {
  return list.filter((t) => t.status === 'PENDING' && (t.assigneeId === undefined || t.assigneeId === user?.id))
}
