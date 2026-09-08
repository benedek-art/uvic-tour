/**
 * Place card — the answer to "I tapped a thing and nothing happened".
 *
 * Tap a sage marker or a terracotta building and this is what comes back. It is the only
 * thing in the app that explains the map's colour grammar, and since the redesign it is
 * the *only* floating surface over the map that carries information (docs/REDESIGN.md §2,
 * rule 4 — the standing legend is gone; see `mountLegend` at the bottom).
 *
 * SHAPE, and it is the same shape every time (redesign rule 1):
 *
 *     EYEBROW        one or two quiet words saying what kind of thing this is
 *     Big Title      the name, 24px, ink
 *     One line       one sentence, plain words, never two
 *     [ Take me there ]   one filled terracotta button, full width
 *
 * There is deliberately no list, no table and no second action. The room-and-time detail
 * that used to live here is one tap away in the bottom sheet, which is built for lists;
 * a card that floats over a map is built for a single answer.
 *
 * It floats above the week panel rather than living in the bottom sheet, so it can't fight
 * the sheet's own drag gesture — and on open it asks the week panel to collapse, because
 * the two share an offset and stacking them is what caused the overlap bugs.
 */
import type { POI } from '../data/pois'
import type { Course } from '../data/schedule'
import { COLLAPSE_EVENT } from './scrubber'
import './place-card.css'

export interface PlaceCardActions {
  /** Draw a walking route from home to this place. */
  onRouteFromHome?: (lat: number, lon: number, label: string) => void
  onClose?: () => void
}

let host: HTMLElement | null = null

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host
  const el = document.createElement('div')
  el.id = 'place-card'
  el.className = 'place'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-live', 'polite')
  el.hidden = true
  document.getElementById('app')?.appendChild(el)
  host = el
  return el
}

/** Plain words. "Recreation", not "gym"; nothing here is a category slug. */
const CATEGORY_LABEL: Record<POI['category'], string> = {
  gym: 'Sport',
  library: 'Study',
  food: 'Food',
  transit: 'Buses',
  nature: 'Outdoors',
  culture: 'Campus life',
}

/**
 * Build the fixed part of the card: close button, eyebrow, title.
 *
 * Also asks the week panel to stand down — this card lands at the same offset, and two
 * surfaces fighting for that band is exactly the bug the redesign is undoing.
 */
function shell(kind: 'poi' | 'class', eyebrow: string, title: string): HTMLElement {
  window.dispatchEvent(new Event(COLLAPSE_EVENT))

  const el = ensureHost()
  el.dataset['kind'] = kind
  el.replaceChildren()
  el.hidden = false
  el.setAttribute('aria-label', title)

  const close = document.createElement('button')
  close.className = 'place__close'
  close.type = 'button'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '✕'
  el.appendChild(close)

  const brow = document.createElement('p')
  brow.className = 'place__eyebrow'
  brow.textContent = eyebrow
  el.appendChild(brow)

  const h = document.createElement('h2')
  h.className = 'place__title'
  h.textContent = title
  el.appendChild(h)
  return el
}

/** The one sentence. Always exactly one `<p>`, always in the same slot. */
function addLine(el: HTMLElement, text: string, testid: string): void {
  const p = document.createElement('p')
  p.className = 'place__body'
  p.dataset['testid'] = testid
  p.textContent = text
  el.appendChild(p)
}

/**
 * The one action. Full-width, filled terracotta, plain words — "Take me there", because
 * that is what a person would say out loud, and "Route" is not.
 */
function addAction(
  el: HTMLElement,
  actions: PlaceCardActions,
  route?: { lat: number; lon: number; label: string },
): void {
  const close = el.querySelector<HTMLButtonElement>('.place__close')
  close?.addEventListener('click', () => { hidePlaceCard(); actions.onClose?.() })

  if (!route || !actions.onRouteFromHome) return
  const row = document.createElement('div')
  row.className = 'place__actions'
  const btn = document.createElement('button')
  btn.className = 'place__route'
  btn.type = 'button'
  btn.dataset['testid'] = 'place-route-btn'
  btn.textContent = 'Take me there'
  btn.addEventListener('click', () => actions.onRouteFromHome?.(route.lat, route.lon, route.label))
  row.appendChild(btn)
  el.appendChild(row)
}

/** A tour stop: shows the hand-written reason it's worth knowing about. */
export function showPOICard(poi: POI, actions: PlaceCardActions = {}): void {
  const el = shell('poi', CATEGORY_LABEL[poi.category] ?? 'Campus', poi.name)
  addLine(el, poi.why, 'place-why')
  addAction(el, actions, { lat: poi.lat, lon: poi.lon, label: poi.name })
}

/** "Your BIOL 184 class is here." — a sentence, not a data structure. */
function yoursLine(courses: Course[]): string {
  const first = courses[0]
  if (courses.length === 1 && first) return `Your ${first.code} class is here, in room ${first.room}.`
  const codes = courses.map((c) => c.code)
  const last = codes.pop()
  return `Your ${codes.join(', ')} and ${last} classes are here.`
}

/**
 * A terracotta building. Explains *why* it is terracotta — the user's own words were
 * "the highlighted buildings idk what that means". With the standing legend deleted this
 * card is the whole explanation, so the eyebrow says it in two words and the line says it
 * in one sentence.
 */
export function showBuildingCard(
  building: string,
  courses: Course[],
  at: { lat: number; lon: number } | null,
  actions: PlaceCardActions = {},
): void {
  const isYours = courses.length > 0
  const el = shell('class', isYours ? 'Your building' : 'Campus building', building)
  addLine(
    el,
    isYours ? yoursLine(courses) : 'Not one of your classes — just part of campus.',
    isYours ? 'place-classes' : 'place-why',
  )
  addAction(el, actions, at ? { lat: at.lat, lon: at.lon, label: building } : undefined)
}

export function hidePlaceCard(): void {
  if (host) host.hidden = true
}

export function isPlaceCardOpen(): boolean {
  return Boolean(host && !host.hidden)
}

/**
 * The card floats above the map at a fixed offset from the resting chrome. Once the sheet
 * is dragged up it would sit on top of it and eat taps in that band, so it stands down
 * whenever the sheet leaves its peek detent. `main.ts` calls this.
 */
export function dismissMapOverlays(): void {
  hidePlaceCard()
}

/* ------------------------------------------------------------------------------ *
 * The legend: deleted.
 *
 * It existed for one reason — nothing on screen said what the coloured buildings meant.
 * Three things now do that job better than a permanent panel could:
 *   1. The Warm Paper map has exactly two accents against paper, so "special" reads as
 *      special without a key.
 *   2. Tapping any building says it in a sentence ("Your building" / "Campus building").
 *   3. Tapping any marker names it and says why it is worth knowing.
 * Against that, the legend was a floating surface pinned at the same offset as the place
 * card, which is precisely how it caused two overlap bugs — and it swallowed map pans the
 * first time it shipped. A panel that must be `pointer-events: none` to be safe, and that
 * every user dismisses once and never sees again, is not carrying its weight.
 *
 * The two exports stay as no-ops so `src/main.ts` keeps compiling untouched.
 * ------------------------------------------------------------------------------ */

/** No-op. The legend was removed; see the note above. */
export function mountLegend(): void {
  /* Intentionally empty. */
}

/** No-op. Kept so `main.ts`'s sheet-detent sync keeps compiling. */
export function restoreLegend(): void {
  /* Intentionally empty. */
}
