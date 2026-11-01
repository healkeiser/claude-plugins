import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { editorScheme, findRefs, refUrl, resolvePath, wholeRef } from './paths'

type On = Parameters<TestBody>[1]

const paths = (text: string) => findRefs(text).map(r => `${r.path}:${r.line}${r.col ? `:${r.col}` : ''}`)

test('finds relative, dotted and Windows paths with a line and a column', () => {
  expect(paths('see src/a.ts:42, then C:\\x\\y.py:10 and ./pkg/mod.rs:3:7.')).toEqual(['src/a.ts:42', 'C:\\x\\y.py:10', './pkg/mod.rs:3:7'])
  expect(paths('(../up/b.go:7) `~/notes.md:1` C:/Users/v/x.ts:5 Makefile.am:3')).toEqual(['../up/b.go:7', '~/notes.md:1', 'C:/Users/v/x.ts:5', 'Makefile.am:3'])
})

test('leaves times, ports, URLs, versions and ratios alone', () => {
  expect(paths('at 10:30, localhost:3000, http://x.io/a.ts:3, v1.2:3, 16:9, a.ts:0, a.ts:4x, key:val.ts:2')).toEqual([])
})

test('a whole inline-code span is a reference only when it is nothing else', () => {
  expect(wholeRef('src/a.ts:42')).toEqual({ path: 'src/a.ts', line: 42, col: undefined })
  expect(wholeRef('npm test src/a.ts:42')).toBeUndefined()
})

test('paths resolve against the folder, home and drive, with no dot steps', () => {
  expect(resolvePath('/repo', './src/../lib/a.ts')).toBe('/repo/lib/a.ts')
  expect(resolvePath('C:\\work\\repo', 'src\\a.ts')).toBe('C:/work/repo/src/a.ts')
  expect(resolvePath('/repo', 'D:\\x\\y.py')).toBe('D:/x/y.py')
  expect(resolvePath('/repo', '~/n.md', '/home/v')).toBe('/home/v/n.md')
})

test('a link opens in the editor at the line, or the file by its file URL', () => {
  const ref = { path: 'a.ts', line: 42, col: 7 }
  expect(refUrl('C:/x/a b.ts', ref, 'vscode')).toBe('vscode://file/C:/x/a%20b.ts:42:7')
  expect(refUrl('/repo/a.ts', { path: 'a.ts', line: 3 }, 'cursor')).toBe('cursor://file/repo/a.ts:3')
  expect(refUrl('C:/x/a.ts', ref, 'file')).toBe('file:///C:/x/a.ts')
  expect(editorScheme({ EDITOR: 'C:\\Program Files\\code.cmd --wait' })).toBe('vscode')
  expect(editorScheme({ VISUAL: 'nvim', TERM_PROGRAM: 'vscode' })).toBe('vscode')
  expect(editorScheme({ EDITOR: 'vim' })).toBe('file')
})

// A disk holding only the files named, and a session folder of /repo.
const disk = (on: On, files: string[]) => {
  mock.env(on, { EDITOR: 'code --wait' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.stat', (_, e) => {
    // The engine hands the path over in the machine's own spelling (C:\repo\a.ts on Windows).
    if (!files.includes(e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''))) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
  })
}

const mount = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })

test('a file:line in prose and in inline code links when the file exists, and only then', async ($, on) => {
  disk(on, ['/repo/src/a.ts'])
  const ui = await mount($, 'Fixed src/a.ts:42 and `src/a.ts:7:2`; src/gone.ts:3 is not there, nor `x.ts:1`.')
  const links = (await ui.findAll({ type: 'Link' })).map(l => l.props.href)
  expect(links).toEqual(['vscode://file/repo/src/a.ts:42', 'vscode://file/repo/src/a.ts:7:2'])
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(all).toContain('src/gone.ts:3 is not there')
  expect(all).toContain(' x.ts:1 ')
})

test('a prose line with no file reference is still the engine\'s', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await mount($, 'Meet at 10:30 on localhost:3000.')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine row'])
})
