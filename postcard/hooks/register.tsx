import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PromptsCursor, PromptsQuery, PromptsQueue, PromptsSent, PromptsSentAt, PromptsShell, PromptsShellRun, PromptsTab, PromptsVersion, QueuedPrompt } from '../types'
import { isQueueable, moveQueued } from './queue'
import { SPACE, actionsWidth, card, cardFrame, header, kit, nerdFont, search as kitSearch, space, tabs } from './kit'
import type { Kit } from './kit'
import { GLYPH, ROLE, glyphSet, glyphTree, cellWidth, clip, isAsciiGlyphs, padCells, remember, span } from './style'

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
const sentAt = atom({ plugin: 'postcard', key: 'sentAt' } as const, {} as PromptsSentAt)
const cursor = atom({ plugin: 'postcard', key: 'cursor' } as const, null as PromptsCursor)
const shell = atom({ plugin: 'postcard', key: 'shell' } as const, [] as PromptsShell)
const tab = atom({ plugin: 'postcard', key: 'tab' } as const, 'prompts' as PromptsTab)
const NO_QUEUE: PromptsQueue = { items: [], isHeld: false }
const queue = atom({ plugin: 'postcard', key: 'queue' } as const, NO_QUEUE)
// Where the queue outlives the session (`$.store`): a new session gets it back held.
const QUEUE_STORE = 'queue'
let queueSeq = 0
// Shell commands the Shell tab keeps, and the cells its row gives ` copy run`.
const SHELL_KEEP = 200
const SHELL_ACTIONS = 9
// The cells the engine draws a row's hotkey in, `1: `, before its label.
const HOTKEY = 3
// Cells a pane row gives its ` edit re-send` buttons.
const ACTIONS = 13
// Cells a pane row keeps for the prompt's words before it drops its age, then its actions.
const MIN_TEXT = 16
// The pane's header chip.
const TITLE = 'Prompts'
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

/** Marks where the last jump landed (the `cursor` atom, so the pane marks it);
 * undefined is the bottom, where a new turn leaves the transcript. */
async function land($: EngineInterface, id: string | undefined) {
  await update($, cursor, () => id ?? null)
}

/** Jumps one prompt from the cursor, and moves the cursor there. */
async function walk($: EngineInterface, ids: readonly string[], dir: -1 | 1) {
  await land($, await stepTo($, ids, (await read($, cursor)) ?? undefined, dir))
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

/**
 * Puts a shell command in the prompt box as `!command`, so Enter runs it in the person's own shell.
 * Never run from here, and a draft is never written over.
 */
async function rerun($: EngineInterface, command: string) {
  if ((await $.prompt.read()).text.trim()) {
    $.ui.toast('The prompt box holds a draft. Send or clear it first.')
    return
  }
  const { isFilled } = await $.prompt.fill({ text: `!${command}` })
  $.ui.toast(isFilled ? 'In the prompt box: Enter runs it in your shell.' : "Couldn't fill the prompt box.")
}

/** Changes the queue and keeps it in the store, so a restart does not lose a waiting prompt. */
async function setQueue($: EngineInterface, fn: (q: PromptsQueue) => PromptsQueue) {
  await update($, queue, fn)
  await $.store.set(QUEUE_STORE, await read($, queue)).catch(() => undefined)
}

/** Sends the first waiting prompt as the person's own words; it runs once the session is idle. */
async function sendNext($: EngineInterface) {
  const first = (await read($, queue)).items[0]
  if (!first) return
  await setQueue($, q => ({ ...q, items: q.items.slice(1) }))
  await $.prompt.submit({ text: first.text, asUser: true })
}

/** Takes a waiting prompt out of the queue into an empty prompt box, to change it there. */
async function editQueued($: EngineInterface, item: QueuedPrompt) {
  if ((await $.prompt.read()).text.trim()) {
    $.ui.toast('The prompt box holds a draft. Send or clear it first.')
    return
  }
  await setQueue($, q => ({ ...q, items: q.items.filter(x => x.id !== item.id) }))
  const { isFilled } = await $.prompt.fill({ text: item.text })
  $.ui.toast(isFilled ? 'Out of the queue, in the prompt box: change it and send.' : "Couldn't fill the prompt box.")
}

/** Holds the queue, or lets it go again: resumed while Claude is idle, the next prompt is sent now. */
async function toggleHold($: EngineInterface) {
  await setQueue($, q => ({ ...q, isHeld: !q.isHeld }))
  const q = await read($, queue)
  if (!q.isHeld && (await read($, sent)).turnId === null) await sendNext($)
}

/**
 * The queue's rows: its place, the prompt's first line cut whole, then ↑ ↓ to
 * reorder, edit to take it back to the prompt box, ✕ to drop it. `w` the cells
 * the rows have.
 */
function queueRows($: EngineInterface, k: Kit, q: PromptsQueue, w: number, keyOf: string) {
  const { Box, Text, Button } = k.els
  const ACT = 15
  const hasActions = w - ACT >= 12
  const textW = Math.max(1, w - 3 - (hasActions ? ACT : 0))
  return q.items.map((item, i) => {
    const line = untagged(item.text).split(/\r?\n/).find(l => l.trim()) ?? item.text
    return (
      <Box key={`${keyOf}-${item.id}`} flexDirection="row">
        <Text color={ROLE.chrome} tabular>{`${i + 1}`.padStart(2)}</Text>
        <Box width={textW} marginLeft={1} flexShrink={0}>
          <Text {...(q.isHeld ? { dimColor: true } : {})}>{clip(line, textW)}</Text>
        </Box>
        {hasActions && (
          <Box flexDirection="row" marginLeft={1} flexShrink={0} columnGap={1}>
            <Button key={`${keyOf}-up-${i}`} plain dimColor label="↑" onPress={() => void setQueue($, x => ({ ...x, items: moveQueued(x.items, item.id, -1) }))} />
            <Button key={`${keyOf}-down-${i}`} plain dimColor label="↓" onPress={() => void setQueue($, x => ({ ...x, items: moveQueued(x.items, item.id, 1) }))} />
            <Button key={`${keyOf}-edit-${i}`} plain dimColor label="edit" onPress={() => void editQueued($, item)} />
            <Button key={`${keyOf}-drop-${i}`} plain dimColor label="✕" onPress={() => void setQueue($, x => ({ ...x, items: x.items.filter(y => y.id !== item.id) }))} />
          </Box>
        )}
      </Box>
    )
  })
}

/** The queue's own controls: hold or resume, and clear. */
function queueActions($: EngineInterface, k: Kit, q: PromptsQueue, keyOf: string) {
  const { Box, Button } = k.els
  return (
    <Box flexDirection="row" columnGap={2} flexShrink={0}>
      <Button key={`${keyOf}-hold`} plain dimColor label={q.isHeld ? 'resume' : 'hold'} onPress={() => void toggleHold($)} />
      <Button key={`${keyOf}-clear`} plain dimColor label="clear" onPress={() => void setQueue($, x => ({ ...x, items: [] }))} />
    </Box>
  )
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
  // Every tree of ours is drawn in the glyph set `glyphs` and the font call for (glyphTree, DESIGN.md Options).
  const isAscii = isAsciiGlyphs(options?.glyphs)
  // Whether a Nerd Font draws here (kit's nerdFont), read once a session: `glyphs: auto` draws its icons.
  let hasNerd = false
  const drawn = <T,>(tree: T, surface = 'terminal'): T => glyphTree(tree, glyphSet(options?.glyphs, hasNerd, surface))
  // The person's prompts in transcript order, as their rows were drawn. A row is
  // drawn again after a reload, so the list fills back up by itself.
  const prompts = new Map<string, string>()
  // The turn each prompt row was first drawn in: a row first drawn while a turn
  // runs, and not yet stored, is one the person queued.
  const firstSeen = new Map<string, string | null>()
  const ids = () => [...prompts.keys()]

  const isOurQueue = options?.queue !== 'engine'

  // A prompt typed while Claude works waits in postcard's queue, not the engine's: it can be seen,
  // reordered, edited, held or dropped, and the next is sent when the turn ends. If this hook fails,
  // the prompt goes on to the engine's queue: it is never lost.
  // When a prompt the person sent was let through, until its turn starts: in that gap (its
  // UserPromptSubmit hooks run) no turn is running yet, but the next prompt must wait all the same.
  // 10 s at most, so a prompt that never starts a turn cannot hold the queue.
  let sentAtMs: number | null = null
  on('prompt.submit', async ($, e, next) => {
    if (!isOurQueue || e.origin.kind !== 'composer' || !isQueueable(e.text)) return next(e)
    const at = await $.clock.now()
    const isBusy = e.turnId !== undefined || (sentAtMs !== null && at - sentAtMs < 10_000)
    if (!isBusy) {
      sentAtMs = at
      return next(e)
    }
    const item: QueuedPrompt = { id: `q${at}-${(queueSeq += 1)}`, text: e.text, at }
    await setQueue($, q => ({ ...q, items: [...q.items, item] }))
    // A dropped prompt stays in the box: once the drop has landed, empty it, but only while it still
    // holds exactly what was queued, so nothing else the person typed is ever wiped.
    void $.clock
      .sleep(30)
      .then(() => $.prompt.read())
      .then(box => (box.text.trim() === e.text.trim() ? $.prompt.fill({ text: '' }) : undefined))
      .catch(() => undefined)
    return { drop: 'Queued.' }
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      sentAtMs = null
      await land($, undefined)
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
    if (isSent) {
      await update($, sent, s => ({ ...s, ids: [...s.ids, e.uuid].slice(-KEEP) }))
      // When it was sent, for the pane's age column: a row carries no time of its own.
      const now = await $.clock.now()
      await update($, sentAt, m => Object.fromEntries([...Object.entries(m), [e.uuid, now] as const].slice(-KEEP)))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    hasNerd = (await nerdFont($).catch(() => 'missing' as const)) === 'ok'
    // A queue left by an earlier session comes back held: nothing is sent without the person.
    const saved = (await $.store.get(QUEUE_STORE).catch(() => undefined)) as Partial<PromptsQueue> | undefined
    if (saved && Array.isArray(saved.items) && saved.items.length) {
      const items = saved.items.filter((x): x is QueuedPrompt => typeof x?.id === 'string' && typeof x?.text === 'string' && typeof x?.at === 'number')
      if (items.length) await update($, queue, () => ({ items, isHeld: true }))
    }
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
      await walk($, ids(), arg === 'prev' ? -1 : 1)
      return {}
    }
    if (arg) return { text: 'Usage: /prompts, /prompts prev, /prompts next' }
    await update($, query, () => '')
    const { isPlaced } = await $.ui.open({ id: PANE, backgroundColor: 'transparent', title: 'Prompts', focus: true })
    return { text: isPlaced ? 'Prompts pane opened.' : 'The prompts pane needs a wider window.' }
  })

  // The Shell tab: each command Claude runs in the main loop, timed, and how it ended.
  on('tool.call', async ($, e, next) => {
    if ((e.tool !== 'Bash' && e.tool !== 'PowerShell') || e.agentId !== undefined) return next(e)
    const command = String((e as { command?: unknown }).command ?? '').trim()
    if (!command) return next(e)
    const at = await $.clock.now()
    const id = e.tool_use_id
    const run: PromptsShellRun = { id, command, at, ms: null, state: 'running' }
    await update($, shell, l => [...l.filter(x => x.id !== id), run].slice(-SHELL_KEEP))
    const ran = await next(e)
    const ms = (await $.clock.now()) - at
    const state: PromptsShellRun['state'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'fail' : 'ok'
    await update($, shell, l => l.map(x => (x.id === id ? { ...x, ms, state } : x)))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, version, n => n + 1)
      await update($, sent, s => ({ ...s, turnId: null, opener: '' }))
      // The queue: after an interrupt it holds, so the person decides what comes next; else the next goes.
      const q = await read($, queue)
      if (q.items.length && e.isAborted && !q.isHeld) {
        await setQueue($, x => ({ ...x, isHeld: true }))
        $.ui.toast('Queue held after the interrupt: resume it above the prompt.')
      } else if (q.items.length && !q.isHeld) await sendNext($)
    }
    return next(e)
  })

  // The queue above the prompt, a grey card like a queued prompt's: what waits, in order, and its controls.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const q = await read($, queue)
    if (!isOurQueue || q.items.length === 0 || e.props.hasSurvey) return next(e)
    const below = await next(e).catch(() => undefined)
    const k = kit($.ui.resolve(e), e.surface, { ascii: isAscii })
    const { Box } = k.els
    const w = Math.max(16, e.props.bodyColumns - 4)
    return (
      <Box flexDirection="column">
        {drawn(
          card(
            k,
            {
              key: 'queue-card',
              role: q.isHeld ? ROLE.warning : ROLE.chrome,
              title: `Queued ${GLYPH.dot} ${q.items.length}${q.isHeld ? ` ${GLYPH.dot} held` : ''}`,
              status: queueActions($, k, q, 'band'),
            },
            ...queueRows($, k, q, w, 'band'),
          ),
        )}
        {below ?? null}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // Only the person's own prompts: typed here, or sent from another device.
    // A prompt postcard's queue sent stays the engine's to draw: Claude Code names the plugin that sent it, by design.
    const kind = e.props.origin.kind
    if (kind !== 'composer' && kind !== 'bridge') return next(e)
    const s = await read($, sent)
    if (!firstSeen.has(e.requestId)) remember(firstSeen, e.requestId, s.turnId, KEEP)
    // shortcut: the row carries no queued flag, so a row new in this turn is
    // queued until a sent id names it. A queued command stays queued until the
    // turn ends, when the engine runs it.
    const isQueued = s.turnId !== null && firstSeen.get(e.requestId) === s.turnId && !s.ids.includes(e.requestId) &&
      e.props.text.trim() !== s.opener
    // Listed for the /prompts pane on every surface; a redraw keeps its place. A queued
    // card is not listed: once sent, the prompt is drawn again under its stored id, and
    // listing both showed it twice.
    if (isQueued) prompts.delete(e.requestId)
    else if (prompts.has(e.requestId)) prompts.set(e.requestId, e.props.text)
    else remember(prompts, e.requestId, e.props.text, KEEP)
    if (!SURFACES.has(e.surface)) return next(e)

    const { Box, Text, Code } = $.ui.resolve(e)
    const isCommand = e.props.text.trimStart().startsWith('/')
    const color = isCommand ? COMMAND : CARD

    // Queued: a grey card only as wide as its text and set in, so it never
    // reads as a sent prompt.
    if (isQueued) {
      return drawn(
        <Box {...cardFrame(ROLE.chrome)} marginLeft={4} alignSelf="flex-start">
          <Text dimColor italic>{`${GLYPH.stop} Queued`}</Text>
          <Text dimColor>{e.props.text}</Text>
        </Box>
      )
    }

    return drawn(
      <Box {...cardFrame(color)}>
        <Text color={color} weight="bold">{isCommand ? 'Command' : 'You'}</Text>
        {pieces(e.props.text).map((p, k) =>
          p.language === undefined ? (
            <Text key={`t${k}`}>{p.text}</Text>
          ) : (
            <Box key={`c${k}`} {...cardFrame(ROLE.chrome)}>
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
      <Box {...cardFrame(e.props.isErrored ? ROLE.error : COMMAND)}>
        <Text color={COMMAND} weight="bold">{e.props.isErrored ? `${GLYPH.fail} ${head}` : head}</Text>
        {body ? (e.props.isErrored ? <Text color={ROLE.error}>{body}</Text> : <Markdown text={body} />) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, version)
    const q = await read($, query)
    const times = await read($, sentAt)
    const cur = await read($, cursor)
    // shortcut: ages are as of the last redraw (a turn, a search, a jump); tick them if they need to be live.
    const now = Object.keys(times).length ? await $.clock.now() : 0
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const k = kit(els, e.surface, { ascii: isAscii })
    const open = await read($, tab)
    const runs = open === 'shell' ? await read($, shell) : []
    const waiting = await read($, queue)
    const all = [...prompts].map(([id, text], n) => ({ id, text, n: n + 1, age: id in times ? span(Math.max(1, now - times[id]!)) : '' }))
    // Newest first, so the hotkeys 1 to 9 reach the recent ones.
    const list = all.filter(p => matches(p.text, q)).reverse()
    const search = (v: string) => update($, query, () => v)

    const inner = Math.max(8, e.props.bodyColumns)
    // The person's chord for each action (ctrl+up, ctrl+down by default) presses it from the prompt while the pane is open.
    // The header's actions go first when the title and count do not fit beside them.
    // The open tab's own count: prompts, or shell commands.
    const shown = open === 'shell' ? [...runs].reverse().filter(r => matches(r.command, q)) : []
    const detail =
      open === 'shell'
        ? q ? `${shown.length} of ${runs.length}` : `${runs.length}`
        : q ? `${list.length} of ${all.length}` : `${all.length}`
    const actions = [
      { id: 'prev', label: 'prev', action: 'app:diffFileListUp', onPress: () => walk($, ids(), -1) },
      { id: 'next', label: 'next', action: 'app:diffFileListDown', onPress: () => walk($, ids(), 1) },
    ]
    const hasMeta = inner >= cellWidth(` ${TITLE} `) + 1 + cellWidth(detail) + 3 + actionsWidth(actions)
    // Row columns: cursor mark, number, words, age, actions. Narrow, the age goes, then the actions, then words.
    const numW = cellWidth(`#${all.length}`)
    const ageW = Math.max(0, ...list.map(p => cellWidth(p.age)))
    // The engine draws a row's hotkey before it (`1: `): three cells the words do not have.
    const room = inner - 2 - HOTKEY - numW - 1
    const hasActions = room - ACTIONS >= MIN_TEXT
    const hasAge = ageW > 0 && room - ACTIONS - ageW - 1 >= MIN_TEXT
    const textW = Math.max(1, room - (hasActions ? ACTIONS : 0) - (hasAge ? ageW + 1 : 0))

    // The Shell tab: newest first; status, the command's first line cut whole, its time, then copy and run.
    const shellList = (rows: readonly PromptsShellRun[], total: number, at: number) => {
      const ageOf = (r: PromptsShellRun) => (r.state === 'running' ? 'running' : span(Math.max(1, at - r.at)))
      const ageW2 = Math.max(0, ...rows.map(r => cellWidth(ageOf(r))))
      const room2 = inner - 2 - HOTKEY
      const hasRun = room2 - SHELL_ACTIONS >= MIN_TEXT
      const hasAge2 = room2 - SHELL_ACTIONS - ageW2 - 1 >= MIN_TEXT
      const cmdW = Math.max(1, room2 - (hasRun ? SHELL_ACTIONS : 0) - (hasAge2 ? ageW2 + 1 : 0))
      const mark = (r: PromptsShellRun) =>
        r.state === 'running' ? { glyph: GLYPH.live, color: ROLE.accent }
          : r.state === 'ok' ? { glyph: GLYPH.ok, color: ROLE.success }
          : r.state === 'fail' ? { glyph: GLYPH.fail, color: ROLE.error }
          : { glyph: GLYPH.fail, color: ROLE.chrome }
      return (
        <Box key="shell" flexDirection="column">
          {total === 0 && <Text dimColor>No shell commands yet.</Text>}
          {total > 0 && rows.length === 0 && <Text dimColor>No command matches.</Text>}
          {rows.map((r, row) => {
            const m = mark(r)
            const line = r.command.split(/\r?\n/).find(l => l.trim()) ?? r.command
            return (
              <Box key={`sh-${r.id}`} flexDirection="row">
                <Text color={m.color}>{`${m.glyph} `}</Text>
                <Box width={HOTKEY + cmdW} flexShrink={0}>
                  <Button key={`c${row}`} plain hotkey={row < 9 ? String(row + 1) : undefined} onPress={press => void $.ui.copy({ text: r.command, surface: press.surface }).then(x => $.ui.toast(x.isCopied ? 'Copied.' : "Couldn't copy."))}>
                    {marks(clip(line, cmdW), q).map(x => (x.isMatch ? <Text color={ROLE.accent}>{x.text}</Text> : x.text))}
                  </Button>
                </Box>
                {hasAge2 && (
                  <Box width={ageW2} marginLeft={1} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor tabular>{ageOf(r)}</Text>
                  </Box>
                )}
                {hasRun && (
                  <Box flexDirection="row" marginLeft={1} flexShrink={0}>
                    <Button key={`y${row}`} plain dimColor onPress={press => void $.ui.copy({ text: r.command, surface: press.surface }).then(x => $.ui.toast(x.isCopied ? 'Copied.' : "Couldn't copy."))}>copy</Button>
                    <Text> </Text>
                    <Button key={`x${row}`} plain dimColor onPress={() => void rerun($, r.command)}>run</Button>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    return drawn(
      <Box flexDirection="column" paddingTop={SPACE.top}>
        {header(k, { title: TITLE, detail, actions: hasMeta ? actions : [] })}
        {space(k, 'gap-head')}
        {/* Mobile draws no Input yet: the list stands there unfiltered. */}
        {kitSearch(k, {
          value: q,
          placeholder: open === 'shell' ? "search Claude's shell commands" : 'search your prompts',
          autoFocus: true,
          count: detail,
          onInput: v => void search(v),
          onClear: () => void search(''),
          onSubmit: async v => {
            await search(v)
            if (open === 'shell') return
            const first = all.filter(p => matches(p.text, v)).at(-1)
            if (first) {
              if (await jump($, first.id)) await land($, first.id)
            } else $.ui.toast('No prompt matches.')
          },
        })}
        {tabs(k, {
          items: [
            { id: 'prompts', label: 'Prompts' },
            ...(isOurQueue ? [{ id: 'queue', label: waiting.items.length ? `Queue ${waiting.items.length}` : 'Queue' }] : []),
            { id: 'shell', label: 'Shell' },
          ],
          active: open,
          onPick: id => void update($, tab, () => id as PromptsTab),
        })}
        {open === 'queue' ? (
          <Box key="queue" flexDirection="column">
            {waiting.items.length === 0 ? (
              <Text dimColor>Nothing queued. A prompt you type while Claude works waits here.</Text>
            ) : (
              <Box flexDirection="row">
                <Text color={waiting.isHeld ? ROLE.warning : ROLE.chrome}>{waiting.isHeld ? 'held: nothing is sent until you resume' : 'sent in order as each turn ends'}</Text>
                <Box flexGrow={1} />
                {queueActions($, k, waiting, 'pane')}
              </Box>
            )}
            {queueRows($, k, waiting, inner, 'pane')}
          </Box>
        ) : open === 'shell' ? shellList(shown, runs.length, now) : (
        <Box key="list" flexDirection="column">
          {all.length === 0 && <Text dimColor>No prompts yet.</Text>}
          {all.length > 0 && list.length === 0 && <Text dimColor>No prompt matches.</Text>}
          {list.map((p, row) => {
            // The first line with words, or the first with the match while
            // searching; cut in cells by grapheme, so an emoji is never split.
            // shortcut: a match past the cut is not lit; show more of the line if it matters.
            const lines = untagged(p.text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
            const line = (q && lines.find(l => matches(l, q))) || lines[0] || ''
            // Never colour alone: the row last jumped to carries a mark as well as the accent.
            const isAt = p.id === cur
            return (
              <Box key={`r${p.n}`} flexDirection="row">
                <Text {...(isAt ? { color: ROLE.accent } : {})}>{isAt ? `${GLYPH.live} ` : '  '}</Text>
                <Box width={HOTKEY + numW + 1 + textW} flexShrink={0}>
                  <Button key={`p${p.n}`} plain hotkey={row < 9 ? String(row + 1) : undefined} onPress={async () => { if (await jump($, p.id)) await land($, p.id) }}>
                    <Text tabular {...(isAt ? { color: ROLE.accent } : { dimColor: true })}>{padCells(`#${p.n}`, numW, 'right')}</Text>
                    {' '}
                    {marks(clip(line, textW), q).map(m => (m.isMatch ? <Text color={ROLE.accent}>{m.text}</Text> : m.text))}
                  </Button>
                </Box>
                {hasAge && (
                  <Box width={ageW} marginLeft={1} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor tabular>{p.age}</Text>
                  </Box>
                )}
                {hasActions && (
                  <Box flexDirection="row" marginLeft={1} flexShrink={0}>
                    <Button key={`e${p.n}`} plain dimColor onPress={() => void edit($, p.text)}>edit</Button>
                    <Text> </Text>
                    <Button key={`s${p.n}`} plain dimColor onPress={() => void resend($, p.text)}>re-send</Button>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        )}
      </Box>,
      e.surface,
    )
  })
}
