import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isQueueable, moveQueued } from './queue'

const BAND = { plugin: 'postcard', surface: 'terminal', component: 'AbovePrompt', props: { isWorking: true, hasSurvey: false, bodyColumns: 80, maxRows: 20, scroll: { offset: 0, bodyRows: 20 }, view: {} } as never } as const
const PANE = { plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 80 } as never } as const

// Stands in for the engine: turns, the store, the prompt box, and what is submitted or toasted.
function engine(on: On, draft = '') {
  const seen = { submitted: [] as string[], filled: [] as string[], toasts: [] as string[], store: {} as Record<string, unknown> }
  mock.clock(on, { now: 0 })
  mock.session(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('store.get', (_, e) => ({ value: seen.store[e.key] }) as never)
  on('store.set', (_, e) => {
    seen.store[e.key] = e.value
    return { value: undefined } as never
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }) as never)
  on('prompt.fill', (_, e) => {
    seen.filled.push(e.text)
    return { isFilled: true } as never
  })
  // Beneath postcard: a prompt that reaches the engine enters; a plugin's own is recorded as submitted.
  on('prompt.submit', (_, e) => {
    seen.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return seen
}

const typed = (text: string, turnId?: string) =>
  ({ text, origin: { kind: 'composer' }, wait: false, ...(turnId ? { turnId } : {}) }) as never
const texts = async (d: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await d.findAll({ type: 'Text' })).map(t => t.text)

test('what postcard queues: words, not slash commands, @file mentions or pasted images, which the engine keeps', () => {
  expect(isQueueable('and run the tests')).toBe(true)
  expect(isQueueable('/compact')).toBe(false)
  expect(isQueueable('look at @src/a.ts')).toBe(false)
  expect(isQueueable('this [Image #1]')).toBe(false)
  expect(isQueueable('  ')).toBe(false)
  expect(isQueueable('mail me@example.com')).toBe(true)
  const q = [{ id: 'a', text: 'a', at: 0 }, { id: 'b', text: 'b', at: 0 }, { id: 'c', text: 'c', at: 0 }]
  expect(moveQueued(q, 'c', -1).map(x => x.id)).toEqual(['a', 'c', 'b'])
  expect(moveQueued(q, 'a', -1).map(x => x.id)).toEqual(['a', 'b', 'c'])
  expect(moveQueued(q, 'b', 1).map(x => x.id)).toEqual(['a', 'c', 'b'])
})

test('a prompt typed while Claude works waits in the queue above the prompt, then goes when the turn ends, in order', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'fix it', turnId: 'T1' })
  const one = await $.prompt.submit(typed('and the lexer', 'T1'))
  expect('drop' in one).toBe(true)
  await $.prompt.submit(typed('then the tests', 'T1'))
  // A slash command still goes to the engine.
  await $.prompt.submit(typed('/compact', 'T1'))
  expect(seen.submitted).toEqual(['/compact'])

  const band = await $.ui.mount(BAND)
  const shown = await texts(band)
  expect(shown).toContain('Queued · 2')
  expect(shown).toEqual(expect.arrayContaining(['and the lexer', 'then the tests']))
  // Reorder: the second first.
  await band.press({ key: 'band-up-1' })
  await band.unmount()

  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T1', reason: 'answer' } as never)
  expect(seen.submitted).toEqual(['/compact', 'then the tests'])
  // Kept in the store, so a restart loses nothing.
  expect((seen.store.queue as { items: { text: string }[] }).items.map(x => x.text)).toEqual(['and the lexer'])
})

test('after an interrupt the queue holds; resume sends the next at once when Claude is idle; edit takes one back to the box', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'go', turnId: 'T2' })
  await $.prompt.submit(typed('first', 'T2'))
  await $.prompt.submit(typed('second', 'T2'))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'T2', reason: 'interrupted' } as never)
  expect(seen.submitted).toEqual([])
  expect(seen.toasts.some(t => t.includes('held'))).toBe(true)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-queue' })
  expect(await texts(pane)).toContain('held: nothing is sent until you resume')
  await pane.press({ key: 'pane-edit-1' })
  expect(seen.filled).toEqual(['second'])
  await pane.press({ key: 'pane-hold' })
  expect(seen.submitted).toEqual(['first'])
  await pane.unmount()
})

test('queue: engine leaves every prompt to Claude Code', { options: { queue: 'engine' } }, async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'go', turnId: 'T3' })
  await $.prompt.submit(typed('later', 'T3'))
  expect(seen.submitted).toEqual(['later'])
})
