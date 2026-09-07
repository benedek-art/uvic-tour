// tests/unit/camera.test.ts
import { describe, it, expect } from 'vitest'
import { buildingTarget } from '../../src/map/camera'

describe('buildingTarget', () => {
  it('resolves each class building to a sane camera pose', () => {
    for (const n of ['MacLaurin Building', 'Bob Wright Centre', 'Engineering/Computer Science Building']) {
      const t = buildingTarget(n)!
      expect(t).not.toBeNull()
      expect(t.center[0]).toBeGreaterThan(-123.33)
      expect(t.center[0]).toBeLessThan(-123.29)
      expect(t.center[1]).toBeGreaterThan(48.45)
      expect(t.center[1]).toBeLessThan(48.48)
      expect(t.pitch).toBeGreaterThanOrEqual(45)
      expect(t.pitch).toBeLessThanOrEqual(65)
    }
  })
  it('returns null for an unknown building', () => {
    expect(buildingTarget('Hogwarts')).toBeNull()
  })
})
