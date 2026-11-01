import { expect, test } from 'claude-code/testing'
import { pieces } from './register'
import { bareEmoji } from './style'

const props = (kind: string, text = 'fix the band') => ({ text, origin: { kind }, isExpanded: false }) as never
type Found = { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string; props: Record<string, unknown> }[]> }
// The pane's prompt rows (keys p1, p2, ...), past its search field and prev/next.
const rowTexts = async (pane: Found) => (await pane.findAll({ type: 'Button' })).filter(b => /^p\d/.test(b.key ?? '')).map(b => b.text)

test('a typed prompt draws as a card with a label', async $ => {
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', props: props('composer') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['You', 'fix the band'])
})

test('the prompts pane lists drawn prompts newest first', async $ => {
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: props('composer', 'first ask') })
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: props('composer', 'second ask\nmore') })
  const pane = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 60 } as never })
  expect(await rowTexts(pane)).toEqual(['#2 second ask', '#1 first ask'])
})

test('the pane shows a prompt by its first line with words, cut whole', async $ => {
  const pasted = '\n<pasted_content id="1">\r\nsudo ls\r\n</pasted_content id="1">'
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: props('composer', pasted) })
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: props('composer', '😀'.repeat(20)) })
  const pane = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 14 } as never })
  expect(await rowTexts(pane)).toEqual([`#2 ${'😀'.repeat(4)}…`, '#1 sudo ls'])
})

test('a task notification keeps the engine drawing', async ($, on) => {
  // Stands in for the engine's own row beneath the plugin.
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', props: props('task-notification') })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
})

test('a fenced block in a prompt draws as code, the prose around it as text', async $ => {
  const text = 'look:\n```ts\nconst a = 1\n```\ndone'
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', props: props('composer', text) })
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
    plugin: 'postcard', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'theme', args: 'dark', text: 'Theme set to dark', isErrored: false },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('/theme dark')
  const card = (await ui.findAll({ type: 'Box' }))[0] as { props?: { borderColor?: string; backgroundColor?: string } }
  expect(card.props?.borderColor).toBe('merged')
  expect(card.props?.backgroundColor).toBeUndefined()
})

test('a typed slash command prompt is labelled as a command, without a fill', async $ => {
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', props: props('composer', '/skill-creator make one') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Command')
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => (b as { props?: { backgroundColor?: string } }).props?.backgroundColor)).toBe(false)
})

test('cards take the you and command roles, in text-presentation glyphs', async $ => {
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', props: props('composer') })
  const card = (await ui.findAll({ type: 'Box' }))[0] as { props?: Record<string, unknown> }
  expect(card.props?.borderStyle).toBe('round')
  expect(card.props?.borderColor).toBe('suggestion')
  await ui.unmount()
  const out = await $.ui.mount({
    plugin: 'postcard', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'cost', args: '', text: 'Total: $1.20', isErrored: true } as never,
  })
  const texts = (await out.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('✕ /cost')
  expect(bareEmoji(texts.join(''))).toEqual([])
  await out.unmount()
})

test('graphical surfaces keep their own prompt and command drawing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    for (const [component, p] of [
      ['UserMessage', props('composer')],
      ['CommandOutput', { command: 'cost', args: '', text: 'x', isErrored: false }],
    ] as const) {
      const ui = await $.ui.mount({ plugin: 'postcard', surface, component, props: p as never } as never)
      expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
      await ui.unmount()
    }
  }
})

test('prompts drawn natively on desktop still fill the /prompts pane there', async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  await $.ui.mount({ plugin: 'postcard', surface: 'desktop', component: 'UserMessage', requestId: 'd1', props: props('composer', 'from the app') })
  const pane = await $.ui.mount({ plugin: 'postcard', surface: 'desktop', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 60 } as never })
  expect(await rowTexts(pane)).toEqual(['#1 from the app'])
})

test('glyphs: text draws ASCII stand-ins and classic borders', { options: { glyphs: 'text' } }, async $ => {
  const ui = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'CommandOutput', props: { command: 'cost', args: '', text: 'nope', isErrored: true } as never })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('x /cost')
  expect(((await ui.findAll({ type: 'Box' })) as { props?: Record<string, unknown> }[]).map(b => b.props?.borderStyle)).toEqual(['classic'])
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: props('composer', 'a'.repeat(40)) })
  const pane = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 14 } as never })
  expect(await rowTexts(pane)).toEqual([`#1 ${'a'.repeat(8)}~`])
})
