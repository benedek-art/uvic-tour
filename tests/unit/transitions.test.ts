import { describe, it, expect } from 'vitest'
import { buildWeek } from '../../src/core/week'
import { analyzeDay } from '../../src/core/transitions'
import { COURSES } from '../../src/data/schedule'

const week = buildWeek(COURSES)

describe('analyzeDay', () => {
  it('flags the Monday PSYC handoff as same-room', () => {
    const t = analyzeDay(week.Mon)
    const psyc = t.find(x => x.from.course.code === 'PSYC 100B')!
    expect(psyc.kind).toBe('same-room')
    expect(psyc.walkMinutes).toBe(0)
    expect(psyc.gapMinutes).toBe(10)
    expect(psyc.note.toLowerCase()).toContain('stay')
  })
  it('calls the Tuesday MacLaurin->ECS hop comfortable', () => {
    const t = analyzeDay(week.Tue)
    expect(t).toHaveLength(1)
    expect(t[0]!.kind).toBe('comfortable')
    expect(t[0]!.gapMinutes).toBe(70)
  })
  it('produces one fewer transition than sessions', () => {
    for (const day of Object.values(week))
      expect(analyzeDay(day)).toHaveLength(Math.max(0, day.length - 1))
  })
  it('never reports a negative gap', () => {
    for (const day of Object.values(week))
      for (const t of analyzeDay(day)) expect(t.gapMinutes).toBeGreaterThanOrEqual(0)
  })
  it('returns nothing for an empty or single-class day', () => {
    expect(analyzeDay([])).toEqual([])
    expect(analyzeDay([week.Mon[0]!])).toEqual([])
  })
})
