// Pieces of the compact Bash row: its command line, output preview and time.
import { cellWidth, clip, duration } from './style'

export { clip }

// A home folder anywhere in a command: C:\Users\x, C:/Users/x, /c/Users/x,
// /home/x, /Users/x. shortcut: a home elsewhere (/root, a custom one) stays
// spelled out; read $HOME / %USERPROFILE% if that matters.
const HOME = /(?<![\w.~-])(?:[a-z]:[\\/]users[\\/]|\/[a-z]\/users\/|\/(?:home|users)\/)[^\\/\s'"`;|&]+/gi
// Two or more folders between `~` and a path's last part.
const MIDDLE = /~((?:[\\/][^\\/\s'"]+){2,})([\\/][^\\/\s'"]+)/g
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

export const tildify = (s: string) => s.replace(HOME, '~')

/** `$ cd ~/…/repo && git status`, one line, at most `width` cells. */
export function commandLine(command: string, width: number): string {
  const lines = command.trim().split('\n')
  let line = `$ ${tildify(lines[0]!.trimEnd())}${lines.length > 1 ? ' …' : ''}`
  // The middle of a path says least: drop it only when the line is too long.
  if (cellWidth(line) > width) line = line.replace(MIDDLE, (_, _middle, last: string) => `~${last[0]}…${last}`)
  return clip(line, width)
}

/** The first non-empty line of stdout, else of stderr, and how many follow. */
export function preview(output: unknown): { first: string; more: number; isStderr: boolean } | null {
  if (typeof output !== 'object' || output === null) return null
  const { stdout, stderr } = output as { stdout?: unknown; stderr?: unknown }
  const isStderr = !String(stdout ?? '').trim()
  const lines = String((isStderr ? stderr : stdout) ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map(l => l.replace(/\t/g, '  ').trimEnd())
    .filter(Boolean)
  return lines.length ? { first: lines[0]!, more: lines.length - 1, isStderr } : null
}

/** `1.4s` under ten seconds, then as the band counts: `42s`, `2m 05s`. */
export const took = duration
