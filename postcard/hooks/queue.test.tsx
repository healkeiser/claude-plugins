import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isQueueable, moveQueued } from './queue'

const BAND = { plugin: 'postcard', surface: 'terminal', component: 'AbovePrompt', props: { isWorking: true, hasSurvey: false, bodyColumns: 80, maxRows: 20, scroll: { offset: 0, bodyRows: 20 }, view: {} } as never } as const
const PANE = { plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 80 } as never } as const

// Stands in for the engine: turns, the store, the prompt box, and what is submitted or toasted.
function engine(on: On, draft = '') {
  const clock = mock.clock(on, { now: 0 })
  const seen = { clock, submitted: [] as string[], filled: [] as string[], toasts: [] as string[], store: {} as Record<string, unknown> }
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

// Enter, or chat:sendNow (ctrl+x ctrl+s), which submits and then interrupts the turn: never postcard's.
const typed = (text: string, turnId?: string) =>
  ({ text, origin: { kind: 'composer' }, wait: false, ...(turnId ? { turnId } : {}) }) as never
// chat:queueSubmit (ctrl+x enter): the person asks the prompt to wait its turn.
const queued = (text: string, turnId?: string) =>
  ({ text, origin: { kind: 'composer' }, wait: true, ...(turnId ? { turnId } : {}) }) as never
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

test('a prompt queued with ctrl+x enter while Claude works waits in the queue above the prompt, then goes when the turn ends, in order', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'fix it', turnId: 'T1' })
  const one = await $.prompt.submit(queued('and the lexer', 'T1'))
  expect('drop' in one).toBe(true)
  await $.prompt.submit(queued('then the tests', 'T1'))
  // A slash command still goes to the engine.
  await $.prompt.submit(queued('/compact', 'T1'))
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
  await $.prompt.submit(queued('first', 'T2'))
  await $.prompt.submit(queued('second', 'T2'))
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
  await $.prompt.submit(queued('later', 'T3'))
  expect(seen.submitted).toEqual(['later'])
})

test('a queued prompt leaves the prompt box empty, but never wipes something else typed there', async ($, on) => {
  // The engine leaves a dropped prompt in the box: here it still holds it.
  const seen = engine(on, 'and the lexer')
  const { clock } = seen
  await $.turn.start({ text: 'go', turnId: 'T5' })
  await $.prompt.submit(queued('and the lexer', 'T5'))
  await clock.advance(50)
  expect(seen.filled).toEqual([''])
  // The box holds other words by then: left as it is.
  await $.prompt.submit(queued('something else', 'T5'))
  await clock.advance(50)
  expect(seen.filled).toEqual([''])
})

test('a prompt the queue sent is left to the engine, which names the plugin that sent it', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm-q', props: { text: 'say two', origin: { kind: 'plugin', name: 'postcard', asUser: true }, isExpanded: false } as never })
  expect(await texts(ui)).toEqual(['engine row'])
})

test('a prompt typed before the one just sent has started its turn waits too; one sent later, once idle, goes', async ($, on) => {
  const seen = engine(on)
  const { clock } = seen
  // Sent while idle: through to the engine. Its turn has not started yet (its hooks run).
  await $.prompt.submit(queued('first'))
  const second = await $.prompt.submit(queued('second'))
  expect(seen.submitted).toEqual(['first'])
  expect('drop' in second).toBe(true)
  // Its turn never started (a failed submit): past 10 s, the next goes through.
  await clock.advance(11_000)
  await $.prompt.submit(queued('third'))
  expect(seen.submitted).toEqual(['first', 'third'])
})

test('Enter and send-now while Claude works stay with Claude Code: send-now interrupts, and its prompt must run next', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'go', turnId: 'T6' })
  const now = await $.prompt.submit(typed('stop, do this instead', 'T6'))
  expect('drop' in now).toBe(false)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'T6', reason: 'interrupted' } as never)
  expect(seen.submitted).toEqual(['stop, do this instead'])
  // Nothing of postcard's held or toasted: its queue was never touched.
  expect(seen.toasts).toEqual([])
})
