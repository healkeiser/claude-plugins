// Claude's own plan, as its task tools write it: TodoWrite rewrites the whole
// list, TaskCreate adds a task and TaskUpdate changes one. Pure.
import type { Plan, PlanItem } from '../types'

type Todo = { content?: unknown; status?: unknown; activeForm?: unknown }
const STATUS = new Set(['pending', 'in_progress', 'completed'])
const statusOf = (s: unknown): PlanItem['status'] => (typeof s === 'string' && STATUS.has(s) ? (s as PlanItem['status']) : 'pending')

/**
 * The plan after one of Claude's task tools ran: `input` what it was called
 * with, `result` what it returned. Other tools leave the plan as it was.
 */
export function nextPlan(plan: Plan, tool: string, input: Record<string, unknown>, result: unknown): Plan {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const items = (input.todos as Todo[]).map((t, i): PlanItem => ({
      id: String(i),
      text: String(t.content ?? ''),
      active: String(t.activeForm ?? t.content ?? ''),
      status: statusOf(t.status),
    }))
    return { items: items.filter(x => x.text) }
  }
  if (tool === 'TaskCreate') {
    const task = (result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
    const id = task?.id === undefined ? '' : String(task.id)
    if (!id) return plan
    const text = String(task?.subject ?? input.subject ?? '')
    return { items: [...plan.items.filter(x => x.id !== id), { id, text, active: String(input.activeForm ?? text), status: 'pending' }] }
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    if (input.status === 'deleted') return { items: plan.items.filter(x => x.id !== id) }
    return {
      items: plan.items.map(x =>
        x.id !== id
          ? x
          : {
              ...x,
              ...(typeof input.subject === 'string' ? { text: input.subject } : {}),
              ...(typeof input.activeForm === 'string' ? { active: input.activeForm } : {}),
              ...(input.status !== undefined ? { status: statusOf(input.status) } : {}),
            },
      ),
    }
  }
  return plan
}

/** How far the plan is: steps done of all, and the step under way (or the next one waiting); null with no plan. */
export function planProgress(plan: Plan | null): { done: number; total: number; now: string; isDone: boolean } | null {
  if (!plan || plan.items.length === 0) return null
  const done = plan.items.filter(x => x.status === 'completed').length
  const going = plan.items.find(x => x.status === 'in_progress')
  const next = plan.items.find(x => x.status === 'pending')
  return { done, total: plan.items.length, now: going?.active || going?.text || next?.text || '', isDone: done === plan.items.length }
}
