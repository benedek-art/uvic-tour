/**
 * The five classes.
 *
 * One row per course — five in total, which is what the E2E suite counts — grouped
 * under the weekday the course first meets and ordered by start time inside each
 * group. Each row is a single 56 px-tall button, comfortably over the 44 px minimum,
 * because on a phone the whole row is the target and nothing here is hover-only.
 *
 * The gold left rule is the one place gold appears in the sheet: it ties a row to its
 * building on the map (SPEC §4 — gold is reserved for the student's own buildings).
 *
 * Any session that lets out after sunset carries a moon beside its time (SPEC §5.9);
 * that flag is date-dependent, so it re-renders as the term moves toward November.
 */

import './ui.css'
import type { AppState } from './sheet'
import type { Store } from './store'
import { endsAfterDark } from '../core/sun'
import { DAYS } from '../core/time'
import type { Session } from '../core/week'
import { COURSES, type Course, type Day } from '../data/schedule'
import { WEEK, dayList, shortBuilding, timeRange } from './now-next'

const FULL_DAY: Record<Day, string> = {
  Mon: 'MONDAY',
  Tue: 'TUESDAY',
  Wed: 'WEDNESDAY',
  Thu: 'THURSDAY',
  Fri: 'FRIDAY',
}

/** The weekday a course first meets — the group it is filed under. */
function firstDay(course: Course): Day {
  return DAYS.find((d) => course.days.includes(d)) ?? 'Mon'
}

/**
 * The canonical session for a row: the course's meeting on its first weekday.
 *
 * Picking one specific day (rather than an abstract course) is what lets the detail
 * card show real transition analysis — "what happens right after this class" only has
 * an answer on a particular day.
 */
function canonicalSession(course: Course): Session {
  const day = firstDay(course)
  const found = WEEK[day].find((s) => s.course.id === course.id)
  return found ?? { course, day, start: course.start, end: course.end }
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

export interface ClassListDeps {
  store: Store<AppState>
  onSelect: (s: Session | null) => void
}

export interface ClassListView {
  el: HTMLElement
  update(state: AppState): void
}

interface Row {
  el: HTMLButtonElement
  session: Session
  time: HTMLElement
}

/**
 * Build the list once; updates only toggle the selected row and the moon glyphs.
 * Rebuilding five buttons every clock tick would drop `:active` mid-tap.
 */
export function createClassList(deps: ClassListDeps): ClassListView {
  const root = el('section', 'cl')

  const heading = el('h2', 'cl-heading', 'Your five')
  root.append(heading)

  const rows: Row[] = []
  const grouped = new Map<Day, Course[]>()
  for (const course of COURSES) {
    const day = firstDay(course)
    const bucket = grouped.get(day)
    if (bucket) bucket.push(course)
    else grouped.set(day, [course])
  }

  for (const day of DAYS) {
    const courses = grouped.get(day)
    if (!courses) continue
    courses.sort((a, b) => a.start - b.start)

    const group = el('div', 'cl-group')
    group.append(el('h3', 'cl-day mono', FULL_DAY[day]))

    for (const course of courses) {
      const session = canonicalSession(course)

      const button = el('button', 'cl-row')
      button.type = 'button'
      button.setAttribute('data-testid', 'class-row')
      button.dataset['courseId'] = course.id

      const rule = el('span', 'cl-rule')
      rule.setAttribute('aria-hidden', 'true')

      const main = el('span', 'cl-main')
      main.append(el('span', 'cl-code', course.code), el('span', 'cl-title', course.title))

      const time = el('span', 'cl-time mono')
      const meta = el('span', 'cl-meta')
      meta.append(time, el('span', 'cl-room mono', `${shortBuilding(course.building)} ${course.room}`))

      button.append(rule, main, meta)
      button.addEventListener('click', () => {
        deps.store.set({ selected: session })
        deps.onSelect(session)
      })

      group.append(button)
      rows.push({ el: button, session, time })
    }

    root.append(group)
  }

  function update(state: AppState): void {
    const selectedId = state.selected?.course.id ?? null
    for (const row of rows) {
      const { course } = row.session
      const dark = endsAfterDark(row.session, state.now)
      const days = dayList(course.days)
      const text = `${days} · ${timeRange(course.start, course.end)}${dark ? ' 🌙' : ''}`
      if (row.time.textContent !== text) row.time.textContent = text
      row.time.dataset['dark'] = dark ? 'true' : 'false'

      const isSelected = course.id === selectedId
      row.el.classList.toggle('is-selected', isSelected)
      if (isSelected) row.el.setAttribute('aria-current', 'true')
      else row.el.removeAttribute('aria-current')
    }
  }

  return { el: root, update }
}
