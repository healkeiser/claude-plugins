// Tests for the shared style.ts; identical in every mod, as style.ts is.
import { expect, test } from 'claude-code/testing'

import {
  ASCII, GLYPH, HEAT_RAMP, HEAT_UNLIT, ROLE, SPINNER, ascii, asciiTree, bareEmoji, canRamp, cellWidth, clip, count, cutCells, duration, glide, heat, meter, motionOn,
  heatHex, heatRuns, packets, padCells, percent, remember, span, spin, sweep, usd,
} from './style'

test('every glyph is text presentation', () => {
  const all = [...Object.values(GLYPH).flat(), ...SPINNER].join('')
  expect(bareEmoji(all)).toEqual([])
  expect(bareEmoji('↗ ⚠ ℹ ▶ ✔ ⏸ ▪ ✳')).toEqual(['↗', '⚠', 'ℹ', '▶', '✔', '⏸', '▪', '✳'])
  expect(bareEmoji('↗︎ ✓ ✕ ● ○ ■ ‖ ↻ ⟲ ◆ ◇ » … ━ ─ ╭ ╮ ╰ ╯ ┬ ┴ # * 1')).toEqual([])
})

test('roles keep one meaning each', () => {
  const keys = Object.values(ROLE)
  expect(new Set(keys).size).toBe(keys.length)
  expect(ROLE.you).not.toBe(ROLE.info)
  expect(ROLE.command).not.toBe(ROLE.accent)
})

test('cells: wide characters count two, marks none, cuts keep whole graphemes', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('日本語')).toBe(6)
  expect(cellWidth('é')).toBe(1)
  expect(cellWidth('↗︎')).toBe(1)
  expect(cellWidth('🙂')).toBe(2)
  expect(cellWidth('✓ ● ━')).toBe(5)
  expect(cutCells('日本語', 3)).toEqual(['日', '本語'])
  expect(cutCells('a🙂b', 2)).toEqual(['a', '🙂b'])
  expect(clip('hello world', 8)).toBe('hello w…')
  expect(clip('日本語テキスト', 7)).toBe('日本語…')
  expect(cellWidth(clip('日本語テキスト', 7))).toBeLessThanOrEqual(7)
  expect(clip('short', 10)).toBe('short')
  expect(padCells('日本', 6)).toBe('日本  ')
  expect(padCells('7%', 4, 'right')).toBe('  7%')
})

test('formats', () => {
  expect(duration(1400)).toBe('1.4s')
  expect(duration(42_000)).toBe('42s')
  expect(duration(125_000)).toBe('2m 05s')
  expect(duration(3 * 3600_000 + 12 * 60_000)).toBe('3h 12m')
  expect(duration(76 * 3600_000)).toBe('3d 4h')
  expect(span(4 * 3600_000 + 51 * 60_000)).toBe('4h 51m')
  expect(span(25 * 60_000)).toBe('25m')
  expect(span(0)).toBe('')
  expect(count(950)).toBe('950')
  expect(count(13_700)).toBe('13.7k')
  expect(count(640_000)).toBe('640k')
  expect(count(1_000_000)).toBe('1.0M')
  expect(percent(63.6)).toBe('64%')
  expect(usd(12.454)).toBe('$12.45')
  expect(usd(140.2)).toBe('$140')
})

test('meters heat at 60 and 80 percent', () => {
  expect(heat(59)).toBe('claude')
  expect(heat(60)).toBe('warning')
  expect(heat(80)).toBe('error')
  expect(meter(64, 10)).toEqual({ fill: '━━━━━━', track: '────' })
  expect(meter(150, 4)).toEqual({ fill: '━━━━', track: '' })
})

test('motion: eased, bounded, and off when asked or when Reduce motion is on', () => {
  expect(spin(0)).toBe('⠋')
  expect(spin(10)).toBe('⠋')
  expect(glide(0, 100, 0)).toBe(0)
  expect(glide(0, 100, 400)).toBe(100)
  expect(glide(0, 100, 200)).toBeGreaterThan(50)
  const steps = Array.from({ length: 40 }, (_, t) => sweep(5, t, 10))
  expect(Math.max(...steps)).toBe(3)
  expect(Math.min(...steps)).toBe(0)
  expect(packets(30, 0).get(0)).toBe('●')
  expect(packets(30, 2).get(1)).toBe('•')
  expect(motionOn('while-active')).toBe(true)
  expect(motionOn('off')).toBe(false)
  expect(motionOn('while-active', [{ key: 'reduceMotion', value: true }])).toBe(false)
  expect(motionOn('while-active', [{ key: 'reduceMotion', value: false }])).toBe(true)
})

test('remember keeps the newest entries only', () => {
  const m = new Map<number, number>()
  for (let i = 0; i < 10; i++) remember(m, i, i, 3)
  expect([...m.keys()]).toEqual([7, 8, 9])
})

test('glyphs: text draws every glyph as one ASCII cell', () => {
  const all = [...Object.values(GLYPH).flat(), ...SPINNER, '╭╮╰╯┬┴├┼┤┃▾▴▸⧉⌕⌘⇣→—'].join('')
  const out = ascii(all)
  expect(/^[ -~]*$/.test(out)).toBe(true)
  expect(out.length).toBe([...all.replace(/︎/g, '')].length)
  expect(Object.values(ASCII).every(v => v.length === 1)).toBe(true)
  expect(ascii('✓ done · ↗︎')).toBe('v done - ^')
  const tree = asciiTree({ type: 'Box', props: { borderStyle: 'round' }, children: [
    { type: 'Text', children: ['● working'] },
    { type: 'Code', props: { source: '✓' } },
    { type: 'Button', props: { label: '▾ more' } },
  ] })
  expect(tree).toEqual({ type: 'Box', props: { borderStyle: 'classic' }, children: [
    { type: 'Text', children: ['* working'] },
    { type: 'Code', props: { source: '✓' } },
    { type: 'Button', props: { label: 'v more' } },
  ] })
})

test('the heat ramp: one step per 10%, each lit cell its own step', () => {
  expect(heatHex(0)).toBe(HEAT_RAMP[0])
  expect(heatHex(64)).toBe(HEAT_RAMP[6])
  expect(heatHex(100)).toBe(HEAT_RAMP[9])
  expect(heatRuns(40, 10)).toEqual([
    ...HEAT_RAMP.slice(0, 4).map(color => ({ text: '━', color })),
    { text: '──────', color: HEAT_UNLIT },
  ])
  expect(heatRuns(100, 5).map(r => r.color)).toEqual([HEAT_RAMP[0], HEAT_RAMP[2], HEAT_RAMP[4], HEAT_RAMP[6], HEAT_RAMP[8]])
  expect(canRamp({ COLORTERM: 'truecolor' })).toBe(true)
  expect(canRamp({ TERM: 'xterm-256color' })).toBe(true)
  expect(canRamp({ TERM: 'xterm' })).toBe(false)
})
