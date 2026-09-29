/** The self-hosted PaperLab faces ship with licenses and inline as data URIs. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('offline paperlab fonts', () => {
  it('declares Source Serif 4 and JetBrains Mono as bundled data URIs', () => {
    const css = readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8')
    expect(css).toContain("@font-face")
    expect(css).toContain("font-family: 'Source Serif 4'")
    expect(css).toContain("font-weight: 200 900")
    expect(css).toContain("font-family: 'JetBrains Mono'")
    expect(css).toContain('font-display: swap')
    // Self-contained: data URIs only, no network fetches.
    expect(css).not.toMatch(/url\(https?:/)
    expect(css).toMatch(/url\(data:font\/woff2;base64,/)
  })

  it('keeps the redistribution licenses beside the source woff2 files', () => {
    for (const license of ['LICENSE-SourceSerif4-OFL.txt', 'LICENSE-JetBrainsMono-OFL.txt']) {
      const text = readFileSync(new URL(`../src/styles/fonts/${license}`, import.meta.url), 'utf8')
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1')
      expect(text).toContain('DEFINITIONS')
    }
    for (const font of ['source-serif-4-var.woff2', 'jetbrains-mono-regular.woff2']) {
      const bytes = readFileSync(new URL(`../src/styles/fonts/${font}`, import.meta.url))
      expect(bytes.readUInt32BE(0)).toBe(0x774f4632)
    }
  })

  it('puts the brand serif first in the heading stack and the mono first in code', () => {
    const base = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
    const brand = /--dsw-font-family-brand:([^;]+);/.exec(base)?.[1] ?? ''
    expect(brand.trim().startsWith("'Source Serif 4'")).toBe(true)
    const code = /--ds-font-family-code:([^;]+);/.exec(base)?.[1] ?? ''
    expect(code.trim().startsWith("'JetBrains Mono'")).toBe(true)
  })
})
