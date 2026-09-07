// tests/unit/week.test.ts
import { describe, it, expect } from 'vitest'
import { buildWeek, resolveNow } from '../../src/core/week'
import { COURSES } from '../../src/data/schedule'

const week = buildWeek(COURSES)
const at = (iso: string) => new Date(iso)

describe('buildWeek', () => {
  it('places three sessions on Monday and Wednesday', () => {
    expect(week.Mon).toHaveLength(3)
    expect(week.Wed).toHaveLength(3)
  })
  it('places two sessions on Tue, Thu and Fri', () => {
    expect(week.Tue).toHaveLength(2)
    expect(week.Thu).toHaveLength(2)
    expect(week.Fri).toHaveLength(2)
  })
  it('sorts each day chronologically', () => {
    for (const day of Object.values(week))
      for (let i = 1; i < day.length; i++)
        expect(day[i]!.start).toBeGreaterThanOrEqual(day[i - 1]!.end - 1)
  })
  it('starts Monday with BIOL 184 at 08:30', () => {
    expect(week.Mon[0]!.course.code).toBe('BIOL 184')
    expect(week.Mon[0]!.start).toBe(510)
  })
})

describe('resolveNow', () => {
  it('detects being in class', () => {
    const s = resolveNow(at('2026-09-14T09:00:00-07:00'), week) // Mon 09:00
    expect(s.kind).toBe('in-class')
    if (s.kind === 'in-class') {
      expect(s.session.course.code).toBe('BIOL 184')
      expect(s.minutesLeft).toBe(50)
    }
  })
  it('counts down to the next class on the same day', () => {
    const s = resolveNow(at('2026-09-14T16:00:00-07:00'), week) // Mon 16:00
    expect(s.kind).toBe('before-next')
    if (s.kind === 'before-next') {
      expect(s.session.course.code).toBe('PSYC 100B')
      expect(s.minutesUntil).toBe(30)
      expect(s.sameDay).toBe(true)
    }
  })
  it('rolls over to the next day once the day is done', () => {
    const s = resolveNow(at('2026-09-14T21:00:00-07:00'), week) // Mon after class
    expect(s.kind).toBe('day-done')
    if (s.kind === 'day-done') expect(s.next!.day).toBe('Tue')
  })
  it('rolls Friday evening over to Monday', () => {
    const s = resolveNow(at('2026-09-18T20:00:00-07:00'), week) // Fri late
    expect(s.kind).toBe('day-done')
    if (s.kind === 'day-done') expect(s.next!.day).toBe('Mon')
  })
  it('handles weekends', () => {
    const s = resolveNow(at('2026-09-19T12:00:00-07:00'), week) // Saturday
    expect(s.kind).toBe('day-done')
    if (s.kind === 'day-done') expect(s.next!.day).toBe('Mon')
  })
  it('reports pre-term before Sep 9', () => {
    const s = resolveNow(at('2026-08-20T12:00:00-07:00'), week)
    expect(s.kind).toBe('pre-term')
  })
})
