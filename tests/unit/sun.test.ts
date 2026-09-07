import { describe, it, expect } from 'vitest'
import { sunsetMinutes } from '../../src/core/sun'

describe('sunsetMinutes for Victoria BC', () => {
  it('is late in September', () => {
    const m = sunsetMinutes(new Date('2026-09-15T12:00:00-07:00'))
    expect(m).toBeGreaterThan(19 * 60)   // after 19:00
    expect(m).toBeLessThan(20 * 60)      // before 20:00
  })
  it('is early in November', () => {
    const m = sunsetMinutes(new Date('2026-11-15T12:00:00-08:00'))
    expect(m).toBeGreaterThan(16 * 60)   // after 16:00
    expect(m).toBeLessThan(17 * 60)      // before 17:00
  })
  it('moves earlier as the term progresses', () => {
    const sep = sunsetMinutes(new Date('2026-09-15T12:00:00-07:00'))
    const nov = sunsetMinutes(new Date('2026-11-15T12:00:00-08:00'))
    expect(nov).toBeLessThan(sep)
  })
})
