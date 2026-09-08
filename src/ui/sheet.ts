/**
 * The bottom sheet — the whole UI on a phone, and now the ONLY one.
 *
 * ONE SURFACE, THREE TIERS (docs/WEEK-VIEW.md). The sheet used to split a single
 * question — "where do I go and when?" — across three places: a hero card, a flat
 * five-course list in no useful order, and a separate floating "My week" pill holding
 * the timeline. Scrolling one surface now answers it end to end:
 *
 *   1. PEEK      the answer. Next class, where, when, leave by, and one big
 *                terracotta "Take me there". Visible with no interaction at all.
 *   2. THE WEEK  scroll down and every day of the week is there, in order, with the
 *                gaps between classes shown as rows of their own. Owned by
 *                `src/ui/week-view.ts`; this file only gives it a container and the
 *                two callbacks it needs.
 *   3. DETAIL    tap a class and the detail card opens above the week, carrying the
 *                hand-written room-finding directions — the single most useful block
 *                in the app for someone who has never been in the building.
 *
 * The floating week scrubber is redundant now and `main.ts` should stop mounting it:
 * day focus is a tap on a day header in tier 2, which is why `SheetDeps.onFocusDay`
 * exists.
 *
 * Not a small-screen fallback: below 900 px this *is* the UI. Three detents (peek,
 * half, full) let the student see the Now/Next answer without touching anything, then
 * pull up for the rest. Above 900 px the same markup becomes a fixed 380 px left rail
 * (SPEC §4 — Layout); the CSS does that switch, and the drag code stands down.
 *
 * Dragging uses Pointer Events with `setPointerCapture`, so one code path covers
 * touch, mouse, and pen, and the gesture keeps working if the finger slides off the
 * element it started on. Listeners live on the sheet root — never on the document —
 * so a pan that starts on the map is never ours to steal.
 *
 * WHERE A DRAG MAY START (the bug this replaced: handle-only listeners meant a
 * natural swipe anywhere on the card body did nothing on a phone):
 *   - the grab handle and the whole Now/Next header — always, `touch-action: none`;
 *   - anywhere in the scrolling body while there is nothing to scroll (below the
 *     full detent the body is `overflow: hidden`, so it also gets `touch-action:
 *     none` and every swipe is a sheet drag);
 *   - in the body at the full detent only when the scroller is already at its top
 *     and the finger is moving DOWN. That is the scroll/drag handoff; anything else
 *     is left to the native scroll, which is why the body is `pan-y` there.
 * Nothing is claimed until the finger has travelled DRAG_SLOP px, so a tap on a
 * class row is still a tap.
 *
 * Release snaps to a detent: a flick is projected forward by its velocity and always
 * moves at least one detent in the direction of travel; a slow drag settles on
 * whichever detent is nearest. Past either end the movement is rubber-banded.
 *
 * `pointercancel` matters here: iOS Safari fires it where Chrome does not (a second
 * finger, the app switcher, a system edge gesture), and a handler that ignores it
 * leaves the sheet frozen mid-drag. It ends the drag exactly like `pointerup`.
 *
 * Reduced motion needs no JS: every snap is a CSS transition and tokens.css zeroes
 * the durations, so the sheet jumps straight to the detent.
 */

import './ui.css'
import type { Store } from './store'
import type { Session } from '../core/week'
import type { Day } from '../data/schedule'
import { createDetail } from './detail-card'
import { createNowNext, transitionBefore } from './now-next'
import { mountWeekView } from './week-view'

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
  /** Orchestrator wires the walk from the residence (src/data/home.ts) to a class. */
  onRouteFromHome?: (to: Session) => void
  /**
   * Tapping a day header in the week view. Optional: the sheet always records the
   * focused day in the store, and the orchestrator adds the map's half — lighting
   * that day's buildings. This replaces the deleted scrubber's day pills.
   */
  onFocusDay?: (d: Day) => void
}

/**
 * Peek detent: the grab handle plus the whole Now/Next card, measured at mount so the
 * hero answer is never clipped by a hardcoded number. ~140-190 px in practice.
 */
const PEEK_MIN_PX = 140
/**
 * The peek now has to carry the primary button as well as the answer, and one of the
 * three building names wraps to two lines, so the old 240 px ceiling clipped the
 * button off the bottom of the card on exactly one of the five classes.
 */
const PEEK_MAX_PX = 320
const HANDLE_PX = 44
/** Fraction of the viewport the sheet occupies at the full detent. */
const FULL_FRACTION = 0.9
const HALF_FRACTION = 0.5

/** Past this speed (px/ms) a release is a flick, not a settle. */
const FLICK_VELOCITY = 0.45
/** A flick is projected this many ms forward at its release speed before snapping. */
const FLICK_PROJECTION_MS = 150
/** A velocity sample older than this (ms) at release means the finger had stopped. */
const VELOCITY_STALE_MS = 90
/** Travel (px) before a gesture stops being a tap and becomes a drag. */
const DRAG_SLOP = 8
/** A gesture this much more horizontal than vertical is not a sheet drag. */
const DIRECTION_LOCK = 1.2
/** Asymptotic ceiling (px) of the rubber band past the top / below the peek. */
const OVERDRAG_MAX = 28
const UNDERDRAG_MAX = 40

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
  /**
   * The handle says what is underneath it.
   *
   * At peek the sheet shows one answer and one button, and the week — the whole point
   * of the rebuild — is below the fold with nothing to advertise it but a 5 px grip.
   * A first-year should not have to guess that the card slides. The label lives INSIDE
   * the fixed 44 px handle, so it costs the peek detent nothing (`peekHeight` is the
   * handle plus the hero card), and the handle is already a button that cycles detents
   * — tapping the words does exactly what they promise.
   */
  const handleLabel = el('span', 'sheet-handle-label')
  handleLabel.textContent = 'Your week'
  handle.append(el('span', 'sheet-grip'), handleLabel)

  const scroll = el('div', 'sheet-scroll')

  /**
   * The one big button, "Take me there" (docs/REDESIGN.md §2.1).
   *
   * It draws the walk that actually stands between the student and that class: from
   * the class before it when there is one in another building, and from their room in
   * residence otherwise — which is the case for the first class of every day.
   *
   * It deliberately does NOT select the class. Selecting opens the sheet to the full
   * detent, and a button whose job is "show me the way" must not answer by covering
   * the map with a card; instead the sheet drops back to peek so the route is the
   * thing you are looking at.
   */
  function go(session: Session): void {
    const before = transitionBefore(session)
    if (before && before.from.course.building !== session.course.building) {
      deps.onRoute(before.from, session)
    } else {
      deps.onRouteFromHome?.(session)
    }
    if (!isDesktop()) snapTo(0)
  }

  const nowNext = createNowNext({ store, onSelect: deps.onSelect, onGo: go })
  const detail = createDetail({
    store,
    onSelect: deps.onSelect,
    onRoute: deps.onRoute,
    onRouteFromHome: deps.onRouteFromHome,
  })

  // The hero card is the sheet's header as far as the finger is concerned: it is the
  // biggest thing visible at peek, so it has to be a drag surface. `.sheet-grab` is
  // what carries `touch-action: none` for it — see ui.css.
  nowNext.el.classList.add('sheet-grab')

  /**
   * Tier 2. `week-view.ts` owns everything inside this container — day headers, class
   * rows, the gap rows between them; the sheet only says where it goes and what a tap
   * means. Selecting from here is the same act as selecting from the hero card, so it
   * goes through the same store write and the same `onSelect`.
   */
  const week = el('div', 'sheet-week')
  mountWeekView(week, {
    store,
    onSelectSession: (s: Session) => {
      store.set({ selected: s })
      deps.onSelect(s)
    },
    onFocusDay: (d: Day) => {
      // Recorded in the store whether or not the orchestrator has wired the map half,
      // so the week view can show which day is focused with no extra plumbing.
      store.set({ scrubDay: d })
      deps.onFocusDay?.(d)
    },
  })

  scroll.append(nowNext.el, detail.el, week)
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
    // +16: the card's own safe-area padding is already inside `cardHeight`, so this
    // is purely the breathing room under the primary button.
    return Math.round(
      Math.min(PEEK_MAX_PX, Math.max(PEEK_MIN_PX, HANDLE_PX + cardHeight + 16)),
    )
  }

  function measure(): void {
    // Measure the sheet's own rendered height rather than trusting `innerHeight *
    // 0.9`: the CSS height is `90dvh`, and on iOS Safari with a URL bar dvh and
    // innerHeight disagree — a stale full height leaves a gap under the sheet.
    root.style.setProperty('--sheet-over', '0px')
    const rendered = Math.round(root.getBoundingClientRect().height)
    const full = rendered > 0 ? rendered : Math.round((window.innerHeight || 844) * FULL_FRACTION)
    detents = [peekHeight(), Math.round(full * (HALF_FRACTION / FULL_FRACTION)), full]
  }

  function fullHeight(): number {
    return detents[detents.length - 1] ?? PEEK_MIN_PX
  }

  /**
   * Position the sheet by translating it down out of its own full height.
   *
   * Past the top detent the sheet cannot translate any further without lifting its
   * bottom edge off the screen, so the overshoot grows its height instead
   * (`--sheet-over`): the rubber band stretches the card rather than opening a gap.
   */
  function apply(px: number): void {
    const full = fullHeight()
    visible = px
    root.style.setProperty('--sheet-y', `${Math.max(0, Math.round(full - px))}px`)
    root.style.setProperty('--sheet-over', `${Math.max(0, Math.round(px - full))}px`)
    root.classList.toggle('is-full', px >= full - 1)
  }

  /** Diminishing returns: `x` px of pull yields at most `max` px of movement. */
  function rubber(x: number, max: number): number {
    return max * (1 - Math.exp(-x / max))
  }

  /** Clamp a raw drag position onto the detent range, softly. */
  function resist(px: number): number {
    const full = fullHeight()
    const peek = detents[0] ?? PEEK_MIN_PX
    if (px > full) return full + rubber(px - full, OVERDRAG_MAX)
    if (px < peek) return peek - rubber(peek - px, UNDERDRAG_MAX)
    return px
  }

  function nearestIndex(px: number): number {
    let best = 0
    for (let i = 1; i < detents.length; i++) {
      if (Math.abs((detents[i] ?? 0) - px) < Math.abs((detents[best] ?? 0) - px)) best = i
    }
    return best
  }

  function snapTo(index: number, animate = true): void {
    detentIndex = Math.min(detents.length - 1, Math.max(0, index))
    root.classList.toggle('is-dragging', !animate)
    apply(detents[detentIndex] ?? PEEK_MIN_PX)
    root.dataset['detent'] = ['peek', 'half', 'full'][detentIndex] ?? 'peek'
    // Only worth saying while the week is hidden; once it is on screen the words are
    // just noise over the thing they were pointing at.
    const closed = detentIndex === 0
    handleLabel.hidden = !closed
    handle.setAttribute('aria-label', closed ? 'Show your week' : 'Resize the panel')
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
  // The webfont arrives after first paint and changes the card's height.
  void document.fonts?.ready.then(remeasure).catch(() => {})

  // --- dragging ----------------------------------------------------------------
  /**
   * `pending` = a finger is down and we have not decided yet; `dragging` = the slop
   * was crossed and the sheet is following it. Deciding late is what keeps a tap on
   * a class row a tap.
   */
  let phase: 'idle' | 'pending' | 'dragging' = 'idle'
  let activeId = -1
  let fromGrab = false
  let startY = 0
  let startX = 0
  let startVisible = 0
  let startScrollTop = 0
  let lastY = 0
  let lastTime = 0
  let velocity = 0
  /** Set for one turn after a real drag so the release does not fire a click. */
  let suppressClick = false

  /** The handle and the Now/Next header drag unconditionally. */
  function onGrabSurface(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.sheet-handle, .sheet-grab') !== null
  }

  const atFullDetent = (): boolean => detentIndex === detents.length - 1

  /**
   * Should a gesture that began in the scrolling body become a sheet drag?
   *
   * Below the full detent the body is `overflow: hidden` — there is nothing to
   * scroll, so every swipe is ours. At the full detent the body scrolls, and the
   * only gesture we take from it is a pull DOWN that starts at the very top: the
   * handoff that makes a sheet feel native. Everything else stays a scroll.
   */
  function bodyGestureIsDrag(dy: number): boolean {
    if (!atFullDetent()) return true
    return dy > 0 && startScrollTop <= 0 && scroll.scrollTop <= 0
  }

  root.addEventListener('pointerdown', (event: PointerEvent) => {
    if (isDesktop()) return
    // Second fingers and right/middle buttons are not sheet drags.
    if (!event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    // Belt and braces: the previous gesture's click has already been and gone by the
    // time a new finger lands, so nothing is left to suppress.
    suppressClick = false
    phase = 'pending'
    activeId = event.pointerId
    fromGrab = onGrabSurface(event.target)
    startX = event.clientX
    startY = event.clientY
    lastY = event.clientY
    lastTime = event.timeStamp
    startVisible = visible
    startScrollTop = scroll.scrollTop
    velocity = 0
    listen()
  })

  function onMove(event: PointerEvent): void {
    if (phase === 'idle' || event.pointerId !== activeId) return

    if (phase === 'pending') {
      const dy = event.clientY - startY
      const dx = event.clientX - startX
      if (Math.abs(dy) < DRAG_SLOP) return
      // A mostly-horizontal swipe belongs to whatever is under it, not to us.
      if (Math.abs(dx) > Math.abs(dy) * DIRECTION_LOCK) { phase = 'idle'; return }
      if (!fromGrab && !bodyGestureIsDrag(dy)) { phase = 'idle'; return }

      phase = 'dragging'
      // Re-base on the point where the drag was recognised, so the sheet does not
      // jump by the slop the moment it starts following the finger.
      startY = event.clientY
      startVisible = visible
      root.classList.add('is-dragging')
      // Capture on the sheet, paired with `touch-action` in ui.css. On iOS Safari
      // capture alone is not enough: without the right touch-action, Safari's own
      // scrolling claims the gesture before the first pointermove arrives.
      try { root.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
    }

    // The sheet owns this gesture now: stop the page doing anything else with it.
    if (event.cancelable) event.preventDefault()

    const dt = event.timeStamp - lastTime
    if (dt > 0) {
      // px/ms, positive = travelling up = sheet growing. Smoothed, or one jittery
      // last sample decides the snap.
      const sample = (lastY - event.clientY) / dt
      velocity = velocity === 0 ? sample : velocity * 0.7 + sample * 0.3
    }
    lastY = event.clientY
    lastTime = event.timeStamp

    apply(resist(startVisible + (startY - event.clientY)))
  }

  /**
   * End of gesture. Also the `pointercancel` path — iOS fires that where Chrome does
   * not, and the sheet must land on a detent either way rather than freeze mid-drag.
   */
  function endDrag(event: PointerEvent): void {
    if (event.pointerId !== activeId) return
    const wasDragging = phase === 'dragging'
    phase = 'idle'
    activeId = -1
    unlisten()
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
    if (!wasDragging) return

    root.classList.remove('is-dragging')
    suppressClick = true
    requestAnimationFrame(() => { suppressClick = false })

    // A finger that came to rest before lifting is a settle, not a flick.
    if (event.timeStamp - lastTime > VELOCITY_STALE_MS) velocity = 0

    if (Math.abs(velocity) > FLICK_VELOCITY) {
      // Project where the flick was heading, then make sure it moves at least one
      // detent that way — that is what lets a short, fast swipe down still dismiss.
      const projected = nearestIndex(visible + velocity * FLICK_PROJECTION_MS)
      snapTo(velocity > 0 ? Math.max(projected, detentIndex + 1) : Math.min(projected, detentIndex - 1))
      return
    }

    snapTo(nearestIndex(visible))
  }

  /**
   * The rest of the gesture is followed on `window`, and ONLY between the pointerdown
   * that started on the sheet and its release. A permanent document listener would
   * eat the map's own pans; these cannot, because they are attached by a pointerdown
   * the sheet already owns and every handler re-checks the pointer id.
   *
   * They are not redundant with listening on the sheet: pointer capture is only taken
   * once the slop is crossed, and the very first move of an upward drag from the grab
   * handle is already above the sheet's top edge. Bound to the sheet, that move goes
   * to the map instead and the drag never starts at all — which is exactly how this
   * failed with a mouse. (Touch has implicit capture from pointerdown and did not
   * show it, so this is belt and braces for the reported bug and a real fix for pen
   * and pointer input.)
   */
  function listen(): void {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  function unlisten(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }

  // A drag that ends over a class row must not also select it.
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )

  // The handle is a real button: a tap (or Enter/Space) cycles detents. Drags never
  // reach this — they are swallowed by the capture listener above.
  handle.addEventListener('click', () => {
    if (isDesktop()) return
    snapTo((detentIndex + 1) % detents.length)
  })

  // --- rendering ---------------------------------------------------------------
  let lastSelectedId: string | null = null

  function render(state: AppState): void {
    // Only one `transition-note` may exist on the page at a time; the detail card
    // takes it whenever a class is selected.
    const heroRebuilt = nowNext.update(state, state.selected === null)
    detail.update(state)

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

    // The peek detent is the measured height of the hero card, and that height moves
    // when the card's subject does — "Engineering & Computer Science" wraps where
    // "Bob Wright Centre" does not. Re-measure, but never mid-gesture: snapping the
    // sheet out from under a finger is worse than a few clipped pixels.
    // ...and only at peek, the one detent whose height IS the card. Re-measuring at
    // half or full would re-snap without a transition, turning the open-on-select
    // animation into a jump.
    if (heroRebuilt && phase === 'idle' && detentIndex === 0) requestAnimationFrame(remeasure)
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
