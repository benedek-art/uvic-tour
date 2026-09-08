/**
 * Place card — the answer to "I tapped a thing and nothing happened".
 *
 * Tapping a tour stop used to only fly the camera, so the hand-written `why` line
 * for each POI was never shown. Tapping a gold building did nothing at all, leaving
 * no way to learn what gold even means. This card covers both.
 *
 * It floats above the scrubber rather than living in the bottom sheet, so it can't
 * fight the sheet's own drag gesture.
 */
import type { POI } from '../data/pois'
import type { Course } from '../data/schedule'
import { minutesToHHMM } from '../core/time'
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

const CATEGORY_LABEL: Record<POI['category'], string> = {
  gym: 'Recreation',
  library: 'Study',
  food: 'Food',
  transit: 'Getting here',
  nature: 'Outdoors',
  culture: 'Campus life',
}

function shell(kind: 'poi' | 'class', eyebrow: string, title: string): HTMLElement {
  const el = ensureHost()
  el.dataset['kind'] = kind
  el.replaceChildren()
  el.hidden = false

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

function addActions(
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
  btn.textContent = 'Walk here from home'
  btn.addEventListener('click', () => actions.onRouteFromHome?.(route.lat, route.lon, route.label))
  row.appendChild(btn)
  el.appendChild(row)
}

/** A tour stop: shows the hand-written reason it's worth knowing about. */
export function showPOICard(poi: POI, actions: PlaceCardActions = {}): void {
  const el = shell('poi', CATEGORY_LABEL[poi.category] ?? 'Campus', poi.name)
  const why = document.createElement('p')
  why.className = 'place__body'
  why.dataset['testid'] = 'place-why'
  why.textContent = poi.why
  el.appendChild(why)
  addActions(el, actions, { lat: poi.lat, lon: poi.lon, label: poi.name })
}

/**
 * A gold building. Explains *why* it is gold — the user's own words were
 * "the highlighted buildings idk what that means".
 */
export function showBuildingCard(
  building: string,
  courses: Course[],
  at: { lat: number; lon: number } | null,
  actions: PlaceCardActions = {},
): void {
  const isYours = courses.length > 0
  const el = shell('class', isYours ? 'One of your buildings' : 'Campus building', building)

  if (isYours) {
    const list = document.createElement('ul')
    list.className = 'place__classes'
    list.dataset['testid'] = 'place-classes'
    for (const c of courses) {
      const li = document.createElement('li')
      const code = document.createElement('span')
      code.className = 'place__code'
      code.textContent = c.code
      const when = document.createElement('span')
      when.className = 'place__when mono'
      when.textContent = `${c.days.join(' · ')} · ${minutesToHHMM(c.start)}`
      const room = document.createElement('span')
      room.className = 'place__room mono'
      room.textContent = c.room
      li.append(code, when, room)
      list.appendChild(li)
    }
    el.appendChild(list)
  } else {
    const p = document.createElement('p')
    p.className = 'place__body'
    p.textContent = 'Not one of your class buildings — just part of campus.'
    el.appendChild(p)
  }

  addActions(el, actions, at ? { lat: at.lat, lon: at.lon, label: building } : undefined)
}

export function hidePlaceCard(): void {
  if (host) host.hidden = true
}

export function isPlaceCardOpen(): boolean {
  return Boolean(host && !host.hidden)
}

/**
 * One-time legend. Gold vs cyan is the map's entire visual grammar and nothing
 * on screen explained it. Dismissed state persists per-device.
 */
const LEGEND_KEY = 'uvic-tour:legend-seen'

export function mountLegend(): void {
  let seen = false
  try { seen = localStorage.getItem(LEGEND_KEY) === '1' } catch { /* private mode */ }
  if (seen) return

  const el = document.createElement('div')
  el.className = 'legend'
  el.dataset['testid'] = 'legend'
  el.innerHTML =
    '<span class="legend__row"><i class="legend__swatch legend__swatch--gold"></i>Your class buildings</span>' +
    '<span class="legend__row"><i class="legend__swatch legend__swatch--cyan"></i>Places worth knowing</span>'

  const dismiss = document.createElement('button')
  dismiss.className = 'legend__dismiss'
  dismiss.type = 'button'
  dismiss.textContent = 'Got it'
  dismiss.addEventListener('click', () => {
    el.remove()
    try { localStorage.setItem(LEGEND_KEY, '1') } catch { /* private mode */ }
  })
  el.appendChild(dismiss)
  document.getElementById('app')?.appendChild(el)
}
