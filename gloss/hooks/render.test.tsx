import { expect, test } from 'claude-code/testing'

import { bareEmoji } from './style'

test('inline code draws as a padded chip', async $ => {
  const ui = await $.ui.mount({
    plugin: 'gloss',
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
    plugin: 'gloss',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```bash\nnpm test\n```', isFirstOfReply: true },
  })
  await ui.press({ key: 'copy0' })
  expect(copied).toEqual(['npm test'])
})

test('mobile keeps its own drawing', async ($, on) => {
  // Stands in for the engine's own drawing beneath the plugin.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'gloss',
    surface: 'mobile',
    component: 'AssistantMessage',
    props: { text: '| a | b |\n|---|---|\n| 1 | 2 |', isFirstOfReply: true },
  })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
})

test('desktop and VS Code: boxed code, the engine table, chips and callouts', async $ => {
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'gloss', surface, component: 'AssistantMessage',
      props: { text: 'Run `ls`.\n\n```sh\nls -la\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!NOTE]\n> Read me.', isFirstOfReply: true },
    } as never)
    const boxes = (await ui.findAll({ type: 'Box' })) as Drawn[]
    expect(boxes.some(b => b.props?.borderStyle === 'round' && b.props?.borderColor === 'subtle')).toBe(true)
    expect(boxes.some(b => b.props?.borderColor === 'ide')).toBe(true)
    const all = (await ui.findAll({ type: 'Text' })) as Drawn[]
    expect(all.some(t => t.text === ' ls ' && t.props?.backgroundColor === 'userMessageBackground')).toBe(true)
    // No hand-drawn rules where the face is proportional.
    expect(all.some(t => t.text?.startsWith('╭─'))).toBe(false)
    expect((await ui.findAll({ type: 'Markdown' })).length).toBeGreaterThan(0)
    expect(bareEmoji(all.map(t => t.text ?? '').join(''))).toEqual([])
    await ui.unmount()
  }
})

test('a message redrawn with new text is parsed again', async $ => {
  const draw = (text: string) => $.ui.mount({
    plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage',
    requestId: 'm1', props: { text, isFirstOfReply: true },
  } as never)
  await (await draw('Edit `a.ts`')).unmount()
  const ui = await draw('Edit `b.ts`')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain(' b.ts ')
})

const mountAt = ($: Parameters<Parameters<typeof test>[1]>[0], text: string, columns = 100) =>
  $.ui.mount({
    plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage',
    props: { text, isFirstOfReply: true }, viewport: { columns, rows: 40 },
  } as never)

type Drawn = { text?: string; props?: Record<string, unknown> }
const texts = async (ui: { findAll: (q: { type: string }) => Promise<unknown[]> }) =>
  (await ui.findAll({ type: 'Text' })) as Drawn[]

test('the inline-code chip takes theme colours, so a light theme gets a light chip', async $ => {
  const chip = (await texts(await mountAt($, 'Edit `a.ts` now'))).find(t => t.text === ' a.ts ')
  expect(chip?.props?.backgroundColor).toBe('userMessageBackground')
  // The default text colour: warning yellow means attention, not code.
  expect(chip?.props?.color).toBeUndefined()
})

test('a list draws depth glyphs and task marks, done in the success colour', async $ => {
  const all = await texts(await mountAt($, '- top\n  - inner\n- [x] done\n- [ ] open'))
  const mark = (s: string) => all.find(t => t.text === s)
  expect(mark('• ')?.props?.color).toBe('claude')
  expect(mark('  ◦ ')?.props?.color).toBe('subtle')
  expect(mark('✓ ')?.props?.color).toBe('success')
  expect(mark('○ ')).toBeDefined()
})

test('a quote draws a dim bar on every wrapped row, and no box', async $ => {
  const ui = await mountAt($, '> ' + 'word '.repeat(30).trim(), 40)
  const all = await texts(ui)
  const bars = all.filter(t => t.text === '│ ')
  expect(bars.length).toBeGreaterThan(1)
  expect(bars.every(b => b.props?.dimColor)).toBe(true)
  const boxes = (await ui.findAll({ type: 'Box' })) as Drawn[]
  expect(boxes.some(b => b.props?.borderStyle)).toBe(false)
})

test('a rule draws a dim line across the viewport', async $ => {
  const all = await texts(await mountAt($, 'a\n\n---\n\nb', 60))
  const rule = all.find(t => t.text?.startsWith('─'))
  expect(rule?.text).toBe('─'.repeat(56))
  expect(rule?.props?.dimColor).toBe(true)
})

test('strikethrough text is drawn struck', async $ => {
  const all = await texts(await mountAt($, 'was ~~old~~ new'))
  expect(all.find(t => t.text === 'old')?.props?.strikethrough).toBe(true)
})
