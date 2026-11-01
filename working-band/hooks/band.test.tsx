import { expect, mock, test } from 'claude-code/testing'

test('the band counts tools and times the turn by the clock', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await clock.advance(61_000)

  const ui = await $.ui.mount({
    plugin: 'working-band', surface: 'terminal', component: 'AbovePrompt',
    props: { isWorking: true, hasSurvey: false },
  } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).toContain('reading a.ts')
  expect(text).toContain('1 tool')
  expect(text).toContain('1m 01s')
})
