import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PromptsSent, PromptsVersion } from '../types'

// Blue, so a prompt card never reads as one of pretty-markdown's grey code blocks.
const CARD = 'suggestion'
// Purple: a slash command, typed or as the row its output prints, apart from a prompt.
const COMMAND = 'merged'
const PANE = 'prompts'

const version = atom({ plugin: 'prompt-cards', key: 'version' } as const, 0 as PromptsVersion)
const sent = atom({ plugin: 'prompt-cards', key: 'sent' } as const, { ids: [], turnId: null, opener: '' } as PromptsSent)

// Splits a prompt into prose and fenced code, so a pasted block draws as code.
// A fence left open runs to the end, as Markdown reads it.
export function pieces(text: string): { text: string; language?: string }[] {
  const out: { text: string; language?: string }[] = []
  const prose: string[] = []
  // The engine wraps a paste in `<pasted_content>` tags for the model; the person
  // never typed them, so the card leaves them out.
  const lines = text.split(/\r?\n/).filter(l => !/^\s*<\/?pasted_content\b[^>]*>\s*$/.test(l))
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

export const register: Register = on => {
  // The person's prompts in transcript order, as their rows were drawn. A row is
  // drawn again after a reload, so the list fills back up by itself.
  const prompts = new Map<string, string>()
  // The turn each prompt row was first drawn in: a row first drawn while a turn
  // runs, and not yet stored, is one the person queued.
  const firstSeen = new Map<string, string | null>()


  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
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
    await $.command.register({ name: 'prompts', description: 'List the prompts you sent and jump to one' })
    return next(e)
  })

  on('command.run', { command: 'prompts' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Your prompts', focus: true })
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
    // Drawn for a fixed-width terminal; other surfaces keep their own look.
    if (e.surface !== 'terminal') return next(e)
    // Only the person's own prompts: typed here, or sent from another device.
    const kind = e.props.origin.kind
    if (kind !== 'composer' && kind !== 'bridge') return next(e)
    prompts.set(e.requestId, e.props.text)

    const s = await read($, sent)
    if (!firstSeen.has(e.requestId)) firstSeen.set(e.requestId, s.turnId)
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
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginLeft={4} alignSelf="flex-start">
          <Text dimColor italic>⏸ queued</Text>
          <Text dimColor>{e.props.text}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Text color={color} weight="bold">{isCommand ? 'command' : 'you'}</Text>
        {pieces(e.props.text).map((p, k) =>
          p.language === undefined ? (
            <Text key={`t${k}`}>{p.text}</Text>
          ) : (
            <Box key={`c${k}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
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
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const head = `/${e.props.command}${e.props.args ? ` ${e.props.args}` : ''}`
    const body = e.props.text.trim()
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={e.props.isErrored ? 'error' : COMMAND} paddingX={1}>
        <Text color={COMMAND} weight="bold">{head}</Text>
        {body ? (e.props.isErrored ? <Text color="error">{body}</Text> : <Markdown text={body} />) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, version)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - 8)
    // Newest first, so the hotkeys 1 to 9 reach the recent ones.
    const list = [...prompts].map(([id, text], n) => ({ id, text, n: n + 1 })).reverse()

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No prompts yet.</Text>}
        {list.map((p, row) => {
          // The first line with words, past a leading blank or paste tag; cut by
          // code point so an emoji is never split in half.
          const line = [...(p.text.split(/\r?\n/).map(l => l.trim())
            .find(l => l && !/^<\/?pasted_content\b/.test(l)) ?? '')]
          return (
            <Button
              key={`p${p.n}`}
              plain
              hotkey={row < 9 ? String(row + 1) : undefined}
              onPress={async () => {
                const moved = await $.ui.scroll({ to: { requestId: p.id }, block: 'start' })
                if ('deny' in moved && moved.deny) $.ui.toast(`Can't jump there: ${moved.deny}`)
              }}
            >
              <Text color={CARD}>{`#${p.n} `}</Text>
              {line.length > width ? `${line.slice(0, width - 1).join('')}…` : line.join('')}
            </Button>
          )
        })}
      </Box>
    )
  })
}
