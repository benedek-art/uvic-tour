import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard: src/core/ holds the app's brain (schedule logic, routing, astronomy).
 * It must stay pure so it can be unit-tested without a browser, a DOM, or a map.
 *
 * We strip comments before checking so that merely *mentioning* MapLibre in a
 * doc comment doesn't trip the guard — only real imports count.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const importSpecifiers = (src: string): string[] =>
  [...stripComments(src).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]!)

describe('core purity', () => {
  const dir = 'src/core'
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.ts')) : []

  it('has core modules to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s imports nothing from map/ui and no map library', (f) => {
    const specs = importSpecifiers(readFileSync(join(dir, f), 'utf8'))
    for (const spec of specs) {
      expect(spec, `${f} imports "${spec}"`).not.toMatch(/\/(map|ui)\//)
      expect(spec, `${f} imports "${spec}"`).not.toMatch(/maplibre/i)
    }
  })

  it.each(files)('%s touches no DOM globals', (f) => {
    const src = stripComments(readFileSync(join(dir, f), 'utf8'))
    expect(src).not.toMatch(/\b(document|window)\s*\./)
  })
})
