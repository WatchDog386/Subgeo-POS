// Tasks assigned to staff of a chemist (Home → To-Do List → Task To-Do).
// One synced record per task (db.tasks), scoped to the chemist.
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { StaffTask, User } from '../db/types'

export type { StaffTask }

export function useTasks(): StaffTask[] {
  return useLiveQuery(async () => (await db.tasks.toArray()).sort((a, b) => b.createdAt - a.createdAt), [], [] as StaffTask[])
}

export async function addTask(t: Omit<StaffTask, 'id' | 'createdAt' | 'status'>): Promise<number> {
  if (!t.text.trim()) throw new Error('Describe the task')
  if (t.due !== undefined && !Number.isFinite(t.due)) throw new Error('Due date is not valid')
  return (await db.tasks.add({ ...t, text: t.text.trim(), createdAt: Date.now(), status: 'PENDING' } as StaffTask)) as number
}

export async function setTaskStatus(id: number, status: StaffTask['status'], by?: User | null): Promise<void> {
  const n = await db.tasks.update(id, {
    status,
    completedAt: status === 'COMPLETED' ? Date.now() : undefined,
    completedBy: status === 'COMPLETED' ? by?.name : undefined,
  })
  if (!n) throw new Error('That task no longer exists')
}

export async function deleteTask(id: number): Promise<void> {
  await db.tasks.delete(id)
}

/** Pending tasks a user should see: assigned to them, or to anyone at the chemist. */
export function tasksFor(list: StaffTask[], user: User | null): StaffTask[] {
  return list.filter((t) => t.status === 'PENDING' && (t.assigneeId === undefined || t.assigneeId === user?.id))
}
