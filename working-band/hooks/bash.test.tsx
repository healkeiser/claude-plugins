import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { commandLine, preview, took } from './bash'

const ROW = {
  tool_use_id: 'b1',
  tool: 'Bash',
  input: { command: 'git status', description: 'Show working tree status' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}

const VIEWPORT = { columns: 60, rows: 30 }

async function draw($: Engine, props: object, requestId = 'b1') {
  const ui = await $.ui.mount({
    plugin: 'working-band', surface: 'terminal', component: 'ToolUse', requestId, viewport: VIEWPORT,
    props: { ...ROW, ...props },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return texts
}

test('a running call shows its headline, command and no output', async $ => {
  const texts = await draw($, { isRunning: true })
  const all = texts.join('\n')
  expect(all).toContain('Show working tree status')
  expect(all).toContain('$ git status')
  expect(all).not.toContain('└')
  expect(all).not.toContain('✔')
})

test('a finished call previews stdout, counts the rest and shows its time', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let id = ''
  on('tool.call', async (_, e) => {
    id = e.tool_use_id
    await clock.advance(1400)
    return { result: { stdout: 'a\nb\nc\nd\n', stderr: '' } }
  })
  await $.tool.call({ tool: 'Bash', command: 'git log' })

  const all = (await draw($, { output: { stdout: '\nbb43e7c feat(vfx): bundle\nx\ny\nz\n', stderr: '', interrupted: false } }, id)).join('\n')
  expect(all).toContain('✔ 1.4s')
  expect(all).toContain('└ ')
  expect(all).toContain('bb43e7c feat(vfx): bundle')
  expect(all).toContain('+3 lines')
})

test('without a recorded time a finished call shows a bare check', async $ => {
  const all = (await draw($, { output: { stdout: 'ok', stderr: '' } })).join('\n')
  expect(all).toContain('✔')
  expect(all).not.toContain('+')
})

test('stderr is previewed when stdout is empty', async $ => {
  const all = (await draw($, { output: { stdout: '', stderr: 'warning: x\nmore' } })).join('\n')
  expect(all).toContain('warning: x')
  expect(all).toContain('+1 line')
})

test('an errored call is marked and leaves its text to the result row', async $ => {
  const all = (await draw($, { isErrored: true, output: 'Exit code 1\nfatal: not a git repository' })).join('\n')
  expect(all).toContain('✕')
  expect(all).not.toContain('fatal')
})

test('an interrupted call says so', async $ => {
  const all = (await draw($, { isErrored: true, isInterrupted: true })).join('\n')
  expect(all).toContain('⏸ interrupted')
})

test('a long command under a home folder is shortened to the width', async $ => {
  const command = 'cd C:\\Users\\valen\\Documents\\GitHub\\claude-plugins-vfx && git show main:.claude-plugin/marketplace.json | head -50'
  const texts = await draw($, { input: { command, description: 'Rebase' } })
  const line = texts.find(t => t.includes('$ '))!
  expect(line).toContain('~\\…\\claude-plugins-vfx')
  expect(line.length).toBeLessThanOrEqual(VIEWPORT.columns)
  expect(line.endsWith('…')).toBe(true)
})

test('a heredoc shows its first line', async $ => {
  const all = (await draw($, { input: { command: "cat > /home/v/x.txt <<'EOF'\nhello\nEOF" } })).join('\n')
  expect(all).toContain("$ cat > ~/x.txt <<'EOF' …")
  expect(all).not.toContain('hello')
  // No description: the command's first word stands in.
  expect(all).toContain('running cat')
})

test('expanded rows and other tools are the engine’s', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  expect(await draw($, { isExpanded: true })).toEqual(['engine'])
  expect(await draw($, { tool: 'Read', input: { file_path: 'a' } })).toEqual(['engine'])
})

test('the result row is hidden for a compact Bash row, kept for errors', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const result = async (props: object) => {
    const ui = await $.ui.mount({
      plugin: 'working-band', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
      props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: 'x', stderr: '' }, isErrored: false, ...props },
    } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    return texts
  }
  expect(await result({})).toEqual([])
  expect(await result({ isErrored: true })).toEqual(['engine'])
  expect(await result({ isExpanded: true })).toEqual(['engine'])
})

test('pieces of the row', () => {
  expect(commandLine('ls /Users/val/a', 80)).toBe('$ ls ~/a')
  expect(commandLine('ls C:/Users/val/a/b/c/d.txt', 12)).toBe('$ ls ~/…/d.…')
  expect(commandLine('cat /c/Users/val/x', 80)).toBe('$ cat ~/x')
  expect(commandLine('ls /mnt/home/x', 80)).toBe('$ ls /mnt/home/x')
  expect(preview({ stdout: '\x1b[32mok\x1b[0m\n', stderr: '' })).toEqual({ first: 'ok', more: 0, isStderr: false })
  expect(preview('Exit code 1')).toBe(null)
  expect(took(1400)).toBe('1.4s')
  expect(took(125_000)).toBe('2m 05s')
})
