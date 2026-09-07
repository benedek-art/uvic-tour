/**
 * The bottom sheet — the primary navigation surface on a phone.
 *
 * Not a small-screen fallback: below 900 px this *is* the UI. Three detents (peek,
 * half, full) let the student see the Now/Next answer without touching anything, then
 * pull up for the rest. Above 900 px the same markup becomes a fixed 380 px left rail
 * (SPEC §4 — Layout); the CSS does that switch, and the drag code stands down.
 *
 * Dragging uses Pointer Events with `setPointerCapture`, so one code path covers
 * touch, mouse, and pen, and the gesture keeps working if the finger slides off the
 * handle. Only the handle carries `touch-action: none`; putting it on the sheet would
 * kill inner scrolling, and putting any listener on the document would eat the map's
 * own pan gestures — the map must stay draggable everywhere it is visible.
 *
 * Release snaps to a detent: fast flicks go one detent in the direction of travel,
 * slow drags settle on whichever detent is nearest.
 */

import './ui.css'
import type { Store } from './store'
import type { Session } from '../core/week'
import type { Day } from '../data/schedule'
import { createClassList } from './class-list'
import { createDetail } from './detail-card'
import { createNowNext } from './now-next'

export interface AppState {
  now: Date
  selected: Session | null
  /** Non-null overrides the live clock (the week scrubber's playhead). */
  scrubMinutes: number | null
  scrubDay: Day
  layers: { pois: boolean; paths: boolean }
  tourPlaying: boolean
}

export interface SheetDeps {
  store: Store<AppState>
  /** Orchestrator wires the camera flight and the room pin. */
  onSelect: (s: Session | null) => void
  /** Orchestrator wires the route drawing on the map. */
  onRoute: (from: Session, to: Session) => void
}

/**
 * Peek detent: the grab handle plus the whole Now/Next card, measured at mount so the
 * hero answer is never clipped by a hardcoded number. ~140-190 px in practice.
 */
const PEEK_MIN_PX = 140
const PEEK_MAX_PX = 240
const HANDLE_PX = 44
/** Fraction of the viewport the sheet occupies at the full detent. */
const FULL_FRACTION = 0.9
const HALF_FRACTION = 0.5

/** Past this speed (px/ms) a release is a flick, not a settle. */
const FLICK_VELOCITY = 0.45
/** Movement under this (px) with a quick release counts as a tap on the handle. */
const TAP_SLOP = 8
const TAP_MS = 350

const DESKTOP_QUERY = '(min-width: 900px)'

/** One interval for the entire app, however many times `mountSheet` is called. */
let tickHandle: ReturnType<typeof setInterval> | null = null

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/**
 * Render the whole sheet into the existing `<main id="sheet">` and keep it in sync
 * with the store. Returns nothing: the orchestrator drives everything through the
 * store and the two callbacks.
 */
export function mountSheet(root: HTMLElement, deps: SheetDeps): void {
  const { store } = deps

  root.replaceChildren()
  root.hidden = false
  root.classList.add('sheet')

  // --- structure ---------------------------------------------------------------
  const handle = el('button', 'sheet-handle')
  handle.type = 'button'
  handle.setAttribute('aria-label', 'Resize the class panel')
  handle.append(el('span', 'sheet-grip'))

  const scroll = el('div', 'sheet-scroll')

  const nowNext = createNowNext({ store, onSelect: deps.onSelect })
  const detail = createDetail({ store, onSelect: deps.onSelect, onRoute: deps.onRoute })
  const classList = createClassList({ store, onSelect: deps.onSelect })

  scroll.append(nowNext.el, detail.el, classList.el)
  root.append(handle, scroll)

  // --- detents -----------------------------------------------------------------
  const isDesktop = (): boolean => window.matchMedia(DESKTOP_QUERY).matches

  /** Visible heights in px, ascending. Recomputed on resize / rotation. */
  let detents: number[] = []
  let detentIndex = 0
  let visible = PEEK_MIN_PX

  function peekHeight(): number {
    const card = nowNext.el.querySelector('.nn-card')
    const cardHeight = card ? card.getBoundingClientRect().height : 0
    return Math.round(
      Math.min(PEEK_MAX_PX, Math.max(PEEK_MIN_PX, HANDLE_PX + cardHeight + 12)),
    )
  }

  function measure(): void {
    const h = window.innerHeight || 844
    detents = [peekHeight(), Math.round(h * HALF_FRACTION), Math.round(h * FULL_FRACTION)]
  }

  function fullHeight(): number {
    return detents[detents.length - 1] ?? PEEK_MIN_PX
  }

  /** Position the sheet by translating it down out of its own full height. */
  function apply(px: number): void {
    visible = px
    root.style.setProperty('--sheet-y', `${Math.max(0, fullHeight() - px)}px`)
    root.classList.toggle('is-full', px >= fullHeight() - 1)
  }

  function snapTo(index: number, animate = true): void {
    detentIndex = Math.min(detents.length - 1, Math.max(0, index))
    root.classList.toggle('is-dragging', !animate)
    apply(detents[detentIndex] ?? PEEK_MIN_PX)
    root.dataset['detent'] = ['peek', 'half', 'full'][detentIndex] ?? 'peek'
  }

  function remeasure(): void {
    measure()
    snapTo(detentIndex, false)
    requestAnimationFrame(() => root.classList.remove('is-dragging'))
  }

  measure()
  snapTo(0, false)
  // The card has no layout yet on the mounting tick, so the first peek height is the
  // floor. Re-measure once the browser has laid it out — and again once the display
  // font lands, which changes the card's height a second time.
  requestAnimationFrame(remeasure)

  window.addEventListener('resize', remeasure)
  // Space Grotesk arrives after first paint and changes the card's height.
  void document.fonts?.ready.then(remeasure).catch(() => {})

  // --- dragging ----------------------------------------------------------------
  let dragging = false
  let startY = 0
  let startVisible = 0
  let startTime = 0
  let lastY = 0
  let lastTime = 0
  let velocity = 0
  let moved = 0

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (isDesktop()) return
    dragging = true
    moved = 0
    velocity = 0
    startY = event.clientY
    lastY = event.clientY
    startTime = event.timeStamp
    lastTime = event.timeStamp
    startVisible = visible
    root.classList.add('is-dragging')
    handle.setPointerCapture(event.pointerId)
  })

  handle.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragging) return
    event.preventDefault()
    const dy = startY - event.clientY
    moved = Math.max(moved, Math.abs(dy))

    const dt = event.timeStamp - lastTime
    if (dt > 0) velocity = (lastY - event.clientY) / dt
    lastY = event.clientY
    lastTime = event.timeStamp

    // Rubber-band a little past the ends rather than hard-stopping.
    const min = (detents[0] ?? PEEK_MIN_PX) * 0.6
    apply(Math.min(fullHeight(), Math.max(min, startVisible + dy)))
  })

  function endDrag(event: PointerEvent): void {
    if (!dragging) return
    dragging = false
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    root.classList.remove('is-dragging')

    // A quick, still tap cycles detents — the handle is a button as well as a grip.
    if (moved < TAP_SLOP && event.timeStamp - startTime < TAP_MS) {
      snapTo((detentIndex + 1) % detents.length)
      return
    }

    if (Math.abs(velocity) > FLICK_VELOCITY) {
      snapTo(detentIndex + (velocity > 0 ? 1 : -1))
      return
    }

    let nearest = 0
    for (let i = 1; i < detents.length; i++) {
      const here = detents[i] ?? 0
      const best = detents[nearest] ?? 0
      if (Math.abs(here - visible) < Math.abs(best - visible)) nearest = i
    }
    snapTo(nearest)
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)

  // Keyboard parity for the handle: it is a real button, so Enter/Space fire click.
  handle.addEventListener('click', (event) => {
    // Pointer flow already handled the tap; only respond to synthesised clicks.
    if (event.detail !== 0 || isDesktop()) return
    snapTo((detentIndex + 1) % detents.length)
  })

  // --- rendering ---------------------------------------------------------------
  let lastSelectedId: string | null = null

  function render(state: AppState): void {
    // Only one `transition-note` may exist on the page at a time; the detail card
    // takes it whenever a class is selected.
    nowNext.update(state, state.selected === null)
    detail.update(state)
    classList.update(state)

    const selectedId = state.selected?.course.id ?? null
    if (selectedId !== lastSelectedId) {
      lastSelectedId = selectedId
      // Open up for the detail card. It is long — instructor, room decoder, transition
      // note, route — and inner scrolling is only available at the full detent, so
      // anything less would bury the room decoder with no way to reach it. Dragging
      // back down to peek re-reveals the map and the camera flight.
      if (selectedId && !isDesktop() && detentIndex < detents.length - 1) {
        snapTo(detents.length - 1)
      }
      if (selectedId) scroll.scrollTop = 0
    }
  }

  render(store.get())
  store.subscribe(render)

  // --- the clock ---------------------------------------------------------------
  // One interval for the whole app. Every countdown in the UI is a function of
  // `state.now`, so this is the only thing that has to tick.
  if (tickHandle === null) {
    tickHandle = setInterval(() => {
      store.set({ now: new Date() })
    }, 1000)
  }
}
