// `file:line` references in a reply: found in text, resolved against the
// session's folder, and turned into a link an editor or the terminal opens.

/** A path followed by `:line` and maybe `:column`, as `src/a.ts:42` or `C:\x\y.py:10:3`. */
export type FileRef = { path: string; line: number; col?: number }

// Not after a word, a slash or a scheme's colon, so `https://x.io/a.ts:3`
// and `host:a.ts:3` are left alone; a path needs a separator or an extension,
// so `10:30` and `localhost:3000` are never one.
const REF = /(?<![\w/\\.:~@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*[\w@+-][\w.@+-]*):(\d+)(?::(\d+))?(?![\w:])/g

const isPathLike = (p: string) => /[\\/]/.test(p) || /\.[A-Za-z][\w]*$/.test(p)

/** Every `path:line` in `text`, with where it starts and ends. */
export function findRefs(text: string): (FileRef & { start: number; end: number })[] {
  const out: (FileRef & { start: number; end: number })[] = []
  for (const m of text.matchAll(REF)) {
    const [whole, path, line, col] = m
    if (!isPathLike(path!) || Number(line) < 1) continue
    out.push({ path: path!, line: Number(line), ...(col ? { col: Number(col) } : {}), start: m.index!, end: m.index! + whole.length })
  }
  return out
}

/** `text` when it is a `path:line` and nothing else, as inline code often is. */
export function wholeRef(text: string): FileRef | undefined {
  const [ref] = findRefs(text.trim())
  return ref && ref.start === 0 && ref.end === text.trim().length ? { path: ref.path, line: ref.line, col: ref.col } : undefined
}

const isAbsolute = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

/** The absolute path of `path`, with forward slashes and no `.` or `..` steps. */
export function resolvePath(cwd: string, path: string, home = ''): string {
  const raw = (/^~[\\/]/.test(path) && home ? `${home}/${path.slice(2)}` : isAbsolute(path) ? path : `${cwd}/${path}`).replace(/\\/g, '/')
  const drive = /^[A-Za-z]:/.exec(raw)?.[0] ?? ''
  const out: string[] = []
  for (const step of raw.slice(drive.length).split('/')) {
    if (step === '..') out.pop()
    else if (step && step !== '.') out.push(step)
  }
  return `${drive}/${out.join('/')}`
}

// Editors that answer a `<scheme>://file/<path>:<line>:<col>` link, by the
// command `VISUAL` or `EDITOR` names.
const SCHEMES: Record<string, string> = {
  code: 'vscode', 'code-insiders': 'vscode-insiders', cursor: 'cursor', windsurf: 'windsurf', codium: 'vscodium',
}

/** The URL scheme of the person's editor, from `VISUAL`/`EDITOR` and `TERM_PROGRAM`; `file` when none is known. */
export function editorScheme(env: { VISUAL?: string; EDITOR?: string; TERM_PROGRAM?: string }): string {
  for (const command of [env.VISUAL, env.EDITOR]) {
    // The program's own name: past its folder (which may hold spaces), before its flags.
    const name = /([^\\/"'\s]+?)(?:\.(?:exe|cmd|bat))?["']?(?:\s+-.*)?$/i.exec(command?.trim() ?? '')?.[1]?.toLowerCase()
    if (name && SCHEMES[name]) return SCHEMES[name]
  }
  return env.TERM_PROGRAM === 'vscode' ? 'vscode' : 'file'
}

/**
 * The link for an absolute path at a line: an editor's own URL, which opens
 * the file at that line, or a `file:` URL, which opens the file (no line).
 */
export function refUrl(abs: string, ref: FileRef, scheme: string): string {
  const path = encodeURI(abs.startsWith('/') ? abs : `/${abs}`)
  if (scheme === 'file') return `file://${path}`
  return `${scheme}://file${path}:${ref.line}${ref.col ? `:${ref.col}` : ''}`
}
