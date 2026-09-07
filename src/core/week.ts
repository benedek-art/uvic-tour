/**
 * The weekly grid and the "what's next?" brain.
 *
 * Two jobs, both pure (no DOM, no map, no imports from src/map or src/ui):
 *   1. `buildWeek` flattens the course list — where one course meets on several days —
 *      into a Monday-first grid of individual `Session`s, each sorted by start time.
 *   2. `resolveNow` answers the single question the whole app exists to answer:
 *      am I in class, is one coming up, or is the day done?
 *
 * Every day/minute extraction goes through `src/core/time.ts`, which resolves in the
 * campus timezone (America/Vancouver) rather than the viewer's own.
 */

import type { Course, Day } from '../data/schedule'
import { DAYS, TERM_START, campusDateKey, dayOfDate, isInTerm, minutesOfDate } from './time'

/** One course meeting on one specific weekday. */
export interface Session {
  course: Course
  day: Day
  /** Minutes from campus-local midnight. */
  start: number
  /** Minutes from campus-local midnight. */
  end: number
}

/**
 * What the clock says right now, relative to the schedule.
 *
 * - `in-class`     — a session is running; `minutesLeft` until it ends.
 * - `before-next`  — a session is still to come today; `minutesUntil` it starts.
 * - `day-done`     — nothing left today; `next` is the following session, or `null`
 *                    when the term is over.
 * - `pre-term`     — the term hasn't started; `firstSession` is the very first class.
 */
export type NowState =
  | { kind: 'in-class'; session: Session; minutesLeft: number }
  | { kind: 'before-next'; session: Session; minutesUntil: number; sameDay: boolean }
  | { kind: 'day-done'; next: Session | null }
  | { kind: 'pre-term'; firstSession: Session }

/** Index 0..6 keyed by `getUTCDay()` (0 = Sunday). Weekends map to null. */
const WEEKDAY_BY_INDEX: (Day | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', null]

/** Empty Monday-first grid — a fresh array per day so callers can't share mutations. */
function emptyWeek(): Record<Day, Session[]> {
  return { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] }
}

/**
 * Expand courses into per-day sessions. A course meeting Tue/Wed/Fri produces three
 * sessions. Each day comes back sorted chronologically, ties broken by course code so
 * the ordering is stable regardless of the input order.
 */
export function buildWeek(courses: Course[]): Record<Day, Session[]> {
  const week = emptyWeek()
  for (const course of courses) {
    for (const day of course.days) {
      week[day].push({ course, day, start: course.start, end: course.end })
    }
  }
  for (const day of DAYS) {
    week[day].sort((a, b) => a.start - b.start || a.course.code.localeCompare(b.course.code))
  }
  return week
}

/** Campus-local weekday index, 0 = Sunday. Derived from the campus calendar date so a
 *  viewer in another timezone still gets the campus's idea of "today". */
function campusWeekdayIndex(d: Date): number {
  const [year, month, day] = campusDateKey(d).split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

/** First session of the week grid, reading Monday-first. `null` if nothing is scheduled. */
function firstSessionOfWeek(week: Record<Day, Session[]>): Session | null {
  for (const day of DAYS) {
    const first = week[day][0]
    if (first) return first
  }
  return null
}

/**
 * The next session strictly after the given weekday, wrapping through the week.
 * Capped at 7 iterations so an empty schedule terminates instead of spinning.
 */
function nextSessionAfterDay(week: Record<Day, Session[]>, weekdayIndex: number): Session | null {
  for (let i = 1; i <= 7; i++) {
    const day = WEEKDAY_BY_INDEX[(weekdayIndex + i) % 7]
    if (!day) continue
    const first = week[day][0]
    if (first) return first
  }
  return null
}

/**
 * Resolve the clock against the week grid.
 *
 * Check order: pre-term -> in-class -> later today -> next weekday (wrapping).
 * Once the last class of the day has ended the state is `day-done`, even though a
 * `next` session exists — the UI wants to say "done for today" rather than count down
 * for eighteen hours.
 */
export function resolveNow(now: Date, week: Record<Day, Session[]>): NowState {
  if (!isInTerm(now)) {
    // Before the term: point at the very first class. After it: nothing is left.
    if (campusDateKey(now) < TERM_START) {
      const first = firstSessionOfWeek(week)
      if (first) return { kind: 'pre-term', firstSession: first }
    }
    return { kind: 'day-done', next: null }
  }

  const today = dayOfDate(now)
  const minutes = minutesOfDate(now)

  if (today) {
    const sessions = week[today]
    for (const session of sessions) {
      if (minutes >= session.start && minutes < session.end) {
        return { kind: 'in-class', session, minutesLeft: session.end - minutes }
      }
    }
    const upcoming = sessions.find((s) => s.start > minutes)
    if (upcoming) {
      return {
        kind: 'before-next',
        session: upcoming,
        minutesUntil: upcoming.start - minutes,
        sameDay: true,
      }
    }
  }

  return { kind: 'day-done', next: nextSessionAfterDay(week, campusWeekdayIndex(now)) }
}
