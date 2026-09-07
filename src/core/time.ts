/**
 * Term / day / minute math. Pure: no DOM, no map, no imports from src/map or src/ui.
 *
 * Everything here resolves in the CAMPUS timezone (America/Vancouver), never the
 * viewer's own, so the app is correct whether it's opened from Victoria or from a
 * different continent. That is why `Intl.DateTimeFormat` is used instead of the
 * `Date#getDay()` / `getHours()` family, which silently use the machine zone.
 */

import type { Day } from '../data/schedule'
export type { Day }

/** Campus timezone. Every day/minute extraction in this app resolves here. */
export const CAMPUS_TIMEZONE = 'America/Vancouver'

/** First day of the Fall 2026 term, as a campus-local calendar date (inclusive). */
export const TERM_START = '2026-09-09'
/** Last day of the Fall 2026 term, as a campus-local calendar date (inclusive). */
export const TERM_END = '2026-12-07'

/** Monday-first, matching how the week grid is laid out. */
export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** Index 0..6 keyed by JS `getUTCDay()` (0 = Sunday). Weekends map to null. */
const WEEKDAY_BY_INDEX: (Day | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', null]

const MINUTES_PER_DAY = 24 * 60

/**
 * Built once — constructing an Intl.DateTimeFormat is expensive and this runs on
 * every clock tick.
 */
const CAMPUS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

interface CampusParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** Break an instant into campus-local calendar/clock components. */
function campusParts(d: Date): CampusParts {
  const out: Record<string, number> = {}
  for (const part of CAMPUS_PARTS.formatToParts(d)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  return {
    year: out['year'] ?? 0,
    month: out['month'] ?? 1,
    day: out['day'] ?? 1,
    hour: out['hour'] ?? 0,
    minute: out['minute'] ?? 0,
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Minutes from midnight -> 24-hour 'HH:MM'.
 * `minutesToHHMM(510) === '08:30'`
 */
export function minutesToHHMM(m: number): string {
  const total = ((Math.floor(m) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/**
 * 24-hour 'HH:MM' -> minutes from midnight. Throws on malformed input so a typo in
 * hand-edited schedule data fails loudly rather than rendering a class at 00:00.
 */
export function hhmmToMinutes(s: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  const hh = match?.[1]
  const mm = match?.[2]
  if (hh === undefined || mm === undefined) {
    throw new Error(`Expected a time like "08:30", got ${JSON.stringify(s)}`)
  }
  const hours = Number(hh)
  const minutes = Number(mm)
  if (hours > 23 || minutes > 59) {
    throw new Error(`Time out of range: ${JSON.stringify(s)}`)
  }
  return hours * 60 + minutes
}

/**
 * Which campus weekday an instant falls on, or null on a weekend.
 *
 * The calendar date is resolved in America/Vancouver first, then turned into a
 * weekday via a UTC-anchored Date so no second timezone conversion can shift it.
 */
export function dayOfDate(d: Date): Day | null {
  const { year, month, day } = campusParts(d)
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return WEEKDAY_BY_INDEX[index] ?? null
}

/** Minutes from campus-local midnight, 0..1439. */
export function minutesOfDate(d: Date): number {
  const { hour, minute } = campusParts(d)
  return hour * 60 + minute
}

/** Campus-local calendar date as 'YYYY-MM-DD' — sortable and directly comparable. */
export function campusDateKey(d: Date): string {
  const { year, month, day } = campusParts(d)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Is this instant inside the Fall 2026 term (both endpoints inclusive)? */
export function isInTerm(d: Date): boolean {
  const key = campusDateKey(d)
  return key >= TERM_START && key <= TERM_END
}
