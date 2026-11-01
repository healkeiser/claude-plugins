// Checks the design system across the mods (see DESIGN.md):
// 1. every mod's hooks/style.ts and hooks/style.test.ts are identical copies;
// 2. no hooks file or statusline.sh draws an emoji-capable glyph without U+FE0E;
// 3. every surface module ticks at style.ts's FRAME_MS.
// Run: node scripts/check-style.mjs   (exit 1 on any finding)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const MODS = ['gloss', 'pulse', 'postcard', 'flightdeck', 'filetree']
const problems = []

for (const file of ['style.ts', 'style.test.ts']) {
  const [first, ...rest] = MODS.map(m => ({ m, text: readFileSync(join(root, m, 'hooks', file), 'utf8') }))
  for (const other of rest) {
    if (other.text !== first.text) problems.push(`${other.m}/hooks/${file} differs from ${first.m}/hooks/${file}`)
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

const frame = /export const FRAME_MS = (\d+)/.exec(readFileSync(join(root, 'gloss', 'hooks', 'style.ts'), 'utf8'))?.[1]
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
