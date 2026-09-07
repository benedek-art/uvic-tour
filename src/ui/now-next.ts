/**
 * The hero card — "where is my next class and when do I leave?"
 *
 * SPEC §5.1 and success criterion 2: a cold open must answer that question in under
 * five seconds with no tapping. So this card is the first thing in the sheet, it is
 * visible at the peek detent, and it never asks for input.
 *
 * It renders every `NowState` variant from `src/core/week.ts`, plus the scrubbed
 * variant (when `state.scrubMinutes` is set the live clock is overridden). The
 * countdown re-writes a single text node once a second — the card's structure is
 * rebuilt only when the *shape* of the answer changes — so nothing reflows while
 * digits tick. JetBrains Mono with `tabular-nums` (see ui.css) keeps the numerals
 * from shuffling sideways.
 *
 * This module also owns the small amount of schedule reasoning the whole sheet
 * shares — `resolveFocus`, `transitionAfter`, `transitionBefore` — because it is the
 * only UI module every other one already depends on.
 */

import './ui.css'
import type { AppState } from './sheet'
import type { Store } from './store'
import { analyzeDay, type Transition } from '../core/transitions'
import { endsAfterDark } from '../core/sun'
import { DAYS, TERM_START, dayOfDate, minutesOfDate, minutesToHHMM } from '../core/time'
import { buildWeek, resolveNow, type NowState, type Session } from '../core/week'
import { COURSES, type Day } from '../data/schedule'

/** Built once. `buildWeek` is pure and the course list never changes at runtime. */
export const WEEK = buildWeek(COURSES)

/** `analyzeDay` runs A* per pair, so memoise per day rather than per render. */
const transitionCache = new Map<Day, Transition[]>()

/** Every transition on one campus day, in chronological order. */
export function transitionsFor(day: Day): Transition[] {
  let cached = transitionCache.get(day)
  if (!cached) {
    cached = analyzeDay(WEEK[day])
    transitionCache.set(day, cached)
  }
  return cached
}

/** Sessions are compared by course + day, not by identity: a caller may well have
 *  built its own `Session` object rather than taking ours out of `WEEK`. */
function sameSession(a: Session, b: Session): boolean {
  return a.course.id === b.course.id && a.day === b.day
}

/** What happens *after* this session on its day — the "and then?" note. */
export function transitionAfter(session: Session): Transition | null {
  return transitionsFor(session.day).find((t) => sameSession(t.from, session)) ?? null
}

/** What happens *before* this session — the walk that decides "leave by". */
export function transitionBefore(session: Session): Transition | null {
  return transitionsFor(session.day).find((t) => sameSession(t.to, session)) ?? null
}

/** Short building tags. Full names are too wide for a 390 px row. */
export const SHORT_BUILDING: Record<string, string> = {
  'Bob Wright Centre': 'BWC',
  'MacLaurin Building': 'MACL',
  'Engineering/Computer Science Building': 'ECS',
}

export function shortBuilding(name: string): string {
  return SHORT_BUILDING[name] ?? name.slice(0, 4).toUpperCase()
}

/** `08:30–09:50`, en dash, mono-friendly. */
export function timeRange(start: number, end: number): string {
  return `${minutesToHHMM(start)}–${minutesToHHMM(end)}`
}

/** `MON · THU`. */
export function dayList(days: Day[]): string {
  return days.map((d) => d.toUpperCase()).join(' · ')
}

/**
 * The card's subject: what the clock (or the scrubber) says, which session that is
 * about, and how many seconds until the countdown target.
 */
export interface Focus {
  now: NowState
  /** The session the card is describing, or null when the term is over. */
  session: Session | null
  /** Campus day being described. */
  day: Day | null
  /** Seconds until the countdown target, or null when a countdown makes no sense. */
  seconds: number | null
  /** True when the week scrubber is overriding the live clock. */
  scrubbing: boolean
}

/** First session on the next scheduled day after `day`, wrapping through the week. */
function firstSessionAfterDay(day: Day): Session | null {
  const start = DAYS.indexOf(day)
  for (let i = 1; i <= DAYS.length; i++) {
    const next = DAYS[(start + i) % DAYS.length]
    if (!next) continue
    const first = WEEK[next][0]
    if (first) return first
  }
  return null
}

/** Campus-local seconds elapsed today. Whole-minute UTC offsets make `getSeconds()` safe. */
function secondsOfDay(now: Date): number {
  return minutesOfDate(now) * 60 + now.getSeconds()
}

/**
 * Resolve the app state into the one thing the card talks about.
 *
 * A non-null `scrubMinutes` overrides the live clock: the same three questions are
 * asked of the scrubbed day at the scrubbed minute, so the card follows the playhead.
 */
export function resolveFocus(state: AppState): Focus {
  const scrub = state.scrubMinutes
  if (scrub !== null) {
    const sessions = WEEK[state.scrubDay]
    const current = sessions.find((s) => scrub >= s.start && scrub < s.end)
    if (current) {
      return {
        now: { kind: 'in-class', session: current, minutesLeft: current.end - scrub },
        session: current,
        day: state.scrubDay,
        seconds: (current.end - scrub) * 60,
        scrubbing: true,
      }
    }
    const upcoming = sessions.find((s) => s.start > scrub)
    if (upcoming) {
      return {
        now: {
          kind: 'before-next',
          session: upcoming,
          minutesUntil: upcoming.start - scrub,
          sameDay: true,
        },
        session: upcoming,
        day: state.scrubDay,
        seconds: (upcoming.start - scrub) * 60,
        scrubbing: true,
      }
    }
    const next = firstSessionAfterDay(state.scrubDay)
    return {
      now: { kind: 'day-done', next },
      session: next,
      day: next?.day ?? null,
      seconds: null,
      scrubbing: true,
    }
  }

  const now = resolveNow(state.now, WEEK)
  const elapsed = secondsOfDay(state.now)
  switch (now.kind) {
    case 'in-class':
      return {
        now,
        session: now.session,
        day: now.session.day,
        seconds: now.session.end * 60 - elapsed,
        scrubbing: false,
      }
    case 'before-next':
      return {
        now,
        session: now.session,
        day: now.session.day,
        seconds: now.session.start * 60 - elapsed,
        scrubbing: false,
      }
    case 'day-done':
      return { now, session: now.next, day: now.next?.day ?? null, seconds: null, scrubbing: false }
    case 'pre-term':
      return {
        now,
        session: now.firstSession,
        day: now.firstSession.day,
        seconds: null,
        scrubbing: false,
      }
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** `2026-09-09` -> `SEP 9`. */
function termStartLabel(): string {
  const [, month, day] = TERM_START.split('-')
  const index = Number(month) - 1
  return `${MONTHS[index] ?? '???'} ${Number(day)}`
}

const FULL_DAY: Record<Day, string> = {
  Mon: 'MONDAY',
  Tue: 'TUESDAY',
  Wed: 'WEDNESDAY',
  Thu: 'THURSDAY',
  Fri: 'FRIDAY',
}

/** `TOMORROW` when the next class really is tomorrow, otherwise the weekday name. */
function dayDoneLabel(now: Date, next: Session | null): string {
  if (!next) return 'TERM COMPLETE'
  const tomorrow = dayOfDate(new Date(now.getTime() + 86_400_000))
  return tomorrow === next.day ? 'TOMORROW' : FULL_DAY[next.day]
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `28:14`, or `1:28:14` once an hour is involved. Never negative. */
function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface NowNextDeps {
  store: Store<AppState>
  onSelect: (s: Session | null) => void
}

export interface NowNextView {
  el: HTMLElement
  /**
   * `ownsTransitionNote` — when true this card carries the single
   * `data-testid="transition-note"` on the page. The detail card takes it over the
   * moment a class is selected, so exactly one such element ever exists.
   */
  update(state: AppState, ownsTransitionNote: boolean): void
}

/**
 * Create the Now/Next card.
 *
 * Tapping the card selects the session it is describing, which is the shortest path
 * from "cold open" to "fly me there".
 */
export function createNowNext(deps: NowNextDeps): NowNextView {
  const root = el('section', 'nn')
  root.setAttribute('data-testid', 'now-next')

  const card = el('button', 'nn-card')
  card.type = 'button'
  root.append(card)

  // Everything inside the button is a <span>: a <button>'s content model is phrasing
  // content, and ui.css gives these spans block layout.
  const label = el('span', 'nn-label')
  const badge = el('span', 'nn-badge mono')
  const top = el('span', 'nn-top')
  top.append(label, badge)

  const code = el('span', 'nn-code')
  const title = el('span', 'nn-title')
  const where = el('span', 'nn-where mono')
  const countNum = el('span', 'nn-count-num mono')
  const countLabel = el('span', 'nn-count-label')
  const count = el('span', 'nn-count')
  count.append(countNum, countLabel)
  const walk = el('span', 'nn-walk mono')
  const note = el('p', 'nn-note')

  card.append(top, code, title, where, count, walk)
  root.append(note)

  /** Structure is only rebuilt when this changes; the countdown updates in place. */
  let shape = ''
  let subject: Session | null = null

  card.addEventListener('click', () => {
    if (!subject) return
    deps.store.set({ selected: subject })
    deps.onSelect(subject)
  })

  function update(state: AppState, ownsTransitionNote: boolean): void {
    const focus = resolveFocus(state)
    subject = focus.session
    card.disabled = subject === null

    const session = focus.session
    const dark = session ? endsAfterDark(session, state.now) : false
    const after = session ? transitionAfter(session) : null
    const before = session ? transitionBefore(session) : null
    const kind = focus.now.kind

    const nextShape = [
      kind,
      session?.course.id ?? '-',
      session?.day ?? '-',
      dark ? 'dark' : 'day',
      ownsTransitionNote ? 'note' : 'quiet',
    ].join('|')

    if (nextShape !== shape) {
      shape = nextShape
      root.dataset['kind'] = kind

      label.textContent =
        kind === 'in-class'
          ? 'NOW'
          : kind === 'before-next'
            ? 'NEXT UP'
            : kind === 'pre-term'
              ? `TERM STARTS ${termStartLabel()}`
              : dayDoneLabel(state.now, session)

      badge.textContent = focus.scrubbing ? 'SCRUBBING' : ''
      badge.hidden = !focus.scrubbing

      if (session) {
        code.textContent = session.course.code
        title.textContent = session.course.title
        where.textContent = `${shortBuilding(session.course.building)} ${session.course.room} · ${timeRange(session.start, session.end)}${dark ? ' 🌙' : ''}`
        where.hidden = false
        title.hidden = false
        code.hidden = false
      } else {
        code.textContent = 'No classes left'
        title.textContent = 'The Fall 2026 term is over. Go outside.'
        where.hidden = true
        title.hidden = false
        code.hidden = false
      }

      // Walk line: only meaningful when a real walk stands between you and this class.
      if (kind === 'before-next' && session && before && before.walkMinutes > 0) {
        walk.textContent = `${before.walkMinutes} min walk · leave by ${minutesToHHMM(session.start - before.walkMinutes)}`
        walk.hidden = false
        walk.dataset['kind'] = before.kind
      } else if (kind === 'before-next' && before) {
        walk.textContent = 'Same building — no walk.'
        walk.hidden = false
        walk.dataset['kind'] = before.kind
      } else {
        walk.hidden = true
      }

      // The "and then?" line. Only one transition-note may exist on the page at a
      // time, so the detail card takes the testid whenever a class is selected.
      if (after) {
        note.textContent = after.note
        note.dataset['kind'] = after.kind
        note.hidden = false
        if (ownsTransitionNote) note.setAttribute('data-testid', 'transition-note')
        else note.removeAttribute('data-testid')
      } else {
        note.hidden = true
        note.removeAttribute('data-testid')
      }
    }

    // --- ticking part: one text node, once a second, no reflow ------------------
    if (focus.seconds !== null) {
      countNum.textContent = clockText(focus.seconds)
      countLabel.textContent = kind === 'in-class' ? 'until it ends' : 'until it starts'
      count.hidden = false
    } else if (session) {
      countNum.textContent = `${session.day.toUpperCase()} ${minutesToHHMM(session.start)}`
      countLabel.textContent = kind === 'pre-term' ? 'first class of the term' : 'next class'
      count.hidden = false
    } else {
      count.hidden = true
    }
  }

  return { el: root, update }
}
