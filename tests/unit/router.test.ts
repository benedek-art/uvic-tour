// tests/unit/router.test.ts
import { describe, it, expect } from 'vitest'
import { haversine, nearestNode, route } from '../../src/core/router'

const MACLAURIN: [number, number] = [48.46280, -123.31386]
const ECS: [number, number] = [48.46103, -123.31144]
const BOBWRIGHT: [number, number] = [48.46214, -123.30903]

describe('haversine', () => {
  it('measures a known campus distance', () => {
    const d = haversine(MACLAURIN, ECS)
    expect(d).toBeGreaterThan(240)
    expect(d).toBeLessThan(290)
  })
  it('is zero for identical points', () => {
    expect(haversine(ECS, ECS)).toBeCloseTo(0, 5)
  })
})

describe('nearestNode', () => {
  it('snaps a building centroid to a nearby path node', () => {
    const i = nearestNode(...MACLAURIN)
    expect(i).toBeGreaterThanOrEqual(0)
  })
})

describe('route', () => {
  it('finds a path between MacLaurin and ECS', () => {
    const r = route(MACLAURIN, ECS)!
    expect(r).not.toBeNull()
    expect(r.coords.length).toBeGreaterThan(2)
    expect(r.metres).toBeGreaterThan(240)
  })
  it('never returns a path shorter than the straight line', () => {
    const r = route(MACLAURIN, ECS)!
    expect(r.metres).toBeGreaterThanOrEqual(haversine(MACLAURIN, ECS) * 0.95)
  })
  it('stays under a sane detour factor', () => {
    const r = route(MACLAURIN, ECS)!
    expect(r.metres).toBeLessThan(haversine(MACLAURIN, ECS) * 2.0)
  })
  it('emits [lon, lat] GeoJSON order', () => {
    const r = route(MACLAURIN, ECS)!
    for (const [lon, lat] of r.coords) {
      expect(lon).toBeLessThan(-100)
      expect(lat).toBeGreaterThan(40)
    }
  })
  it('gives a believable walk time for the real class transition', () => {
    const r = route(MACLAURIN, ECS)!
    expect(r.minutes).toBeGreaterThanOrEqual(3)
    expect(r.minutes).toBeLessThanOrEqual(8)
  })
  it('routes between all three class buildings', () => {
    for (const [a, b] of [[MACLAURIN, ECS], [BOBWRIGHT, MACLAURIN], [BOBWRIGHT, ECS]] as const)
      expect(route(a, b)).not.toBeNull()
  })
})
