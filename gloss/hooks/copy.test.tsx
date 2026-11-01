import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { fenced, oneLine, tsv } from './copy'

type On = Parameters<TestBody>[1]

const mountAt = ($: Engine, text: string, columns = 100) =>
  $.ui.mount({
    plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage',
    props: { text, isFirstOfReply: true }, viewport: { columns, rows: 40 },
  } as never)

const clipboard = (on: On) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  return copied
}

test('fenced: a fence longer than any backtick run inside', () => {
  expect(fenced('ts', 'const a = 1')).toBe('```ts\nconst a = 1\n```')
  expect(fenced('md', 'see ```x```')).toBe('````md\nsee ```x```\n````')
})

test('oneLine joins shell lines, keeps continuations, drops prompts and comments', () => {
  expect(oneLine('cd x\nnpm i \\\n  --save y\n# a comment\nnpm test', 'bash')).toBe('cd x && npm i --save y && npm test')
  expect(oneLine('$ ls\n$ pwd', 'console')).toBe('ls && pwd')
  expect(oneLine('if [ -f a ]; then\n  echo a\nfi', 'sh')).toBe('if [ -f a ]; then echo a; fi')
  expect(oneLine('Get-ChildItem `\n  -Recurse\nWrite-Host done', 'powershell')).toBe('Get-ChildItem -Recurse; Write-Host done')
  expect(oneLine('cat <<EOF\nhi\nEOF', 'bash')).toBeNull()
  expect(oneLine('npm test', 'bash')).toBeNull()
  expect(oneLine('a\nb', 'ts')).toBeNull()
})

test('tsv: cells by tabs, the rule row dropped', () => {
  expect(tsv('| a | b |\n|---|--:|\n| 1 | x \\| y |')).toBe('a\tb\n1\tx | y')
})

test('the code menu copies the code, the fenced block and one shell line', async ($, on) => {
  const copied = clipboard(on)
  const ui = await mountAt($, '```bash\ncd x\nnpm test\n```')
  await ui.press({ key: 'copy0' })
  await ui.press({ key: 'fence0' })
  await ui.press({ key: 'line0' })
  expect(copied).toEqual(['cd x\nnpm test', '```bash\ncd x\nnpm test\n```', 'cd x && npm test'])
  // Open sides stay: no border on any box, so a mouse selection copies code alone.
  const boxes = (await ui.findAll({ type: 'Box' })) as { props?: { borderStyle?: string } }[]
  expect(boxes.some(b => b.props?.borderStyle)).toBe(false)
})

test('one line is offered only where it means something', async $ => {
  const ui = await mountAt($, '```ts\nconst a = 1\nconst b = 2\n```')
  expect(await ui.find({ key: 'fence0' })).toBeDefined()
  expect(await ui.find({ key: 'line0' })).toBeUndefined()
})

test('a narrow window drops the menu from its end, the plain copy last', async $ => {
  const ui = await mountAt($, '```bash\ncd x\nnpm test\n```', 30)
  expect(await ui.find({ key: 'copy0' })).toBeDefined()
  expect(await ui.find({ key: 'line0' })).toBeUndefined()
  const head = (await ui.findAll({ type: 'Text' })).map(t => t.text).find(t => t?.startsWith('╭─ '))
  expect(head).toBeDefined()
})

test('a table copies as Markdown and as TSV', async ($, on) => {
  const copied = clipboard(on)
  const source = '| a | b |\n|---|---|\n| 1 | 2 |'
  const ui = await mountAt($, source)
  await ui.press({ key: 'md0' })
  await ui.press({ key: 'tsv0' })
  expect(copied).toEqual([source, 'a\tb\n1\t2'])
})

const reply = (text: string, door: 'response' | 'prompt' = 'response') => ({
  message: { type: door === 'prompt' ? 'user' : 'assistant', ...(door === 'prompt' ? { role: 'user' } : { role: 'assistant' }), content: [{ type: 'text', text }] },
  door, origin: { kind: 'engine' }, uuid: `u${Math.random()}`,
}) as never

test('/gloss copy copies the last code block of the last reply, or the nth', async ($, on) => {
  mock.session(on)
  const copied = clipboard(on)
  on('session.start', () => ({ cwd: '/repo' }))
  const registered: string[] = []
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['gloss'])
  const run = (args: string) =>
    $.command.run({ command: 'gloss', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  await $.session.append(reply('old\n\n```sh\nold\n```'))
  await $.session.append(reply('next please', 'prompt'))
  await $.session.append(reply('First:\n\n```ts\nconst a = 1\n```'))
  await $.session.append(reply('Then:\n\n```bash\nnpm test\n```'))
  const last = await run('copy')
  expect(last.text).toBe('Copied code block 2 of 2 (bash).')
  await run('copy 1')
  expect(copied).toEqual(['npm test', 'const a = 1'])
  expect((await run('copy 3')).text).toContain('pick 1 to 2')
  expect((await run('paste')).text).toContain('Usage')
})
