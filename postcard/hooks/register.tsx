import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PromptsQuery, PromptsSent, PromptsVersion } from '../types'
import { GLYPH, ROLE, SEP, asciiTree, clip, isAsciiGlyphs, remember } from './style'

// The you role: a prompt card never reads as one of gloss's grey code blocks.
const CARD = ROLE.you
// The command role: a slash command, typed or as the row its output prints, apart from a prompt.
const COMMAND = ROLE.command
const PANE = 'prompts'
// Prompts the pane lists, and rows seen, kept per session: the newest 500.
const KEEP = 500
// Prompt and command cards are the terminal's: desktop, VS Code and mobile draw
// your messages well already, so they stay native (DESIGN.md). The pane is everywhere.
const SURFACES = new Set(['terminal'])

const version = atom({ plugin: 'postcard', key: 'version' } as const, 0 as PromptsVersion)
const sent = atom({ plugin: 'postcard', key: 'sent' } as const, { ids: [], turnId: null, opener: '' } as PromptsSent)
const query = atom({ plugin: 'postcard', key: 'query' } as const, '' as PromptsQuery)
// Cells a pane row gives its ` edit re-send` buttons.
const ACTIONS = 13
// The engine's paste wrapper, a line of its own: the person never typed it.
const PASTE_TAG = /^\s*<\/?pasted_content\b[^>]*>\s*$/

/** A prompt as the person typed it: the engine's paste tag lines left out. */
export const untagged = (text: string): string => text.split(/\r?\n/).filter(l => !PASTE_TAG.test(l)).join('\n').trim()

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Whether `text` holds `q`, case-insensitive; an empty `q` matches all. */
export const matches = (text: string, q: string): boolean => new RegExp(escapeRe(q), 'i').test(untagged(text))

/** `line` cut around each case-insensitive match of `q`, the matches flagged. */
export function marks(line: string, q: string): { text: string; isMatch: boolean }[] {
  if (!q) return [{ text: line, isMatch: false }]
  return line.split(new RegExp(`(${escapeRe(q)})`, 'gi'))
    .map((text, k) => ({ text, isMatch: k % 2 === 1 }))
    .filter(m => m.text)
}

/**
 * The prompt one step from `at` in `ids` (transcript order): -1 the one before,
 * 1 the one after. `at` undefined, or gone, is the bottom of the transcript.
 * Undefined past either end.
 */
export function step(ids: readonly string[], at: string | undefined, dir: -1 | 1): string | undefined {
  const i = at === undefined ? -1 : ids.indexOf(at)
  return ids[(i < 0 ? ids.length : i) + dir]
}

/** Scrolls the transcript to a prompt's row; says so when it cannot. */
async function jump($: EngineInterface, id: string): Promise<boolean> {
  const moved = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
  if ('deny' in moved && moved.deny) {
    $.ui.toast(`Can't jump there: ${moved.deny}`)
    return false
  }
  return true
}

/** Jumps one prompt from `from`; resolves to where the transcript now stands. */
async function stepTo($: EngineInterface, ids: readonly string[], from: string | undefined, dir: -1 | 1) {
  const id = step(ids, from, dir)
  if (id === undefined) $.ui.toast(dir < 0 ? 'No earlier prompt.' : 'No later prompt.')
  return id !== undefined && (await jump($, id)) ? id : from
}

/** Puts an old prompt in the prompt box to change and send. A draft already
 * there is never written over: the person would lose it. */
async function edit($: EngineInterface, text: string) {
  if ((await $.prompt.read()).text.trim()) {
    $.ui.toast('The prompt box holds a draft. Send or clear it first.')
    return
  }
  const { isFilled } = await $.prompt.fill({ text: untagged(text) })
  $.ui.toast(isFilled ? 'In the prompt box: Esc to go there, change it and send.' : "Couldn't fill the prompt box.")
}

/** Sends an old prompt again, as the person's own words. Called only from the
 * re-send button's press, so nothing is sent without the person's action. */
async function resend($: EngineInterface, text: string) {
  await $.prompt.submit({ text: untagged(text), asUser: true })
  $.ui.toast('Sent again.')
}

// Splits a prompt into prose and fenced code, so a pasted block draws as code.
// A fence left open runs to the end, as Markdown reads it.
export function pieces(text: string): { text: string; language?: string }[] {
  const out: { text: string; language?: string }[] = []
  const prose: string[] = []
  // The engine wraps a paste in `<pasted_content>` tags for the model; the person
  // never typed them, so the card leaves them out.
  const lines = text.split(/\r?\n/).filter(l => !PASTE_TAG.test(l))
  const flush = () => {
    const t = prose.join('\n').replace(/^\n+|\n+$/g, '')
    if (t) out.push({ text: t })
    prose.length = 0
  }
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(lines[i]!)
    if (!open) {
      prose.push(lines[i]!)
      continue
    }
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j]!.trimStart().startsWith(open[1]!)) body.push(lines[j++]!)
    flush()
    out.push({ text: body.join('\n').replace(/^(\s*\n)+|\s+$/g, ''), language: open[2] ?? '' })
    i = j
  }
  flush()
  return out
}

export const register: Register = (on, options) => {
  // glyphs: text draws every tree of ours through asciiTree (DESIGN.md, Options).
  const isAscii = isAsciiGlyphs(options?.glyphs)
  const drawn = <T,>(tree: T): T => (isAscii ? asciiTree(tree) : tree)
  // The person's prompts in transcript order, as their rows were drawn. A row is
  // drawn again after a reload, so the list fills back up by itself.
  const prompts = new Map<string, string>()
  // The turn each prompt row was first drawn in: a row first drawn while a turn
  // runs, and not yet stored, is one the person queued.
  const firstSeen = new Map<string, string | null>()
  // The prompt the last jump landed on; undefined is the bottom, where a new
  // turn leaves the transcript.
  let at: string | undefined
  const ids = () => [...prompts.keys()]

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      at = undefined
      await update($, sent, s => ({ ...s, turnId: e.turnId, opener: e.text.trim() }))
    }
    return next(e)
  })

  // A typed prompt is stored with door `prompt`, a queued one with door `queue`
  // as it enters the queue (still unsent) and with door `delivery` once it
  // reaches the model. The `prompt` and `delivery` uuids are the sent rows' ids.
  // Awaited, so the id is recorded before the row it names is drawn.
  on('session.append', async ($, e, next) => {
    const isSent = e.agentId === undefined && e.message.role === 'user' &&
      (e.door === 'prompt' || e.door === 'delivery')
    if (isSent) await update($, sent, s => ({ ...s, ids: [...s.ids, e.uuid].slice(-500) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompts',
      description: 'List, search, re-send or edit the prompts you sent; prev and next jump between them',
      argumentHint: '[prev|next]',
    })
    return next(e)
  })

  on('command.run', { command: 'prompts' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'prev' || arg === 'next') {
      at = await stepTo($, ids(), at, arg === 'prev' ? -1 : 1)
      return {}
    }
    if (arg) return { text: 'Usage: /prompts, /prompts prev, /prompts next' }
    await update($, query, () => '')
    const { isPlaced } = await $.ui.open({ id: PANE, backgroundColor: 'transparent', title: 'Your prompts', focus: true })
    return { text: isPlaced ? 'Prompts pane opened.' : 'The prompts pane needs a wider window.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, version, n => n + 1)
      await update($, sent, s => ({ ...s, turnId: null, opener: '' }))
    }
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // Only the person's own prompts: typed here, or sent from another device.
    const kind = e.props.origin.kind
    if (kind !== 'composer' && kind !== 'bridge') return next(e)
    // Listed for the /prompts pane on every surface; a redraw keeps its place.
    if (prompts.has(e.requestId)) prompts.set(e.requestId, e.props.text)
    else remember(prompts, e.requestId, e.props.text, KEEP)
    if (!SURFACES.has(e.surface)) return next(e)

    const s = await read($, sent)
    if (!firstSeen.has(e.requestId)) remember(firstSeen, e.requestId, s.turnId, KEEP)
    // shortcut: the row carries no queued flag, so a row new in this turn is
    // queued until a sent id names it. A queued command stays queued until the
    // turn ends, when the engine runs it.
    const isQueued = s.turnId !== null && firstSeen.get(e.requestId) === s.turnId && !s.ids.includes(e.requestId) &&
      e.props.text.trim() !== s.opener

    const { Box, Text, Code } = $.ui.resolve(e)
    const isCommand = e.props.text.trimStart().startsWith('/')
    const color = isCommand ? COMMAND : CARD

    // Queued: a grey card only as wide as its text and set in, so it never
    // reads as a sent prompt.
    if (isQueued) {
      return drawn(
        <Box flexDirection="column" borderStyle="round" borderColor={ROLE.chrome} paddingX={1} marginLeft={4} alignSelf="flex-start">
          <Text dimColor italic>{`${GLYPH.stop} queued`}</Text>
          <Text dimColor>{e.props.text}</Text>
        </Box>
      )
    }

    return drawn(
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Text color={color} weight="bold">{isCommand ? 'command' : 'you'}</Text>
        {pieces(e.props.text).map((p, k) =>
          p.language === undefined ? (
            <Text key={`t${k}`}>{p.text}</Text>
          ) : (
            <Box key={`c${k}`} flexDirection="column" borderStyle="round" borderColor={ROLE.chrome} paddingX={1}>
              {p.language ? <Text dimColor italic>{p.language}</Text> : null}
              <Code source={p.text} language={p.language || undefined} />
            </Box>
          ),
        )}
      </Box>
    )
  })

  // A slash command's output row (`/diff`, `/cost`, a plugin's answer): a purple
  // card headed by the command, so commands read apart from prompts. The engine
  // draws the typed line itself; a command that prints nothing has no row.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!SURFACES.has(e.surface)) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const head = `/${e.props.command}${e.props.args ? ` ${e.props.args}` : ''}`
    const body = e.props.text.trim()
    return drawn(
      <Box flexDirection="column" borderStyle="round" borderColor={e.props.isErrored ? ROLE.error : COMMAND} paddingX={1}>
        <Text color={COMMAND} weight="bold">{e.props.isErrored ? `${GLYPH.fail} ${head}` : head}</Text>
        {body ? (e.props.isErrored ? <Text color={ROLE.error}>{body}</Text> : <Markdown text={body} />) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, version)
    const q = await read($, query)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const width = Math.max(10, e.props.bodyColumns - 8 - ACTIONS)
    const all = [...prompts].map(([id, text], n) => ({ id, text, n: n + 1 }))
    // Newest first, so the hotkeys 1 to 9 reach the recent ones.
    const list = all.filter(p => matches(p.text, q)).reverse()
    const search = (v: string) => update($, query, () => v)

    return drawn(
      <Box flexDirection="column" paddingTop={1}>
        {/* Mobile draws no Input yet: the list stands there unfiltered. */}
        {'Input' in els && (
          <els.Input
            key="search"
            placeholder="search your prompts"
            value={q}
            submitLabel="jump"
            autoFocus
            onInput={v => void search(v)}
            onSubmit={async v => {
              await search(v)
              const first = all.filter(p => matches(p.text, v)).at(-1)
              if (first) {
                if (await jump($, first.id)) at = first.id
              } else $.ui.toast('No prompt matches.')
            }}
          />
        )}
        {/* The person's chord for each action (ctrl+up, ctrl+down by default) presses it from the prompt while the pane is open. */}
        <Box flexDirection="row" marginBottom={1}>
          <Button key="prev" plain dimColor action="app:diffFileListUp" onPress={async () => { at = await stepTo($, ids(), at, -1) }}>prev</Button>
          <Text dimColor>{SEP}</Text>
          <Button key="next" plain dimColor action="app:diffFileListDown" onPress={async () => { at = await stepTo($, ids(), at, 1) }}>next</Button>
        </Box>
        {all.length === 0 && <Text dimColor>No prompts yet.</Text>}
        {all.length > 0 && list.length === 0 && <Text dimColor>No prompt matches.</Text>}
        {list.map((p, row) => {
          // The first line with words, or the first with the match while
          // searching; cut in cells by grapheme, so an emoji is never split.
          // shortcut: a match past the cut is not lit; show more of the line if it matters.
          const lines = untagged(p.text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
          const line = (q && lines.find(l => matches(l, q))) || lines[0] || ''
          return (
            <Box key={`r${p.n}`} flexDirection="row">
              <Box flexGrow={1}>
                <Button key={`p${p.n}`} plain hotkey={row < 9 ? String(row + 1) : undefined} onPress={async () => { if (await jump($, p.id)) at = p.id }}>
                  <Text color={CARD}>{`#${p.n} `}</Text>
                  {marks(clip(line, width), q).map(m => (m.isMatch ? <Text color={ROLE.accent}>{m.text}</Text> : m.text))}
                </Button>
              </Box>
              <Text> </Text>
              <Button key={`e${p.n}`} plain dimColor onPress={() => void edit($, p.text)}>edit</Button>
              <Text> </Text>
              <Button key={`s${p.n}`} plain dimColor onPress={() => void resend($, p.text)}>re-send</Button>
            </Box>
          )
        })}
      </Box>
    )
  })
}
