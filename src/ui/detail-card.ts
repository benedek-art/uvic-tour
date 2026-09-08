/**
 * The selected class, in full — and the room decoder.
 *
 * SPEC §5.7: OpenStreetMap has no indoor data for UVic, so the single most valuable
 * thing this app can tell someone who has never been inside MacLaurin is which end of
 * the building to walk into and what to do once the door shuts behind them. That
 * block is therefore a bordered callout directly under the class facts, not a
 * footnote — and when a room has no hand-written hint it falls back to the building's
 * main-entrance hint rather than rendering an empty box.
 *
 * Also here: the transition note for that session's day (coloured by kind), the
 * daylight warning for classes that let out after sunset (SPEC §5.9), and the route
 * button, which hands the walk to the orchestrator to draw on the map while showing
 * the distance and duration locally.
 */

import './ui.css'
import './home.css'
import type { AppState } from './sheet'
import type { Store } from './store'
import { route } from '../core/router'
import { buildingCentroid, type Transition } from '../core/transitions'
import { endsAfterDark, sunsetMinutes } from '../core/sun'
import { minutesToHHMM } from '../core/time'
import type { Session } from '../core/week'
import { HOME_BUILDING, HOME_LABEL, walkFromHome } from '../data/home'
import { MAIN_ENTRANCE, ROOM_HINTS, type RoomHint } from '../data/rooms'
import { WEEK, dayList, timeRange, transitionAfter, transitionBefore } from './now-next'

/**
 * The UVic bus exchange on Finnerty Road, the north-east corner of campus — where
 * every evening class walk ends. Hand-placed here because the POI table
 * (`src/data/pois.ts`) belongs to a later task; when it lands, read it from there.
 */
const BUS_LOOP: [number, number] = [48.46442, -123.30612]

/** Room hint for this exact room, else the building's main-entrance hint, else null. */
export function roomHintFor(building: string, room: string): RoomHint | null {
  return (
    ROOM_HINTS.find((h) => h.building === building && h.room === room) ??
    ROOM_HINTS.find((h) => h.building === building && h.room === MAIN_ENTRANCE) ??
    null
  )
}

/**
 * The walk worth drawing for this class: the neighbouring session on the same day
 * that is actually in a different building. Falls back to whichever neighbour exists
 * so the button is never dead when there is something to say.
 */
export function routePair(session: Session): { from: Session; to: Session } | null {
  const day = WEEK[session.day]
  const index = day.findIndex((s) => s.course.id === session.course.id)
  if (index === -1) return null
  const prev = index > 0 ? day[index - 1] : undefined
  const next = day[index + 1]

  if (prev && prev.course.building !== session.course.building) return { from: prev, to: session }
  if (next && next.course.building !== session.course.building) return { from: session, to: next }
  if (prev) return { from: prev, to: session }
  if (next) return { from: session, to: next }
  return null
}

/** Rough compass word from A to B — "6 min east" reads better than a bearing. */
function compass(from: [number, number], to: [number, number]): string {
  const dLat = to[0] - from[0]
  const dLon = to[1] - from[1]
  if (Math.abs(dLon) >= Math.abs(dLat)) return dLon >= 0 ? 'east' : 'west'
  return dLat >= 0 ? 'north' : 'south'
}

/** Walking minutes and heading from a building to the bus loop, or null off-graph. */
function busLoopWalk(building: string): { minutes: number; heading: string } | null {
  const from = buildingCentroid(building)
  if (!from) return null
  const r = route(from, BUS_LOOP)
  if (!r) return null
  return { minutes: r.minutes, heading: compass(from, BUS_LOOP) }
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

function metaRow(term: string, value: string): HTMLElement {
  const row = el('div', 'dc-meta-row')
  row.append(el('dt', 'dc-term mono', term), el('dd', 'dc-value', value))
  return row
}

export interface DetailDeps {
  store: Store<AppState>
  onSelect: (s: Session | null) => void
  onRoute: (from: Session, to: Session) => void
  /**
   * Draw the walk from the residence to this class. Optional so the card still
   * renders (minus the button's map effect) before the orchestrator wires it.
   */
  onRouteFromHome?: (to: Session) => void
}

export interface DetailView {
  el: HTMLElement
  update(state: AppState): void
}

/**
 * Create the detail card. Hidden until a class is selected.
 *
 * While this card is on screen it owns the page's single `transition-note` testid;
 * the Now/Next card gives it up (see `createNowNext`).
 */
export function createDetail(deps: DetailDeps): DetailView {
  const root = el('section', 'dc')
  root.hidden = true

  /** Only rebuilt when the class, its day, or its darkness changes. */
  let shape = ''

  function close(): void {
    deps.store.set({ selected: null })
    deps.onSelect(null)
  }

  function build(session: Session, state: AppState): void {
    const { course } = session
    root.replaceChildren()

    const head = el('header', 'dc-head')
    const headText = el('div', 'dc-head-text')
    const code = el('h2', 'dc-code', course.code)
    code.append(el('span', 'dc-section mono', ` ${course.section}`))
    headText.append(code, el('p', 'dc-title', course.title))

    const closeButton = el('button', 'dc-close')
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Close class detail')
    closeButton.textContent = '✕'
    closeButton.addEventListener('click', close)
    head.append(headText, closeButton)

    const dark = endsAfterDark(session, state.now)
    const meta = el('dl', 'dc-meta')
    meta.append(
      metaRow(
        'WHEN',
        `${dayList(course.days)} · ${timeRange(course.start, course.end)}${dark ? ' 🌙' : ''}`,
      ),
      metaRow('WHERE', `${course.building} · ${course.room}`),
      metaRow('PROF', course.instructor),
      metaRow('CRN', `${course.crn} · ${course.units} units`),
    )

    root.append(head, meta)

    // --- room decoder: the reason this card exists (SPEC §5.7) -------------------
    const hint = roomHintFor(course.building, course.room)
    if (hint) {
      const decoder = el('section', 'dc-decoder')
      decoder.append(el('h3', 'dc-decoder-head mono', 'FINDING THE ROOM'))
      const generic = hint.room === MAIN_ENTRANCE
      decoder.append(
        el(
          'p',
          'dc-decoder-where mono',
          generic
            ? `${hint.building} · wing ${hint.wing}`
            : `${course.room} · wing ${hint.wing} · floor ${hint.floor}`,
        ),
      )
      const entrance = el('p', 'dc-decoder-entrance')
      entrance.append(el('strong', undefined, 'Enter: '), document.createTextNode(hint.entrance))
      decoder.append(entrance, el('p', 'dc-decoder-directions', hint.directions))
      if (generic) {
        decoder.append(
          el(
            'p',
            'dc-decoder-fallback',
            `No hand-written hint for ${course.room} yet — this is the way in.`,
          ),
        )
      }
      root.append(decoder)
    }

    // --- daylight (SPEC §5.9) ---------------------------------------------------
    if (dark) {
      const walk = busLoopWalk(course.building)
      const sunset = minutesToHHMM(sunsetMinutes(state.now))
      root.append(
        el(
          'p',
          'dc-dark',
          walk
            ? `🌙 Dark walk — sunset is ${sunset}, and the bus loop is ${walk.minutes} min ${walk.heading}.`
            : `🌙 Dark walk — sunset is ${sunset}. It will be night when you come out.`,
        ),
      )
    }

    // --- what happens next (SPEC §5.5) ------------------------------------------
    const transition: Transition | null = transitionAfter(session) ?? transitionBefore(session)
    if (transition) {
      const note = el('p', 'dc-note', transition.note)
      note.setAttribute('data-testid', 'transition-note')
      note.dataset['kind'] = transition.kind
      root.append(note)
    }

    // --- the walk ---------------------------------------------------------------
    // Two possible origins: the neighbouring class, and home. Both write into the one
    // summary line, which is only appended if at least one button exists — an empty
    // "—" under no buttons would read as broken.
    const pair = routePair(session)
    const summary = el('p', 'dc-route-summary mono', '—')
    summary.setAttribute('data-testid', 'route-summary')
    summary.setAttribute('aria-live', 'polite')
    let hasAction = false

    if (pair) {
      const button = el('button', 'dc-route-btn')
      button.type = 'button'
      button.setAttribute('data-testid', 'route-btn')
      button.textContent =
        pair.to.course.id === course.id
          ? `Route from ${pair.from.course.code}`
          : `Route to ${pair.to.course.code}`

      button.addEventListener('click', () => {
        const from = buildingCentroid(pair.from.course.building)
        const to = buildingCentroid(pair.to.course.building)
        if (pair.from.course.building === pair.to.course.building) {
          summary.textContent = `Same building — 0 min walk.`
        } else if (from && to) {
          const r = route(from, to)
          summary.textContent = r
            ? `${Math.round(r.metres)} m · ${r.minutes} min walk`
            : 'No walking route found.'
        } else {
          summary.textContent = 'No walking route found.'
        }
        deps.onRoute(pair.from, pair.to)
      })

      root.append(button)
      hasAction = true
    }

    // --- the walk from home -----------------------------------------------------
    // Offered for every class, not just the first of the day: "how do I get there
    // from my room?" is the question a first-year asks about a building they have
    // never seen, whatever time it is. Distance is already memoised in src/data/home,
    // so it is read here at build time and the click only draws.
    const homeWalk = walkFromHome(course.building)
    if (homeWalk) {
      const homeButton = el('button', 'dc-route-home-btn')
      homeButton.type = 'button'
      homeButton.setAttribute('data-testid', 'route-from-home-btn')
      homeButton.title = `From ${HOME_BUILDING}`
      homeButton.textContent = `Route from ${HOME_LABEL.toLowerCase()}`

      homeButton.addEventListener('click', () => {
        summary.textContent = `${Math.round(homeWalk.metres)} m · ${homeWalk.minutes} min from ${HOME_LABEL.toLowerCase()}`
        deps.onRouteFromHome?.(session)
      })

      root.append(homeButton)
      hasAction = true
    }

    if (hasAction) root.append(summary)
  }

  function update(state: AppState): void {
    const session = state.selected
    if (!session) {
      root.hidden = true
      shape = ''
      root.replaceChildren()
      return
    }

    const next = [
      session.course.id,
      session.day,
      endsAfterDark(session, state.now) ? 'dark' : 'day',
    ].join('|')

    // Rebuilding on every tick would wipe the route summary the student just asked for.
    if (next !== shape) {
      shape = next
      build(session, state)
    }
    root.hidden = false
  }

  return { el: root, update }
}
