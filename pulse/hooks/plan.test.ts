import { expect, test } from 'claude-code/testing'

import { nextPlan, planProgress } from './plan'

const todos = (...s: ('pending' | 'in_progress' | 'completed')[]) => ({
  todos: s.map((status, i) => ({ content: `Step ${i + 1}`, activeForm: `Doing step ${i + 1}`, status })),
})

test('TodoWrite rewrites the plan; progress counts the steps done and names the one under way', () => {
  const p = nextPlan({ items: [] }, 'TodoWrite', todos('completed', 'completed', 'in_progress', 'pending'), undefined)
  expect(planProgress(p)).toEqual({ done: 2, total: 4, now: 'Doing step 3', isDone: false })
  // With none under way, the next one waiting.
  expect(planProgress(nextPlan(p, 'TodoWrite', todos('completed', 'pending'), undefined))).toEqual({ done: 1, total: 2, now: 'Step 2', isDone: false })
  expect(planProgress(nextPlan(p, 'TodoWrite', todos('completed', 'completed'), undefined))?.isDone).toBe(true)
  expect(planProgress(null)).toBeNull()
  expect(planProgress({ items: [] })).toBeNull()
})

test('TaskCreate adds a task by the id it returns; TaskUpdate changes or deletes one; other tools leave the plan', () => {
  let p = nextPlan({ items: [] }, 'TaskCreate', { subject: 'Write the parser', activeForm: 'Writing the parser' }, { task: { id: '1', subject: 'Write the parser' } })
  p = nextPlan(p, 'TaskCreate', { subject: 'Test it' }, { task: { id: '2', subject: 'Test it' } })
  expect(planProgress(p)).toEqual({ done: 0, total: 2, now: 'Write the parser', isDone: false })
  p = nextPlan(p, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true })
  expect(planProgress(p)?.now).toBe('Writing the parser')
  p = nextPlan(p, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
  expect(planProgress(p)).toMatchObject({ done: 1, total: 2 })
  p = nextPlan(p, 'TaskUpdate', { taskId: '2', status: 'deleted' }, { success: true })
  expect(planProgress(p)).toMatchObject({ done: 1, total: 1, isDone: true })
  expect(nextPlan(p, 'Read', { file_path: 'x' }, {})).toBe(p)
  // A create that returned no id adds nothing.
  expect(nextPlan(p, 'TaskCreate', { subject: 'x' }, {})).toBe(p)
})
