import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bareEmoji } from './style'

// Stands for the engine and the mods after pulse: their band row.
const others = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })

async function band($: Engine) {
  const ui = await $.ui.mount({
    plugin: 'pulse', surface: 'terminal', component: 'AbovePrompt',
    props: { isWorking: true, hasSurvey: false },
  } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  await ui.unmount()
  return text
}

test('the band counts tools and times the turn by the clock', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  others(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await clock.advance(61_000)

  const text = await band($)
  expect(text).toContain('reading a.ts')
  expect(text).toContain('1 tool')
  expect(text).toContain('1m 01s')
  expect(bareEmoji(text)).toEqual([])
})

test("other mods' band rows stay under pulse's", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  others(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'go', turnId: 't1' })

  const text = await band($)
  expect(text).toContain('thinking')
  expect(text).toContain('other band')
  expect(text.indexOf('thinking')).toBeLessThan(text.indexOf('other band'))
})

test('the spinner turns with the shared tick and stands still with motion off', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  others(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  const first = (await band($))[0]
  await clock.advance(100)
  expect((await band($))[0]).not.toBe(first)
})

test('motion off: a still dot, no spinner', { options: { motion: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  others(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect((await band($))[0]).toBe('●')
  await clock.advance(1000)
  expect((await band($))[0]).toBe('●')
})
