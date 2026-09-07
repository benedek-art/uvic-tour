import { describe, it, expect } from 'vitest'
import { minutesToHHMM, hhmmToMinutes, dayOfDate, isInTerm } from '../../src/core/time'
import { COURSES } from '../../src/data/schedule'

describe('time helpers', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToHHMM(510)).toBe('08:30')
    expect(minutesToHHMM(1160)).toBe('19:20')
    expect(minutesToHHMM(0)).toBe('00:00')
  })
  it('round-trips HH:MM', () => {
    for (const s of ['08:30', '13:30', '19:20']) expect(minutesToHHMM(hhmmToMinutes(s))).toBe(s)
  })
  it('maps weekdays and rejects weekends', () => {
    expect(dayOfDate(new Date('2026-09-14T12:00:00-07:00'))).toBe('Mon')
    expect(dayOfDate(new Date('2026-09-19T12:00:00-07:00'))).toBe(null)
  })
  it('bounds the term', () => {
    expect(isInTerm(new Date('2026-10-01T12:00:00-07:00'))).toBe(true)
    expect(isInTerm(new Date('2026-08-01T12:00:00-07:00'))).toBe(false)
    expect(isInTerm(new Date('2026-12-25T12:00:00-07:00'))).toBe(false)
  })
})

describe('course data integrity', () => {
  it('has exactly five courses with unique CRNs', () => {
    expect(COURSES).toHaveLength(5)
    expect(new Set(COURSES.map(c => c.crn)).size).toBe(5)
  })
  it('always ends after it starts', () => {
    for (const c of COURSES) expect(c.end).toBeGreaterThan(c.start)
  })
  it('only references the three real buildings', () => {
    const ok = new Set(['Bob Wright Centre', 'MacLaurin Building', 'Engineering/Computer Science Building'])
    for (const c of COURSES) expect(ok.has(c.building)).toBe(true)
  })
  it('puts both PSYC sections in the same room', () => {
    const psyc = COURSES.filter(c => c.code.startsWith('PSYC'))
    expect(psyc).toHaveLength(2)
    expect(new Set(psyc.map(c => `${c.building}|${c.room}`)).size).toBe(1)
  })
})
