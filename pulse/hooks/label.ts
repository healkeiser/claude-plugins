import { seconds } from './style'

const base = (path: unknown) => String(path ?? '').split(/[\\/]/).pop() || 'file'

// One short phrase per tool call, for the band: on one line, as a multi-line
// description or command would push the band to several rows.
export function describe(e: { tool: string; [arg: string]: unknown }): string {
  return phrase(e).replace(/\s+/g, ' ').trim()
}

function phrase(e: { tool: string; [arg: string]: unknown }): string {
  switch (e.tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `editing ${base(e.file_path ?? e.notebook_path)}`
    case 'Write':
      return `writing ${base(e.file_path)}`
    case 'Read':
      return `reading ${base(e.file_path)}`
    case 'Grep':
    case 'Glob':
      return `searching ${String(e.pattern ?? '')}`
    case 'Bash':
    case 'PowerShell':
      return e.description ? String(e.description) : `running ${String(e.command ?? '').trim().split(/\s+/)[0]}`
    case 'Agent':
      return `agent: ${String(e.description ?? 'working')}`
    case 'WebFetch':
      try { return `fetching ${new URL(String(e.url)).host}` } catch { return 'fetching' }
    case 'WebSearch':
      return `searching the web`
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(e.tool)
  return mcp ? `${mcp[1]}: ${mcp[2]!.replace(/_/g, ' ')}` : e.tool
}

// What a folded run of tool calls did, by kind, in the order first seen.
const KINDS: [RegExp, string, string, string][] = [
  [/^(Read|NotebookRead)$/, '◇', 'read', 'reads'],
  [/^(Grep|Glob|LS)$/, '⌕', 'search', 'searches'],
  [/^(Bash|PowerShell)$/, '⌘', 'shell', 'shells'],
  [/^(WebFetch|WebSearch)$/, '⇣', 'fetch', 'fetches'],
  [/^mcp__/, '⧉', 'mcp call', 'mcp calls'],
]

export function summarize(calls: readonly { tool: string; isErrored: boolean }[]): { text: string; failed: number } {
  const counts = new Map<string, { icon: string; one: string; many: string; n: number }>()
  for (const c of calls) {
    const kind = KINDS.find(([re]) => re.test(c.tool))
    // A tool of no kind takes no glyph: a `·` there read as a doubled separator.
    const [icon, one, many] = kind ? kind.slice(1) as [string, string, string] : ['', c.tool, c.tool]
    const got = counts.get(one) ?? { icon, one, many, n: 0 }
    got.n += 1
    counts.set(one, got)
  }
  const text = [...counts.values()]
    .filter(k => k.one)
    .map(k => `${k.icon ? `${k.icon} ` : ''}${k.n} ${k.n === 1 ? k.one : k.many}`)
    .join('  ·  ')
  return { text, failed: calls.filter(c => c.isErrored).length }
}

/** Whole seconds as the band counts them: `42s`, `2m 05s`, `3h 12m`. */
export const elapsed = seconds
