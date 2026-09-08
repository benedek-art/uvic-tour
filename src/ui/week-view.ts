/**
 * The week view — Tier 2 of the sheet (docs/WEEK-VIEW.md).
 *
 * The standard this is held to: **a stranger scrolls this once and understands their
 * whole week.** Not "can find it if they hunt" — understands. Everything below is in
 * service of that one sentence.
 *
 * The shape of the week is the content. A student's Monday is not "three classes"; it
 * is 08:30 in Bob Wright, then a six-hour hole, then two back-to-back lectures in the
 * *same room*. So the gaps are rendered as rows in their own right, on the same spine
 * as the classes, and a long free gap is physically TALLER than a short one — the hole
 * in Monday looks like a hole before a single word is read.
 *
 * Reading order inside a class row is fixed by the brief and never changes: time,
 * building in plain words, room, then the course code and title, quieter. A first-year
 * cannot walk to "PSYC 100B" and cannot ask a stranger for "MAC" — they can walk to the
 * MacLaurin Building and look for Room A144.
 *
 * Pure presentation. No map import, no camera call; the two callbacks are the only way
 * out of this module. It reads `src/core` and `src/data` only, so it stays testable in
 * jsdom and cannot drift into orchestration.
 *
 * PERFORMANCE / CORRECTNESS: the store fires once a SECOND from the app's clock
 * interval. The DOM is therefore built exactly once at mount, and `update()` only
 * writes text nodes and toggles classes. Rebuilding the tree per tick would reset the
 * scroll position of the sheet and kill any in-flight touch — the same class of bug the
 * Now/Next card guards against with its `shape` string.
 */

import './week-view.css'
import type { Store } from './store'
import type { AppState } from './sheet'
import { endsAfterDark } from '../core/sun'
import {
  DAYS,
  campusDateKey,
  dayOfDate,
  isInTerm,
  minutesOfDate,
  minutesToHHMM,
} from '../core/time'
import { analyzeDay, type Transition } from '../core/transitions'
import { buildWeek, type Session } from '../core/week'
import { COURSES, type Day } from '../data/schedule'

export interface WeekViewDeps {
  store: Store<AppState>
  /** Tapping a class row: orchestrator flies the camera and opens the detail card. */
  onSelectSession: (s: Session) => void
  /** Tapping a day header: orchestrator lights that day's buildings on the map. */
  onFocusDay: (d: Day) => void
}

export interface WeekView {
  destroy(): void
}

/* ------------------------------------------------------------------ language --- */

/**
 * Building names as a human would say them out loud.
 *
 * Deliberately duplicated from now-next.ts rather than imported: this module keeps its
 * runtime imports to `src/core` and `src/data` so it cannot be broken by work on the
 * sheet, and so it mounts in a test with no other UI module present. Three strings.
 */
const BUILDING_NAME: Record<string, string> = {
  'Bob Wright Centre': 'Bob Wright Centre',
  'MacLaurin Building': 'MacLaurin Building',
  'Engineering/Computer Science Building': 'Engineering & Computer Science',
}

function friendlyBuilding(name: string): string {
  return BUILDING_NAME[name] ?? name
}

/** `Room B150` — the word matters; a bare `B150` is a code, not a place. */
function roomLabel(room: string): string {
  return `Room ${room}`
}

const FULL_DAY: Record<Day, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
}

/** Past this a gap stops being a wait and becomes free time to plan around. */
const LONG_BREAK = 120

/** `45 min` while minutes still read at a glance, `6h 40m` once they stop. */
function durationLabel(m: number): string {
  if (m < 60) return `${m} min`
  const hours = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * What a connector between two classes says.
 *
 * `head` is the verdict and carries the row on its own; `sub` is the one supporting
 * clause, and is empty when nothing useful can be added. The rule the brief cares
 * about: a long gap reads as FREE TIME (`6h 40m free`), never as a walk — nobody
 * spends six hours walking across a campus you can cross in five minutes.
 */
function gapText(t: Transition): { head: string; sub: string } {
  if (t.kind === 'same-room') {
    return { head: 'Stay put — same room', sub: `${t.gapMinutes} min between them` }
  }
  if (t.gapMinutes >= LONG_BREAK) {
    return {
      head: `${durationLabel(t.gapMinutes)} free`,
      sub: t.walkMinutes > 0 ? `then a ${t.walkMinutes} min walk over` : 'same building after',
    }
  }
  if (t.kind === 'impossible') {
    return {
      head: `${t.walkMinutes} min walk`,
      sub: `only ${t.gapMinutes} min — you can't make this on foot`,
    }
  }
  if (t.kind === 'tight') {
    return { head: `${t.walkMinutes} min walk`, sub: `only ${t.gapMinutes} min — leave right away` }
  }
  if (t.walkMinutes === 0) {
    return { head: 'Same building', sub: `${t.gapMinutes} min between them` }
  }
  return { head: `${t.walkMinutes} min walk`, sub: `${t.gapMinutes} min gap` }
}

/* ------------------------------------------------------------------- summary --- */

/**
 * The orientation anchor: one line that says how big the week is before any of it is
 * read. Derived, never hardcoded — edit `COURSES` and this line follows.
 *
 * "Longest day" is measured by how long the student is stuck on campus (first start to
 * last end), not by class count, because that is what "long day" means when you live
 * it. Monday: 08:30 to 19:20.
 */
function weekSummary(week: Record<Day, Session[]>): string {
  const courses = new Set<string>()
  const buildings = new Set<string>()
  let longest: { day: Day; span: number } | null = null

  for (const day of DAYS) {
    const sessions = week[day]
    for (const s of sessions) {
      courses.add(s.course.id)
      buildings.add(s.course.building)
    }
    const first = sessions[0]
    const last = sessions[sessions.length - 1]
    if (!first || !last) continue
    const span = last.end - first.start
    if (!longest || span > longest.span) longest = { day, span }
  }

  // A sentence, not a list of chips: it wraps to two clean lines on a 390 px screen
  // with no separator left dangling at the break, and it is what a person would say.
  const size =
    `${courses.size} ${courses.size === 1 ? 'course' : 'courses'} in ` +
    `${buildings.size} ${buildings.size === 1 ? 'building' : 'buildings'}.`
  return longest ? `${size} ${FULL_DAY[longest.day]} is your longest day.` : size
}

/** `3 classes · 08:30–19:20` — the day's size and the hours it eats. */
function dayMeta(sessions: Session[]): string {
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  if (!first || !last) return 'No classes'
  const count = `${sessions.length} ${sessions.length === 1 ? 'class' : 'classes'}`
  return `${count} · ${minutesToHHMM(first.start)}–${minutesToHHMM(last.end)}`
}

/* ----------------------------------------------------------------------- DOM --- */

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

interface ClassRow {
  el: HTMLButtonElement
  session: Session
  /** The 🌙 that appears when this class lets out after sunset — date dependent. */
  moon: HTMLElement
  /** `Now` / `Next` on today's rows; hidden on every other day. */
  state: HTMLElement
}

interface DayBlock {
  day: Day
  el: HTMLElement
  todayPill: HTMLElement
}

/**
 * Build the week view into `container` and keep it in sync with the store.
 *
 * Returns a `destroy()` that unsubscribes and empties the container — the sheet owns
 * the lifecycle, this owns nothing global.
 */
export function mountWeekView(container: HTMLElement, deps: WeekViewDeps): WeekView {
  const { store } = deps
  const week = buildWeek(COURSES)

  const root = el('section', 'wk')
  root.setAttribute('data-testid', 'week-view')

  const head = el('header', 'wk-head')
  const summary = el('p', 'wk-summary', weekSummary(week))
  summary.setAttribute('data-testid', 'week-summary')
  head.append(
    el('h2', 'wk-title', 'Your week'),
    summary,
    el('p', 'wk-hint', 'Tap a day to see it on the map. Tap a class for directions.'),
  )
  root.append(head)

  const rows: ClassRow[] = []
  const blocks: DayBlock[] = []

  for (const day of DAYS) {
    const sessions = week[day]
    const transitions: Transition[] = analyzeDay(sessions)

    const block = el('section', 'wk-day')
    block.setAttribute('data-testid', 'week-day')
    block.dataset['day'] = day

    // The header is a button: tapping it lights that day's buildings on the map.
    // 44 px minimum comes from the CSS, not from a magic number here.
    const header = el('button', 'wk-dayhead')
    header.type = 'button'
    header.setAttribute('data-testid', 'day-header')
    header.dataset['day'] = day
    header.setAttribute(
      'aria-label',
      `${FULL_DAY[day]}, ${dayMeta(sessions)}. Show this day on the map.`,
    )

    const todayPill = el('span', 'wk-today', 'Today')
    todayPill.hidden = true

    const headText = el('span', 'wk-dayhead-text')
    headText.append(
      el('span', 'wk-dayname', FULL_DAY[day]),
      el('span', 'wk-daymeta mono', dayMeta(sessions)),
    )
    header.append(headText, todayPill)
    header.addEventListener('click', () => deps.onFocusDay(day))

    const list = el('ol', 'wk-rows')

    sessions.forEach((session, index) => {
      // The connector BEFORE this class (everything except the first of the day).
      const transition = index > 0 ? transitions[index - 1] : undefined
      if (transition) {
        const { head: gapHead, sub } = gapText(transition)
        const free = transition.gapMinutes >= LONG_BREAK

        const gap = el('li', 'wk-gap')
        gap.setAttribute('data-testid', 'week-gap-row')
        gap.dataset['kind'] = transition.kind
        gap.dataset['free'] = free ? 'true' : 'false'

        const body = el('span', 'wk-gap-body')
        body.append(el('span', 'wk-gap-head', gapHead))
        if (sub) body.append(el('span', 'wk-gap-sub', sub))
        gap.append(body)
        list.append(gap)
      }

      const item = el('li', 'wk-item')
      const button = el('button', 'wk-class')
      button.type = 'button'
      button.setAttribute('data-testid', 'week-class-row')
      button.dataset['courseId'] = session.course.id
      button.dataset['day'] = day

      const time = el('span', 'wk-time mono')
      const moon = el('span', 'wk-moon', '🌙')
      moon.setAttribute('role', 'img')
      moon.setAttribute('aria-label', 'ends after dark')
      moon.hidden = true
      time.append(
        el('span', 'wk-start', minutesToHHMM(session.start)),
        el('span', 'wk-end', minutesToHHMM(session.end)),
        moon,
      )

      const state = el('span', 'wk-state')
      state.hidden = true

      const where = el('span', 'wk-where')
      where.append(el('span', 'wk-bldg', friendlyBuilding(session.course.building)), state)

      const body = el('span', 'wk-body')
      body.append(
        where,
        el('span', 'wk-room mono', roomLabel(session.course.room)),
        el('span', 'wk-course', `${session.course.code} · ${session.course.title}`),
      )

      button.append(time, body)
      button.setAttribute(
        'aria-label',
        `${minutesToHHMM(session.start)} ${session.course.code}, ` +
          `${friendlyBuilding(session.course.building)}, ${roomLabel(session.course.room)}.`,
      )
      button.addEventListener('click', () => {
        store.set({ selected: session })
        deps.onSelectSession(session)
      })

      item.append(button)
      list.append(item)
      rows.push({ el: button, session, moon, state })
    })

    if (sessions.length === 0) {
      list.append(el('li', 'wk-empty', 'Nothing scheduled — the day is yours.'))
    }

    block.append(header, list)
    root.append(block)
    blocks.push({ day, el: block, todayPill })
  }

  /** Sunset is a per-DATE fact; recompute the moons only when the date rolls over. */
  let darkKey = ''
  const dark = new Map<HTMLButtonElement, boolean>()

  function update(state: AppState): void {
    const key = campusDateKey(state.now)
    if (key !== darkKey) {
      darkKey = key
      for (const row of rows) dark.set(row.el, endsAfterDark(row.session, state.now))
    }

    // "Today" only exists inside the term — in August every day is equally not today,
    // and a false Today marker is worse than none.
    const today = isInTerm(state.now) ? dayOfDate(state.now) : null
    const minutes = minutesOfDate(state.now)
    const selectedId = state.selected?.course.id ?? null
    const selectedDay = state.selected?.day ?? null

    // The single class that is next up today, if any — computed once, not per row.
    const upcoming = today ? week[today].find((s) => s.start > minutes) : undefined

    for (const block of blocks) {
      const isToday = block.day === today
      block.el.classList.toggle('is-today', isToday)
      block.todayPill.hidden = !isToday
    }

    for (const row of rows) {
      const isDark = dark.get(row.el) ?? false
      if (row.moon.hidden === isDark) row.moon.hidden = !isDark

      const isSelected =
        row.session.course.id === selectedId && row.session.day === selectedDay
      row.el.classList.toggle('is-selected', isSelected)
      if (isSelected) row.el.setAttribute('aria-current', 'true')
      else row.el.removeAttribute('aria-current')

      // The "now" line on today's rows: what is running, what is next, what is done.
      let label = ''
      let phase = ''
      if (row.session.day === today) {
        if (minutes >= row.session.start && minutes < row.session.end) {
          label = 'Now'
          phase = 'now'
        } else if (minutes >= row.session.end) {
          phase = 'past'
        } else if (upcoming && upcoming.course.id === row.session.course.id) {
          label = 'Next'
          phase = 'next'
        }
      }
      if (row.state.textContent !== label) row.state.textContent = label
      row.state.hidden = label === ''
      row.state.dataset['phase'] = phase
      row.el.classList.toggle('is-now', phase === 'now')
      row.el.classList.toggle('is-next', phase === 'next')
      row.el.classList.toggle('is-past', phase === 'past')
    }
  }

  container.append(root)
  update(store.get())
  const unsubscribe = store.subscribe(update)

  return {
    destroy(): void {
      unsubscribe()
      root.remove()
    },
  }
}
