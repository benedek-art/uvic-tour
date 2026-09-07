import { describe, it, expect } from 'vitest'
import { POIS } from '../../src/data/pois'
import type { POICategory } from '../../src/data/pois'

/**
 * The bbox the campus data was baked from (`src/data/generated/meta.json`).
 * Asserting both axes is the whole point of this file: a transposed lat/lon is the
 * single most likely bug in hand-authored coordinates, and it fails silently on a map
 * (the marker just lands in the Pacific) while every other test still passes.
 */
const LAT_MIN = 48.4585
const LAT_MAX = 48.47
const LON_MIN = -123.32
const LON_MAX = -123.302

const CATEGORIES: POICategory[] = ['gym', 'library', 'food', 'transit', 'nature', 'culture']

describe('tour stops', () => {
  it('has the eleven stops from SPEC §5.6', () => {
    expect(POIS).toHaveLength(11)
  })

  it('gives every stop a unique id', () => {
    const ids = POIS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(POIS.map((p) => [p.id, p] as const))('%s has readable copy', (_id, poi) => {
    expect(poi.name.trim().length).toBeGreaterThan(0)
    expect(poi.why.trim().length).toBeGreaterThan(0)
    // One sentence, sized for a 390px phone. Longer than this wraps past two lines.
    expect(poi.why.length).toBeLessThanOrEqual(95)
    expect(CATEGORIES).toContain(poi.category)
  })

  it.each(POIS.map((p) => [p.id, p] as const))('%s sits inside the campus bbox', (_id, poi) => {
    expect(Number.isFinite(poi.lat)).toBe(true)
    expect(Number.isFinite(poi.lon)).toBe(true)
    expect(poi.lat).toBeGreaterThanOrEqual(LAT_MIN)
    expect(poi.lat).toBeLessThanOrEqual(LAT_MAX)
    expect(poi.lon).toBeGreaterThanOrEqual(LON_MIN)
    expect(poi.lon).toBeLessThanOrEqual(LON_MAX)
  })

  it('resolves the four SPEC §3 verified stops to their surveyed coordinates', () => {
    const verified: Record<string, [number, number]> = {
      carsa: [48.4679, -123.31119],
      'mcpherson-library': [48.46342, -123.30935],
      'student-union': [48.46508, -123.30819],
      'first-peoples-house': [48.46399, -123.3117],
    }
    for (const [id, [lat, lon]] of Object.entries(verified)) {
      const poi = POIS.find((p) => p.id === id)
      expect(poi, `missing POI ${id}`).toBeDefined()
      // ~11 m of slack: the polygon centroid and the surveyed point are not identical.
      expect(Math.abs(poi!.lat - lat)).toBeLessThan(0.0001)
      expect(Math.abs(poi!.lon - lon)).toBeLessThan(0.0001)
    }
  })

  it('keeps stacked stops far enough apart to tap separately', () => {
    // Mystic Market lives in the SUB and BiblioCafé in the library. Identical coordinates
    // would make one of each pair permanently unreachable under the other's marker.
    for (const [a, b] of [
      ['student-union', 'mystic-market'],
      ['mcpherson-library', 'bibliocafe'],
    ]) {
      const x = POIS.find((p) => p.id === a)!
      const y = POIS.find((p) => p.id === b)!
      expect(Math.abs(x.lat - y.lat) + Math.abs(x.lon - y.lon)).toBeGreaterThan(0.0001)
    }
  })
})
