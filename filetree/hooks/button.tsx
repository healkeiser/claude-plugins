import type { ClientModule } from 'claude-code'

import { iconLabel } from './kit'

export type ButtonProps = { id: string; label: string; dim: boolean }

const HeaderButton: ClientModule<ButtonProps, { over: boolean }> = (props, surface) => {
  const { Button, Text } = surface.elements
  surface.onPointer(e => {
    const over = e.type !== 'leave'
    if (over === Boolean(surface.state?.over)) return
    surface.setState({ over })
    surface.post({ over })
  })
  // A toggle that is on reads in Claude orange; off, or a plain action, dim. A glyph is
  // padded (kit's iconLabel), so its hover highlight centres on it. A Button with a label
  // draws the label alone: the lit one carries its colour in its children instead.
  const face = iconLabel(props.label)
  if (props.dim) return <Button key={props.id} plain dimColor label={face} onPress={() => surface.post({ press: true })} />
  return (
    <Button key={props.id} plain onPress={() => surface.post({ press: true })}>
      <Text color="claude">{face}</Text>
    </Button>
  )
}

export default HeaderButton
