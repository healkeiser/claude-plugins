// What the copy menu puts on the clipboard: a block as written, fenced, as one
// shell line; a table as Markdown or TSV.

/** The block inside a Markdown fence long enough that no run of backticks in it closes it. */
export function fenced(language: string, source: string): string {
  const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map(m => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${source}\n${fence}`
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'fish', 'ksh', 'powershell', 'pwsh', 'ps1', 'ps', 'cmd', 'bat', 'batch'])
const POWERSHELL = new Set(['powershell', 'pwsh', 'ps1', 'ps'])
// A line ending in one of these goes on with the next: join with a space.
const CONTINUES = /(\|\||&&|\||\(|\{|\bthen|\bdo|\belse|\bin)$/

/**
 * A shell block as one line to paste at a prompt, or null when one line would
 * not mean the same (a heredoc) or the block is not a multi-line shell block.
 * Prompts (`$ `) and comment lines are dropped; `\` and PowerShell's backtick
 * continue a line; other lines run one after another, stopping at the first
 * failure (`&&`) unless the block has its own control flow or is PowerShell (then `;`).
 */
export function oneLine(source: string, language: string): string | null {
  const lang = language.toLowerCase()
  if (!SHELLS.has(lang)) return null
  if (/<<-?\s*['"]?\w+/.test(source) || /@['"]\s*$/m.test(source)) return null
  const isPwsh = POWERSHELL.has(lang)
  const isCmd = lang === 'cmd' || lang === 'bat' || lang === 'batch'
  const lines = source.split('\n')
    .map(l => l.replace(/^\s*(?:\$|PS [^>]*>|>)\s+/, '').trim())
    .filter(l => l && !(isCmd ? /^(rem\s|::)/i : /^#/).test(l))
  if (lines.length < 2) return null
  const hasFlow = lines.some(l => /^(if|for|while|until|case|function|select|foreach|switch|try)\b|^\}|^(fi|done|esac)\b/.test(l))
  // Windows PowerShell 5 has no `&&`.
  const between = hasFlow || isPwsh ? '; ' : ' && '
  let out = ''
  for (const line of lines) {
    if (!out) out = line
    else if (/[\\`]$/.test(out)) out = `${out.slice(0, -1).trimEnd()} ${line}`
    else if (CONTINUES.test(out) || (isPwsh && /^\|/.test(line))) out = `${out} ${line}`
    else out = `${out}${between}${line}`
  }
  return out.replace(/[\\`]$/, '').trimEnd()
}

/** A Markdown table's cells as tab-separated rows, the rule row left out, Markdown marks kept. */
export function tsv(source: string): string {
  return source.split('\n')
    .filter((_, k) => k !== 1)
    .map(row => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')).join('\t'))
    .join('\n')
}

