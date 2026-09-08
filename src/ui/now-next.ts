/**
 * The hero card — "where is my next class and when do I leave?"
 *
 * SPEC §5.1 and success criterion 2: a cold open must answer that question in under
 * five seconds with no tapping. So this card is the first thing in the sheet, it is
 * visible at the peek detent, and it never asks for input.
 *
 * It is also the ONLY thing visible at the peek detent (docs/REDESIGN.md §2): one
 * answer, and one filled terracotta button — "Take me there" — which draws the walk
 * on the map without covering it. The type ladder is the design: countdown 36 px,
 * building 21 px, everything else 13-14 px, because a first-year needs *how long*
 * and *where*, in that order. The course code and title are demoted to a single
 * quiet line; they name nothing anyone can walk to.
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
import './home.css'
import type { AppState } from './sheet'
import type { Store } from './store'
import { analyzeDay, type Transition } from '../core/transitions'
import { endsAfterDark } from '../core/sun'
import { DAYS, TERM_START, dayOfDate, minutesOfDate, minutesToHHMM } from '../core/time'
import { buildWeek, resolveNow, type NowState, type Session } from '../core/week'
import { walkFromHome } from '../data/home'
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

/** True when nothing on campus precedes this session — they are coming from home. */
export function isFirstOfDay(session: Session): boolean {
  return transitionBefore(session) === null
}

/**
 * The "leave by" line for the first class of a day.
 *
 * Every other walk in this card is building-to-building, but the first class has no
 * predecessor — the walk that actually decides whether they are late starts at their
 * room in Roderick Haig-Brown. Same two facts, same shape, different origin.
 *
 * Null when the session is not first on its day (the transition note covers it) or
 * when home cannot be routed to that building.
 */
export function homeWalkLine(session: Session): string | null {
  if (!isFirstOfDay(session)) return null
  const walk = walkFromHome(session.course.building)
  if (!walk) return null
  return `${walk.minutes} min from home · leave by ${minutesToHHMM(session.start - walk.minutes)}`
}

/**
 * Building names as a human would say them out loud.
 *
 * The old code showed `BWC B150`. To someone who has never been on campus that is
 * two pieces of undecoded jargon: they cannot ask a stranger for "BWC", and they
 * cannot read it off a sign. The OSM name is the truth, but one of the three is a
 * 37-character mouthful, so it gets an ampersand and loses the word "Building".
 * Everything the student must *say* or *look for* is spelled out.
 */
export const BUILDING_NAME: Record<string, string> = {
  'Bob Wright Centre': 'Bob Wright Centre',
  'MacLaurin Building': 'MacLaurin Building',
  'Engineering/Computer Science Building': 'Engineering & Computer Science',
}

export function friendlyBuilding(name: string): string {
  return BUILDING_NAME[name] ?? name
}

/** `Room B150` — the word matters; a bare `B150` is a code, not a place. */
export function roomLabel(room: string): string {
  return `Room ${room}`
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

/**
 * `28:14` under the hour, `1h 28m` over it. Never negative.
 *
 * `1:28:14` is a stopwatch, and a stopwatch has to be decoded: is that one hour or
 * one minute? Over an hour the seconds are noise anyway, so the units are spelled
 * out and the digits stop twitching. Under an hour mm:ss is unambiguous and the
 * ticking is the point — that is when leaving on time starts to matter.
 */
function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}h ${pad2(m)}m` : `${pad2(m)}:${pad2(sec)}`
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
  /**
   * The one big button. Optional so the card can be mounted bare in a unit test;
   * `mountSheet` always wires it to the map's route drawing.
   */
  onGo?: (s: Session) => void
}

export interface NowNextView {
  el: HTMLElement
  /**
   * `ownsTransitionNote` — when true this card carries the single
   * `data-testid="transition-note"` on the page. The detail card takes it over the
   * moment a class is selected, so exactly one such element ever exists.
   *
   * Returns true when the card's *structure* was rebuilt (not just the ticking
   * countdown). The sheet re-measures its peek detent on that, because a two-line
   * building name is taller than a one-line one and a stale peek height clips the
   * button off the bottom of the card.
   */
  update(state: AppState, ownsTransitionNote: boolean): boolean
}

/**
 * Create the Now/Next card.
 *
 * The hierarchy is deliberate and it is the whole design (docs/REDESIGN.md §2). A
 * first-year between classes asks two questions, in this order: *how long have I
 * got*, and *where am I going*. So the countdown is the largest thing on the card
 * and the building name is second; the course code and title — which they already
 * know, and which name nothing they can walk to — are demoted to one quiet line.
 *
 * Below that sits one filled terracotta button, "Take me there". It is the only
 * coloured surface at the peek detent, so there is never a question about what to
 * press. Everything above it is a single quiet tap target that opens the full detail
 * (the room decoder lives there), which is why the building name carries a chevron.
 */
export function createNowNext(deps: NowNextDeps): NowNextView {
  const root = el('section', 'nn')
  root.setAttribute('data-testid', 'now-next')

  const card = el('div', 'nn-card')
  root.append(card)

  // The information block is one big quiet button: tapping anywhere on it opens the
  // class in full. It is a <button>, so everything inside it is a <span> — a button's
  // content model is phrasing content — and ui.css gives those spans block layout.
  const open = el('button', 'nn-open')
  open.type = 'button'

  const label = el('span', 'nn-label')
  const badge = el('span', 'nn-badge mono')
  const top = el('span', 'nn-top')
  top.append(label, badge)

  const countNum = el('span', 'nn-count-num mono')
  const countLabel = el('span', 'nn-count-label')
  const count = el('span', 'nn-count')
  count.append(countNum, countLabel)

  const placeName = el('span', 'nn-place-name')
  const chevron = el('span', 'nn-chev')
  chevron.setAttribute('aria-hidden', 'true')
  chevron.textContent = '›'
  const place = el('span', 'nn-place')
  place.append(placeName, chevron)

  const room = el('span', 'nn-room mono')
  const walk = el('span', 'nn-walk mono')

  open.append(top, count, place, room, walk)

  const go = el('button', 'nn-go')
  go.type = 'button'
  go.textContent = 'Take me there'

  card.append(open, go)

  const note = el('p', 'nn-note')
  root.append(note)

  /** Structure is only rebuilt when this changes; the countdown updates in place. */
  let shape = ''
  let subject: Session | null = null

  open.addEventListener('click', () => {
    if (!subject) return
    deps.store.set({ selected: subject })
    deps.onSelect(subject)
  })

  go.addEventListener('click', () => {
    if (!subject) return
    deps.onGo?.(subject)
  })

  function update(state: AppState, ownsTransitionNote: boolean): boolean {
    const focus = resolveFocus(state)
    subject = focus.session
    open.disabled = subject === null

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
      focus.scrubbing ? 'scrub' : 'live',
      state.selected ? 'picked' : 'open',
    ].join('|')

    let rebuilt = false
    if (nextShape !== shape) {
      rebuilt = true
      shape = nextShape
      root.dataset['kind'] = kind

      // Plain words. "IN CLASS NOW", not "NOW"; "YOUR NEXT CLASS", not "NEXT UP".
      // `TERM STARTS …` is uppercase in the string itself because a unit test reads
      // textContent, which never sees `text-transform`.
      label.textContent =
        kind === 'in-class'
          ? 'IN CLASS NOW'
          : kind === 'before-next'
            ? 'YOUR NEXT CLASS'
            : kind === 'pre-term'
              ? `TERM STARTS ${termStartLabel()}`
              : session
                ? `NEXT CLASS ${dayDoneLabel(state.now, session)}`
                : dayDoneLabel(state.now, session)

      badge.textContent = focus.scrubbing ? 'PREVIEW' : ''
      badge.hidden = !focus.scrubbing

      if (session) {
        // The place, loud. The course code and the clock, quiet and on one line.
        placeName.textContent = friendlyBuilding(session.course.building)
        place.hidden = false
        room.textContent = `${roomLabel(session.course.room)} · ${session.course.code} · ${timeRange(session.start, session.end)}${dark ? ' 🌙' : ''}`
        room.hidden = false
        open.setAttribute(
          'aria-label',
          `${session.course.code}, ${friendlyBuilding(session.course.building)}, ${roomLabel(session.course.room)}. Open the details.`,
        )
      } else {
        placeName.textContent = 'No classes left'
        place.hidden = false
        room.textContent = 'The Fall 2026 term is over. Go outside.'
        room.hidden = false
        open.removeAttribute('aria-label')
      }

      // Fewer things visible at once (docs/REDESIGN.md §2.3). Selecting a class opens
      // the detail card, which carries its own primary walk button; two filled
      // terracotta buttons in one scroll is two answers to "what do I press?".
      go.hidden = session === null || state.selected !== null

      // Walk line: only meaningful when a real walk stands between you and this class.
      // Three origins, in order — the class before it, the same building, or home.
      // The home case is what the first class of any day gets: `before` is null there,
      // so nothing above it changes and the line is no longer simply blank.
      const homeLine = session && kind !== 'in-class' ? homeWalkLine(session) : null
      walk.removeAttribute('data-testid')
      if (kind === 'before-next' && session && before && before.walkMinutes > 0) {
        walk.textContent = `${before.walkMinutes} min walk · leave by ${minutesToHHMM(session.start - before.walkMinutes)}`
        walk.hidden = false
        walk.dataset['kind'] = before.kind
      } else if (kind === 'before-next' && before) {
        walk.textContent = 'Same building — no walk.'
        walk.hidden = false
        walk.dataset['kind'] = before.kind
      } else if (homeLine) {
        walk.textContent = homeLine
        walk.hidden = false
        walk.dataset['kind'] = 'home'
        walk.setAttribute('data-testid', 'home-walk')
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
      countLabel.textContent = kind === 'pre-term' ? 'your first class' : 'next class'
      count.hidden = false
    } else {
      count.hidden = true
    }

    return rebuilt
  }

  return { el: root, update }
}
