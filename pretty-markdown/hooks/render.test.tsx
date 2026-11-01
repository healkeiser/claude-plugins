import { expect, test } from 'claude-code/testing'

test('inline code draws as a padded chip', async $ => {
  const ui = await $.ui.mount({
    plugin: 'pretty-markdown',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Edit `a.ts` now', isFirstOfReply: true },
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain(' a.ts ')
})

test('the copy button puts the block source on the clipboard', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const ui = await $.ui.mount({
    plugin: 'pretty-markdown',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```bash\nnpm test\n```', isFirstOfReply: true },
  })
  await ui.press({ key: 'copy0' })
  expect(copied).toEqual(['npm test'])
})

test('the desktop keeps its own drawing', async ($, on) => {
  // Stands in for the engine's own drawing beneath the plugin.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'pretty-markdown',
    surface: 'desktop',
    component: 'AssistantMessage',
    props: { text: '| a | b |\n|---|---|\n| 1 | 2 |', isFirstOfReply: true },
  })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
})

test('a message redrawn with new text is parsed again', async $ => {
  const draw = (text: string) => $.ui.mount({
    plugin: 'pretty-markdown', surface: 'terminal', component: 'AssistantMessage',
    requestId: 'm1', props: { text, isFirstOfReply: true },
  } as never)
  await (await draw('Edit `a.ts`')).unmount()
  const ui = await draw('Edit `b.ts`')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain(' b.ts ')
})
