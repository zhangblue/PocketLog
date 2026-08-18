import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

function color(name: string) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)
  if (!match) throw new Error(`缺少颜色 token: ${name}`)
  return match[1]
}

function tokenValue(name: string) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)
  if (!match) throw new Error(`缺少 token: ${name}`)
  return match[1].trim()
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const linear = channels.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
}

function contrast(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + .05) / (dark + .05)
}

describe('视觉可访问性 CSS 契约', () => {
  it('小号正文、列头和收入金额在卡片背景达到 AA 4.5:1', () => {
    const card = color('color-card')
    const muted = color('color-muted')
    const income = color('color-income')

    expect(contrast(muted, card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(income, card)).toBeGreaterThanOrEqual(4.5)
    expect(styles).toMatch(/\.transaction-head,[\s\S]*?color:\s*var\(--color-muted\)/)
    expect(styles).toMatch(/\.transaction-detail-head[\s\S]*?color:\s*var\(--color-muted\)/)
    expect(styles).toMatch(/\.transaction-row \.income[\s\S]*?color:\s*var\(--color-income\)/)
    expect(styles).toMatch(/\.transaction-detail-row strong\.income[\s\S]*?color:\s*var\(--color-income\)/)
  })

  it('焦点使用不透明双层指示，并在浅色和深色背景达到 3:1', () => {
    const card = color('color-card')
    const ink = color('color-ink')
    const focus = '#0d2b25'

    expect(styles).toMatch(/button:focus-visible,[\s\S]*?outline:\s*2px solid var\(--color-card\)[\s\S]*?box-shadow:\s*var\(--focus-ring\)/)
    expect(tokenValue('focus-ring')).toBe('0 0 0 4px #0d2b25')
    expect(contrast(focus, card)).toBeGreaterThanOrEqual(3)
    expect(contrast(card, ink)).toBeGreaterThanOrEqual(3)
  })
})
