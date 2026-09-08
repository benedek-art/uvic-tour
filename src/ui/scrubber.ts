/**
 * The week scrubber — drag through a day and watch the campus re-light.
 *
 * This is the feature that turns a timetable into something physical: you grab the
 * playhead, pull it across Monday, and Bob Wright ignites at 08:30 and goes dark at
 * 09:50 while MacLaurin stays lit from 16:30 straight through to 19:20. It is the
 * fastest way to feel the *shape* of a week (docs/SPEC.md §5.3).
 *
 * MOBILE FIRST. The desktop plan draws all five days as stacked rows, but five rows
 * plus labels do not fit above a bottom sheet on a 390px phone. So the phone gets a
 * strip of five day pills over a single-row timeline for the selected day, and the
 * stacked Mon–Fri grid is the ≥900px progressive enhancement. Both layouts render the
 * same DOM; only CSS decides how many rows are visible.
 *
 * Data flow is one-directional. The store is the source of truth for
 * `scrubDay`/`scrubMinutes`; this component never writes to it. Interactions call
 * `deps.onScrub(day, minutes)` and the orchestrator decides what that means (re-light
 * the map, patch the store). `minutes === null` means "back to the live clock".
 *
 * The one concession to latency is `pending`: while a drag is in flight the playhead
 * follows the finger immediately rather than waiting for a store round-trip. As soon
 * as the store reports a different scrub value, the store wins and `pending` is
 * dropped, so the two can never drift apart.
 *
 * COLLAPSED BY DEFAULT (docs/REDESIGN.md §2, rule 3).
 * Dragging through a week is a *second* question. The first one is "where is my next
 * class?", and the sheet answers that on its own. So the resting state of `#scrubber` is
 * a single quiet button — **My week** — and the timeline only exists once you ask for it.
 * The whole tree is still built and mounted at load; only CSS (`.scrub.is-open`) decides
 * whether the panel is on screen, which keeps every measurement, test selector and store
 * subscription exactly where it was.
 *
 * `#scrubber` therefore stays the mounted element and stays measurable: collapsed, its box
 * is the button, so `main.ts`'s `getBoundingClientRect()` reads a *smaller* bottom chrome
 * and the map simply gets more room. When collapsed the container is `pointer-events:none`
 * (its children are not), so map gestures pass through the empty band beside the button —
 * the same trick `#topbar` uses.
 */

// Vite's ambient types declare `*.css` so the side-effect import below typechecks
// without adding "vite/client" to tsconfig (which is shared with parallel agents).
/// <reference types="vite/client" />

import type { Day } from '../data/schedule'
import { COURSES } from '../data/schedule'
import { DAYS, dayOfDate, minutesOfDate, minutesToHHMM } from '../core/time'
import { buildWeek, type Session } from '../core/week'
import { analyzeDay, type Transition } from '../core/transitions'
import type { Store } from './store'
import './scrubber.css'

/**
 * The slice of app state this component reads.
 *
 * Declared structurally rather than importing `AppState` from `sheet.ts` — that file is
 * authored by a parallel agent and a hard import would be a build-order race. `Store<T>`
 * members are methods, so `Store<AppState>` remains assignable to `Store<ScrubberState>`.
 */
export interface ScrubberState {
  /** Minutes from campus midnight, or `null` when the live clock is in charge. */
  scrubMinutes: number | null
  scrubDay: Day
  now: Date
}

export interface ScrubberDeps {
  store: Store<ScrubberState>
  /** `minutes === null` means "back to now". */
  onScrub: (day: Day, minutes: number | null) => void
}

/** Timeline window, minutes from midnight: 07:00 → 21:00. Covers every class plus air. */
const DAY_START = 420
const DAY_END = 1260
const SPAN = DAY_END - DAY_START

/** Drag resolution. Five minutes is finer than any class boundary and stops the readout twitching. */
const SNAP = 5

/** Short pill labels. Monday-first, matching `DAYS`. */
const PILL_LABEL: Record<Day, string> = {
  Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI',
}

/** Hour gridlines drawn under every track, so blocks read against a scale. */
const TICK_HOURS = [8, 10, 12, 14, 16, 18, 20]

/**
 * Fired on `window` by anything that needs the timeline out of the way — currently the
 * place card, which floats at the same offset and would otherwise land on top of an open
 * panel. A DOM event rather than an import so the two components stay decoupled.
 */
export const COLLAPSE_EVENT = 'uvic:collapse-week'

/** jsdom (and older engines) have no pointer capture; treat it as optional, never assume it. */
interface PointerCapturable {
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/** Minutes → position along the track as a CSS percentage string. 08:30 → `10.7143%`. */
export function offsetPercent(minutes: number): string {
  return `${(((clamp(minutes, DAY_START, DAY_END) - DAY_START) / SPAN) * 100).toFixed(4)}%`
}

/** Fraction of the track's width → snapped minutes, clamped to the visible window. */
function minutesAtFraction(fraction: number): number {
  const raw = DAY_START + clamp(fraction, 0, 1) * SPAN
  return clamp(Math.round(raw / SNAP) * SNAP, DAY_START, DAY_END)
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

/** The session covering `minutes` on this day, if any. Half-open: `[start, end)`. */
function sessionAt(sessions: Session[], minutes: number): Session | null {
  for (const s of sessions) {
    if (minutes >= s.start && minutes < s.end) return s
  }
  return null
}

/** The transition whose gap contains `minutes`, if the playhead sits between two classes. */
function transitionAt(transitions: Transition[], minutes: number): Transition | null {
  for (const t of transitions) {
    if (minutes >= t.from.end && minutes < t.to.start) return t
  }
  return null
}

interface Row {
  root: HTMLElement
  track: HTMLElement
  playhead: HTMLElement
}

/**
 * Build the scrubber into `root` (the `<div id="scrubber">` from index.html) and wire it
 * to the store. Renders once, then only mutates text and transforms — the clock ticks
 * every second and rebuilding the tree that often would be wasteful and would kill any
 * in-flight drag.
 */
export function mountScrubber(root: HTMLElement, deps: ScrubberDeps): void {
  const week = buildWeek(COURSES)
  const transitions: Record<Day, Transition[]> = {
    Mon: analyzeDay(week.Mon), Tue: analyzeDay(week.Tue), Wed: analyzeDay(week.Wed),
    Thu: analyzeDay(week.Thu), Fri: analyzeDay(week.Fri),
  }

  root.classList.add('scrub')
  root.replaceChildren()
  root.hidden = false

  // The panel holds everything the timeline is. It is built now and shown only on
  // request; see the header note on why the resting state is one button.
  const panel = el('div', 'scrub__panel')
  panel.id = 'scrub-panel'

  // --- head: live/scrubbed readout + "back to now" -------------------------------
  const head = el('div', 'scrub__head')
  const readout = el('div', 'scrub__readout')
  const clock = el('span', 'scrub__clock mono', '--:--')
  const status = el('span', 'scrub__status', 'LIVE')
  readout.append(clock, status)

  const backToNow = el('button', 'scrub__back', 'Back to now')
  backToNow.type = 'button'
  backToNow.hidden = true
  head.append(readout, backToNow)

  // --- day pills -----------------------------------------------------------------
  const pillbar = el('div', 'scrub__days')
  pillbar.setAttribute('role', 'group')
  pillbar.setAttribute('aria-label', 'Day of the week')
  const pills = new Map<Day, HTMLButtonElement>()
  for (const day of DAYS) {
    const pill = el('button', 'scrub__pill', PILL_LABEL[day])
    pill.type = 'button'
    pill.dataset['day'] = day
    pill.addEventListener('click', () => {
      // Changing day keeps the current mode: still live if live, still scrubbed if scrubbed.
      setScrub(day, deps.store.get().scrubMinutes)
    })
    pills.set(day, pill)
    pillbar.append(pill)
  }

  // --- one row per day (phone shows the active one; ≥900px shows all five) ---------
  const body = el('div', 'scrub__body')
  const rows = new Map<Day, Row>()

  for (const day of DAYS) {
    const rowRoot = el('div', 'scrub__row')
    rowRoot.dataset['day'] = day

    const label = el('span', 'scrub__rowlabel mono', PILL_LABEL[day])
    const track = el('div', 'scrub__track')
    track.dataset['day'] = day
    track.setAttribute('role', 'slider')
    track.setAttribute('aria-label', `${day} timeline, 07:00 to 21:00`)
    track.setAttribute('aria-valuemin', String(DAY_START))
    track.setAttribute('aria-valuemax', String(DAY_END))
    track.tabIndex = 0

    for (const hour of TICK_HOURS) {
      const tick = el('span', 'scrub__tick')
      tick.style.left = offsetPercent(hour * 60)
      track.append(tick)
    }

    for (const session of week[day]) {
      const block = el('button', 'scrub__block')
      block.type = 'button'
      block.dataset['start'] = String(session.start)
      block.dataset['end'] = String(session.end)
      block.style.left = offsetPercent(session.start)
      block.style.width = `${(((session.end - session.start) / SPAN) * 100).toFixed(4)}%`
      block.setAttribute(
        'aria-label',
        `${session.course.code} ${minutesToHHMM(session.start)} to ${minutesToHHMM(session.end)}, ${session.course.building} ${session.course.room}`,
      )
      block.append(el('span', 'scrub__blocklabel mono', session.course.code))
      block.addEventListener('click', (event) => {
        // Pointer taps are already handled on pointerdown; only keyboard-synthesised
        // clicks (detail === 0) still need snapping, so we never fire onScrub twice.
        if (event.detail === 0) setScrub(day, session.start)
      })
      track.append(block)
    }

    // Transition markers sit in the middle of each gap, coloured by how survivable it is.
    // Monday's 17:50 → 18:00 PSYC handoff is `same-room`, so it reads calm, not alarming.
    for (const t of transitions[day]) {
      const marker = el('span', `scrub__marker scrub__marker--${t.kind}`)
      marker.style.left = offsetPercent((t.from.end + t.to.start) / 2)
      marker.title = t.note
      track.append(marker)
    }

    const playhead = el('span', 'scrub__playhead')
    playhead.setAttribute('aria-hidden', 'true')
    track.append(playhead)

    rowRoot.append(label, track)
    body.append(rowRoot)
    rows.set(day, { root: rowRoot, track, playhead })
  }

  const axis = el('div', 'scrub__axis')
  for (const [pos, text] of [['0', '07:00'], ['50', '14:00'], ['100', '21:00']] as const) {
    const t = el('span', 'scrub__axislabel mono', text)
    t.style.left = `${pos}%`
    axis.append(t)
  }

  const caption = el('p', 'scrub__caption', '')
  panel.append(head, pillbar, body, axis, caption)

  // --- the one control that is on screen by default --------------------------------
  // Plain words, one job, 44px tall. Panel first in the DOM so it opens *upwards*, away
  // from the sheet, and the button stays where the thumb last found it.
  const toggle = el('button', 'scrub__toggle')
  toggle.type = 'button'
  toggle.setAttribute('data-testid', 'week-toggle')
  toggle.setAttribute('aria-controls', 'scrub-panel')
  const toggleLabel = el('span', 'scrub__togglelabel', 'My week')
  const chevron = el('span', 'scrub__chev')
  chevron.setAttribute('aria-hidden', 'true')
  toggle.append(toggleLabel, chevron)

  root.append(panel, toggle)

  /** Show or hide the timeline. Nothing else in the app changes — this is pure disclosure. */
  function setOpen(open: boolean): void {
    root.classList.toggle('is-open', open)
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    // The label always describes what the next tap will DO (redesign rule 5).
    toggleLabel.textContent = open ? 'Hide my week' : 'My week'
  }

  /**
   * Close, and put the map back on the live clock.
   *
   * Without the second half, a user who scrubbed to Thursday 19:00 and then collapsed the
   * panel would be left staring at a map lit for a time that nothing on screen mentions,
   * with the only control that could undo it now hidden. Collapsing means "never mind".
   */
  function collapse(): void {
    if (!root.classList.contains('is-open')) return
    setOpen(false)
    const state = deps.store.get()
    if (state.scrubMinutes !== null || pending?.minutes != null) setScrub(state.scrubDay, null)
  }

  toggle.addEventListener('click', () => {
    if (root.classList.contains('is-open')) collapse()
    else setOpen(true)
  })

  // Another overlay needs this space: stand down rather than stack.
  window.addEventListener(COLLAPSE_EVENT, collapse)

  setOpen(false)

  // ---------------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------------

  /**
   * Optimistic override, live only until the store reports a different scrub value.
   * Without it a fast drag would visibly lag one store round-trip behind the finger.
   */
  let pending: { day: Day; minutes: number | null } | null = null
  let seen: { day: Day; minutes: number | null } | null = null

  /** rAF throttle: a fast drag fires dozens of pointermoves per frame, and each one would
   *  otherwise trigger a full map re-light. We coalesce to at most one per frame. */
  let frame = 0
  let queued: { day: Day; minutes: number } | null = null

  function setScrub(day: Day, minutes: number | null): void {
    pending = { day, minutes }
    render(deps.store.get())
    deps.onScrub(day, minutes)
  }

  function queueScrub(day: Day, minutes: number): void {
    queued = { day, minutes }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const next = queued
      queued = null
      if (next) setScrub(next.day, next.minutes)
    })
  }

  function minutesFromEvent(track: HTMLElement, clientX: number): number {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return DAY_START
    return minutesAtFraction((clientX - rect.left) / rect.width)
  }

  backToNow.addEventListener('click', () => {
    setScrub(deps.store.get().scrubDay, null)
  })

  for (const day of DAYS) {
    const row = rows.get(day)
    if (!row) continue
    const { track } = row

    track.addEventListener('pointerdown', (event: PointerEvent) => {
      // Only the primary button/contact drives the playhead; right-click must not scrub.
      if (event.button !== 0) return
      event.preventDefault()

      // Tapping a class block snaps to that class's start rather than to the raw pixel.
      const target = event.target
      const block = target instanceof Element ? target.closest('.scrub__block') : null
      const snapped = block instanceof HTMLElement ? Number(block.dataset['start']) : NaN

      // The first sample is emitted synchronously so a tap feels instant; only the
      // subsequent move stream goes through the rAF throttle.
      setScrub(day, Number.isFinite(snapped) ? clamp(snapped, DAY_START, DAY_END) : minutesFromEvent(track, event.clientX))
      ;(track as PointerCapturable).setPointerCapture?.(event.pointerId)

      const onMove = (move: PointerEvent): void => {
        queueScrub(day, minutesFromEvent(track, move.clientX))
      }
      const onUp = (up: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        ;(track as PointerCapturable).releasePointerCapture?.(up.pointerId)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    })

    // Keyboard parity — the playhead is a slider, so arrows must move it.
    track.addEventListener('keydown', (event: KeyboardEvent) => {
      const step = event.shiftKey ? 60 : 15
      const current = effective(deps.store.get()).minutes
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setScrub(day, clamp(current - step, DAY_START, DAY_END))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setScrub(day, clamp(current + step, DAY_START, DAY_END))
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setScrub(day, null)
      }
    })
  }

  // ---------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------

  /** Resolve store + pending override into the day/minutes actually being displayed. */
  function effective(state: ScrubberState): { day: Day; minutes: number; live: boolean } {
    const day = pending ? pending.day : state.scrubDay
    const scrubbed = pending ? pending.minutes : state.scrubMinutes
    if (scrubbed !== null) {
      return { day, minutes: clamp(scrubbed, DAY_START, DAY_END), live: false }
    }
    return { day, minutes: clamp(minutesOfDate(state.now), DAY_START, DAY_END), live: true }
  }

  function render(state: ScrubberState): void {
    const { day: activeDay, minutes, live } = effective(state)
    const liveDay = dayOfDate(state.now)

    clock.textContent = minutesToHHMM(minutes)
    status.textContent = live ? 'LIVE' : 'SCRUBBING'
    status.classList.toggle('is-live', live)
    backToNow.hidden = live
    root.classList.toggle('is-scrubbing', !live)

    for (const day of DAYS) {
      const pill = pills.get(day)
      if (pill) {
        const on = day === activeDay
        pill.classList.toggle('is-active', on)
        pill.setAttribute('aria-pressed', String(on))
        pill.classList.toggle('is-today', day === liveDay)
      }
      const row = rows.get(day)
      if (!row) continue
      const on = day === activeDay
      row.root.classList.toggle('is-active', on)
      row.playhead.style.left = offsetPercent(minutes)
      row.track.setAttribute('aria-valuenow', String(on ? minutes : DAY_START))
      row.track.setAttribute('aria-valuetext', on ? minutesToHHMM(minutes) : 'inactive')
      // A block is lit exactly while its class is running — same rule the map uses, so
      // the timeline and the buildings agree at every instant of a drag.
      for (const node of row.track.querySelectorAll('.scrub__block')) {
        const b = node as HTMLElement
        const start = Number(b.dataset['start'])
        const end = Number(b.dataset['end'])
        b.classList.toggle('is-lit', on && minutes >= start && minutes < end)
      }
    }

    const session = sessionAt(week[activeDay], minutes)
    if (session) {
      caption.textContent = `${session.course.code} · ${session.course.building} ${session.course.room}`
      caption.className = 'scrub__caption is-class'
    } else {
      const t = transitionAt(transitions[activeDay], minutes)
      caption.textContent = t ? t.note : week[activeDay].length ? 'No class right now.' : 'Nothing scheduled.'
      caption.className = t ? `scrub__caption is-${t.kind}` : 'scrub__caption'
    }
  }

  deps.store.subscribe((state) => {
    // The store is the authority. The moment it reports a scrub value different from the
    // last one we saw, our optimistic override has served its purpose and is dropped.
    if (!seen || seen.day !== state.scrubDay || seen.minutes !== state.scrubMinutes) {
      seen = { day: state.scrubDay, minutes: state.scrubMinutes }
      pending = null
    }
    render(state)
  })

  const initial = deps.store.get()
  seen = { day: initial.scrubDay, minutes: initial.scrubMinutes }
  render(initial)
}
