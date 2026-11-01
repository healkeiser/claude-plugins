import type { ClientModule } from 'claude-code'

export type ButtonProps = { id: string; label: string; dim: boolean }

const HeaderButton: ClientModule<ButtonProps, { over: boolean }> = (props, surface) => {
  const { Button, Text } = surface.elements
  surface.onPointer(e => {
    const over = e.type !== 'leave'
    if (over === Boolean(surface.state?.over)) return
    surface.setState({ over })
    surface.post({ over })
  })
  // A toggle that is on reads in Claude orange; off, or a plain action, dim.
  if (props.dim) return <Button key={props.id} plain dimColor label={props.label} onPress={() => surface.post({ press: true })} />
  return (
    <Button key={props.id} plain label={props.label} onPress={() => surface.post({ press: true })}>
      <Text color="claude">{props.label}</Text>
    </Button>
  )
}

export default HeaderButton
