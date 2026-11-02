// Checks the design system across the mods (see DESIGN.md):
// 1. every mod's hooks/style.ts, style.test.ts and kit.tsx are exact copies of
//    shared/ (the one source; `--write` copies shared/ into every mod);
// 1b. no mod draws its own search field or card frame: both go through kit.tsx;
// 2. no hooks file or statusline.sh draws an emoji-capable glyph without U+FE0E;
// 3. every surface module ticks at style.ts's FRAME_MS.
// Run: node scripts/check-style.mjs [--write]   (exit 1 on any finding)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const MODS = ['gloss', 'pulse', 'postcard', 'flightdeck', 'filetree']
const problems = []

const SHARED = ['style.ts', 'style.test.ts', 'kit.tsx', 'app.tsx']
const isWrite = process.argv.includes('--write')
for (const file of SHARED) {
  const source = readFileSync(join(root, 'shared', file), 'utf8')
  for (const m of MODS) {
    const path = join(root, m, 'hooks', file)
    let copy = ''
    try { copy = readFileSync(path, 'utf8') } catch {}
    if (copy === source) continue
    if (isWrite) writeFileSync(path, source)
    else problems.push(`${m}/hooks/${file} differs from shared/${file} (edit shared/, then run with --write)`)
  }
}

// The same rule as bareEmoji in style.ts.
const bare = text => {
  const out = []
  const chars = [...text]
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0)
    if (cp < 0x80 || cp === 0xfe0e || cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) return
    if (/\p{Emoji}/u.test(ch) && chars[i + 1] !== '︎') out.push(ch)
  })
  return out
}
// Source spells U+FE0E as an escape as often as the character itself.
const unescape = line => line.replace(/\\uFE0E|\\u\{FE0E\}/gi, '︎')

const walk = dir =>
  readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const sources = [
  ...MODS.flatMap(m => walk(join(root, m, 'hooks')).filter(p => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))),
  join(root, 'statusline', 'statusline.sh'),
]
for (const path of sources) {
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    // A comment may name a glyph to say why it is not drawn; a line marked
    // glyph-lint-ignore holds glyphs that are never drawn as text.
    if (line.includes('glyph-lint-ignore')) return
    const code = line.replace(/^\s*(\/\/|\*|#).*$/, '')
    for (const ch of bare(unescape(code))) {
      problems.push(`${relative(root, path)}:${i + 1}: ${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase()}) without U+FE0E`)
    }
  })
}

for (const path of sources) {
  if (/kit\.tsx$/.test(path)) continue
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/<(els.)?Input|'⌕ /.test(line)) problems.push(`${relative(root, path)}:${i + 1}: draws its own search field; use search() from kit.tsx`)
    if (/borderStyle(=|: )["']round/.test(line)) problems.push(`${relative(root, path)}:${i + 1}: draws its own card frame; use cardFrame() from kit.tsx`)
  })
}

const frame = /export const FRAME_MS = (\d+)/.exec(readFileSync(join(root, 'shared', 'style.ts'), 'utf8'))?.[1]
for (const path of MODS.flatMap(m => walk(join(root, m, 'hooks')))) {
  const text = readFileSync(path, 'utf8')
  if (!/ClientModule/.test(text)) continue
  for (const m of text.matchAll(/surface\.every\((\w+)/g)) {
    const value = new RegExp(`const ${m[1]} = (\\d+)`).exec(text)?.[1]
    if (value !== undefined && value !== frame && value !== '1000') {
      problems.push(`${relative(root, path)}: ${m[1]} = ${value}, not FRAME_MS (${frame}) or a whole second`)
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`style: ${MODS.length} identical copies, ${sources.length} files free of emoji-capable glyphs, surface ticks at ${frame} ms`)
