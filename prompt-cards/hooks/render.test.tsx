import { expect, test } from 'claude-code/testing'
import { pieces } from './register'

const props = (kind: string, text = 'fix the band') => ({ text, origin: { kind }, isExpanded: false }) as never

test('a typed prompt draws as a card with a label', async $ => {
  const ui = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', props: props('composer') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['you', 'fix the band'])
})

test('the prompts pane lists drawn prompts newest first', async $ => {
  await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: props('composer', 'first ask') })
  await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: props('composer', 'second ask\nmore') })
  const pane = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 60 } as never })
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['#2 second ask', '#1 first ask'])
})

test('the pane shows a prompt by its first line with words, cut whole', async $ => {
  const pasted = '\n<pasted_content id="1">\r\nsudo ls\r\n</pasted_content id="1">'
  await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: props('composer', pasted) })
  await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: props('composer', '😀'.repeat(20)) })
  const pane = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 18 } as never })
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toEqual([`#2 ${'😀'.repeat(9)}…`, '#1 sudo ls'])
})

test('a task notification keeps the engine drawing', async ($, on) => {
  // Stands in for the engine's own row beneath the plugin.
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', props: props('task-notification') })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
})

test('a fenced block in a prompt draws as code, the prose around it as text', async $ => {
  const text = 'look:\n```ts\nconst a = 1\n```\ndone'
  const ui = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', props: props('composer', text) })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('look:')
  expect(texts).toContain('ts')
  expect(texts).toContain('done')
  expect(texts.some(t => t.includes('```'))).toBe(false)
})

test('a pasted block loses its paste tags and blank edges', () => {
  const text = '```\r\n\r\n<pasted_content id="76ce">\r\n  sudo ls\r\n</pasted_content id="76ce">\r\n\r\n  ```'
  expect(pieces(text)).toEqual([{ text: '  sudo ls', language: '' }])
})

test('a slash command output row draws as a purple card headed by the command', async $ => {
  const ui = await $.ui.mount({
    plugin: 'prompt-cards', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'theme', args: 'dark', text: 'Theme set to dark', isErrored: false },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('/theme dark')
  const card = (await ui.findAll({ type: 'Box' }))[0] as { props?: { borderColor?: string; backgroundColor?: string } }
  expect(card.props?.borderColor).toBe('merged')
  expect(card.props?.backgroundColor).toBeUndefined()
})

test('a typed slash command prompt is labelled as a command, without a fill', async $ => {
  const ui = await $.ui.mount({ plugin: 'prompt-cards', surface: 'terminal', component: 'UserMessage', props: props('composer', '/skill-creator make one') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('command')
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => (b as { props?: { backgroundColor?: string } }).props?.backgroundColor)).toBe(false)
})
