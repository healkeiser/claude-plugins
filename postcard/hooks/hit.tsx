// A press zone for a graphical surface: an empty region as large as the part it lies over, which
// reports the pointer. A row or an icon is then pressed anywhere on it, with no Button chrome, focus
// ring or hover of a Button's own: the part draws its own hover (app.tsx's gHover). The same way the
// upstream filetree draws its desktop rows (data-goblin/claude-code-filetree, hooks/hit.tsx).
//
// app.tsx's gHit lays it over a part; the mod's `ui.message` hook hands each post to app.tsx's pressHit.
// The same source as kit.tsx: edit shared/hit.tsx, then run `node scripts/check-style.mjs --write`.
import type { ClientModule } from 'claude-code'

// No props: the Client's key (`hit:<part>`) names the part in each post.
type Local = { off?: () => void; isOver: boolean }

const Hit: ClientModule<Record<string, never>, Local> = (_props, surface) => {
  const { Box } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { isOver: false }
    surface.setState(state)
  }
  const s = state
  // Listened once for the region's life: a redraw runs this again.
  s.off ??= surface.onPointer(e => {
    if (e.type === 'up' && (e.button ?? 'left') === 'left') surface.post({ press: true })
    // Over on any event but `leave`: the desktop reports a pointer's moves without an `enter` first
    // (as upstream filetree's button.tsx reads it). Posted only when it changes.
    else if (e.type !== 'down' && e.type !== 'up' && (e.type !== 'leave') !== s.isOver) {
      s.isOver = e.type !== 'leave'
      surface.post({ over: s.isOver })
    }
  })
  return <Box width="100%" height="100%" />
}

export default Hit
