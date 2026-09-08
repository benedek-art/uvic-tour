/**
 * Guided tour mode — the "show your friend around campus" feature (SPEC §5.8).
 *
 * Press play and the camera walks a scripted, narrated route: it starts on your own
 * residence ("this is you"), moves out through the three buildings that hold your five
 * classes, then the library, the food and the gym, and finishes on a slow orbit over
 * Ring Road. Eight stops, ~4 s each, and it advances by itself so a passive viewer
 * never has to do anything.
 *
 * FOUR THINGS THIS MODULE REFUSES TO GET WRONG
 *
 *  1. **A tap means NEXT, never EXIT.** This module used to mount a full-bleed scrim
 *     that cancelled the tour on any tap — so the one gesture everybody makes while
 *     watching a slideshow destroyed the thing they had just started. Now the scrim
 *     advances. Leaving needs the big labelled "Done" button, or Escape. Nothing else
 *     ends the tour early. (REDESIGN §3.)
 *  2. **It opens somewhere you recognise.** Stop 1 is the student's own residence,
 *     resolved from the OSM polygon. The old stop 1 was the bus loop, whose coordinate
 *     `src/data/pois.ts` labels DERIVED — an unlabelled patch of road that reads as
 *     "a random place". Every stop below now resolves from a surveyed or RESOLVED
 *     coordinate; nothing ESTIMATED is in the script.
 *  3. **It never strands you.** Every flight is chained on the map's `moveend`, but
 *     `moveend` is not a promise — an interrupted or degenerate camera move can simply
 *     never emit one. Each leg therefore also carries a deadman timer that advances the
 *     tour regardless. A tour that hangs is worse than no tour at all.
 *  4. **Cancelling actually cancels.** Escape and the Done button both run through one
 *     `stopTour()`. A run token (`Run`) is flipped and every pending timer, listener and
 *     awaited promise is woken and discarded, so a stop mid-flight can't leave a zombie
 *     timer firing into a torn-down overlay.
 *
 * Reduced motion is honoured: the camera jumps instead of flying, holds are shortened,
 * and the closing orbit is skipped entirely.
 *
 * FILE BOUNDARIES. This module exports functions and owns exactly two pieces of DOM: the
 * launch button it appends to whatever root the orchestrator hands it, and the contents
 * of the existing `<div id="tour-overlay">`. It never touches the sheet, the scrubber or
 * the store — the orchestrator does that from `onStart` / `onEnd`.
 *
 * Colour note (REDESIGN §1): `--gold` (terracotta) is reserved for the student's own
 * buildings and for PRIMARY buttons. The one primary button here is "Next stop"; every
 * other piece of tour chrome is `--cyan` (sage) or a neutral paper/ink token.
 */

// Vite's ambient types declare `*.css` so the side-effect import below typechecks
// without adding "vite/client" to the shared tsconfig.
/// <reference types="vite/client" />

// Aliased: a bare `import type { Map }` would shadow the global `Map` constructor.
import type { Map as MapLibreMap } from 'maplibre-gl'

import { CAMPUS_TARGET, buildingTarget, orbit } from '../map/camera'
import { POIS } from '../data/pois'
import { HOME_BUILDING } from '../data/home'
import './tour.css'

/** One beat of the tour: where the camera goes, and what the card says while it's there. */
export interface TourStop {
  title: string
  body: string
  target: { center: [number, number]; zoom: number; pitch: number; bearing: number }
  /** How long the card stays up once the camera has settled. */
  holdMs: number
}

/* ------------------------------------------------------------------ *
 * Timings
 * ------------------------------------------------------------------ */

/** SPEC §5.8: "each stop holds ~4 s with its card". */
const HOLD_MS = 4000
/** Reduced motion still gets to read the card, just without the dwell. */
const REDUCED_HOLD_MS = 1800
/**
 * Deadman for a single leg. A campus-scale `flyTo` settles in under 2 s (see
 * `src/map/camera.ts`), so 7 s means "something ate our `moveend`" — advance anyway.
 */
const FLIGHT_DEADMAN_MS = 7000
/** The closing turn. One full 360° over Ring Road. */
const ORBIT_MS = 11000
/** Matches the house arc in `src/map/camera.ts`, a touch slower for the tour's pacing. */
const FLY = { curve: 1.42, speed: 0.62, essential: true } as const

/* ------------------------------------------------------------------ *
 * The script
 * ------------------------------------------------------------------ */

/**
 * Resolve a POI's pose. Centre comes from the baked POI record; the framing is authored
 * per stop so the tour doesn't repeat the same three-quarter angle eight times running.
 *
 * Only POIs that `src/data/pois.ts` marks RESOLVED (a real OSM polygon centroid) are used
 * in the script — the DERIVED bus loop and every ESTIMATED pin are deliberately absent.
 *
 * The literal is a labelled fallback, not a duplicate source of truth — it only applies
 * if the id ever disappears from `src/data/pois.ts`, and every value is inside the campus
 * bbox so a missing POI still produces a sane camera rather than a flight to null island.
 */
function poiPose(
  id: string,
  fallback: readonly [number, number],
  zoom: number,
  pitch: number,
  bearing: number,
): TourStop['target'] {
  const poi = POIS.find((p) => p.id === id)
  const center: [number, number] = poi ? [poi.lon, poi.lat] : [fallback[0], fallback[1]]
  return { center, zoom, pitch, bearing }
}

/**
 * Resolve an OSM building's pose via `buildingTarget`, then re-frame it. Fallback
 * coordinates are the surveyed values from SPEC §3, used only if the polygon vanishes.
 */
function buildingPose(
  name: string,
  fallback: readonly [number, number],
  zoom: number,
  pitch: number,
  bearing: number,
): TourStop['target'] {
  const resolved = buildingTarget(name)
  const center: [number, number] = resolved ? resolved.center : [fallback[0], fallback[1]]
  return { center, zoom, pitch, bearing }
}

/**
 * Eight beats, and the order is the whole point: it starts where the student wakes up
 * and works outward.
 *
 * Home → first class → the building with three of your classes → the odd one out →
 * the library → the food → the gym → and a look at the whole thing from above.
 *
 * Stop 1 used to be the bus exchange. It is a stretch of unlabelled service road whose
 * coordinate is DERIVED rather than surveyed, so the tour opened on what looked like
 * nowhere. Opening on the building you sleep in is instantly recognisable, and it makes
 * every stop after it read as a distance from home.
 */
export const TOUR_STOPS: TourStop[] = [
  {
    title: 'This is you',
    body: 'Your room is in here — Roderick Haig-Brown. Every walk in this app starts at this door.',
    target: buildingPose(HOME_BUILDING, [-123.306375, 48.462404], 17.6, 55, 20),
    holdMs: HOLD_MS,
  },
  {
    title: 'Your first class',
    body: 'Bob Wright Centre. Biology at 8:30 on Monday, room B150. Maybe set two alarms.',
    target: buildingPose('Bob Wright Centre', [-123.30903, 48.46214], 17.5, 55, -30),
    holdMs: HOLD_MS,
  },
  {
    title: 'Three of your classes',
    body: 'MacLaurin Building. Italian and both Psych sections — the two Psych ones share a room.',
    target: buildingPose('MacLaurin Building', [-123.31386, 48.4628], 17.5, 55, 12),
    holdMs: HOLD_MS,
  },
  {
    title: 'The odd one out',
    body: 'Biology in the engineering building, room 123. Tuesday, Wednesday and Friday afternoons.',
    target: buildingPose('Engineering/Computer Science Building', [-123.31144, 48.46103], 17.4, 55, -46),
    holdMs: HOLD_MS,
  },
  {
    title: 'The library',
    body: 'McPherson Library. Five floors, and the higher you go the quieter it gets.',
    target: poiPose('mcpherson-library', [-123.30935, 48.46342], 17.3, 54, -8),
    holdMs: HOLD_MS,
  },
  {
    title: 'Food and people',
    body: 'The SUB. Food court, pub and every club on campus. Lunch happens here.',
    target: poiPose('student-union', [-123.30819, 48.46508], 17.2, 56, 62),
    holdMs: HOLD_MS,
  },
  {
    title: 'The gym',
    body: 'CARSA, already paid for by your tuition. Weights, courts and a climbing wall.',
    target: poiPose('carsa', [-123.31119, 48.4679], 17.2, 58, 40),
    holdMs: HOLD_MS,
  },
  {
    title: "That's your campus",
    body: 'Ring Road holds all of it — five classes, one gym, and a lot of rabbits.',
    target: { center: [CAMPUS_TARGET.center[0], CAMPUS_TARGET.center[1]], zoom: 15.2, pitch: 58, bearing: -18 },
    holdMs: HOLD_MS,
  },
]

/** Plain language, not a fraction. "3 / 8" is a ratio; "Stop 3 of 8" is a sentence. */
function progressLabel(index: number): string {
  return `Stop ${index + 1} of ${TOUR_STOPS.length}`
}

/* ------------------------------------------------------------------ *
 * Launch button
 * ------------------------------------------------------------------ */

/**
 * Append the play button to `root` (the orchestrator passes `#topbar`).
 *
 * Deliberately **appends** rather than replacing `root`'s children: the layer toggles are
 * mounted into the same bar and call `replaceChildren()` themselves, so clearing here
 * would make mount order load-bearing. Re-mounting is still idempotent — any previous
 * button of ours is removed first.
 */
export function mountTourButton(root: HTMLElement, onStart: () => void): void {
  root.querySelector('.tour-launch')?.remove()

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tour-launch'
  button.setAttribute('data-testid', 'tour-start')
  button.setAttribute('aria-label', 'Play the guided campus tour')

  const icon = document.createElement('span')
  icon.className = 'tour-launch__icon'
  icon.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = 'tour-launch__label'
  label.textContent = 'Show me campus'

  button.append(icon, label)
  button.addEventListener('click', () => { onStart() })
  root.append(button)
}

/* ------------------------------------------------------------------ *
 * The runner
 * ------------------------------------------------------------------ */

/**
 * One playthrough.
 *
 * `cancelled` is the token every await checks; `wake` holds the resolve functions of
 * everything currently being awaited, so both cancelling *and* skipping ahead can unblock
 * them at once instead of waiting out a 4-second hold.
 *
 * `index` is the cursor the loop reads at the top of every beat. `nextStop()` bumps it and
 * wakes the sleepers; the loop notices the cursor moved under it and restarts on the new
 * stop. That is the whole "tap to skip ahead" mechanism — no second timer, no second
 * source of truth for which stop is showing.
 */
interface Run {
  cancelled: boolean
  ended: boolean
  index: number
  /** The index currently painted, so a tap and the loop can't render the same beat twice. */
  rendered: number
  chrome: Chrome | null
  wake: Set<() => void>
  detach: Array<() => void>
  onEnd: () => void
}

/** At most one tour ever runs. Module-level because `stopTour()` takes no arguments. */
let current: Run | null = null

function prefersReducedMotion(): boolean {
  if (typeof matchMedia === 'undefined') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Paint one beat, at most once.
 *
 * Both the loop and a tap call this. A tap paints IMMEDIATELY rather than waiting for the
 * loop to wake up a microtask later — REDESIGN §2.5, "every tap does something visible" —
 * and the loop then finds the beat already on screen and leaves it alone.
 */
function show(run: Run, index: number): void {
  const stop = TOUR_STOPS[index]
  if (!run.chrome || !stop || run.rendered === index) return
  run.rendered = index
  renderStop(run.chrome, stop, index)
}

/** Wake everything currently being awaited, without cancelling the run. */
function wakeAll(run: Run): void {
  // Copy first: each waker deletes itself from the set as it resolves.
  for (const wake of [...run.wake]) wake()
}

/** A cancellable pause. Registers its own resolver so `stopTour()` can cut it short. */
function sleep(run: Run, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer)
      run.wake.delete(finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    run.wake.add(finish)
  })
}

/**
 * Move the camera to `target` and resolve once it has settled.
 *
 * Reduced motion jumps. Otherwise: listen for `moveend` **before** flying (nothing can
 * slip between the two, they're in the same tick) and race it against `FLIGHT_DEADMAN_MS`
 * so a swallowed `moveend` can never wedge the tour.
 */
function flyAndSettle(map: MapLibreMap, run: Run, target: TourStop['target'], reduced: boolean): Promise<void> {
  if (reduced) {
    map.jumpTo(target)
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer)
      map.off('moveend', finish)
      run.wake.delete(finish)
      resolve()
    }
    const timer = window.setTimeout(finish, FLIGHT_DEADMAN_MS)
    run.wake.add(finish)
    map.on('moveend', finish)
    map.flyTo({ ...target, ...FLY })
  })
}

/**
 * The closing orbit, made interruptible.
 *
 * `orbit()` drives its own `requestAnimationFrame` loop and offers no way in from outside,
 * so it is handed a facade instead of the real map: the moment the run is cancelled the
 * facade stops forwarding `setBearing`, and the camera is left exactly where the user
 * grabbed it rather than continuing to spin under a dismissed overlay. The cast is the
 * price of that guarantee — `orbit` only ever calls these two methods.
 */
function cancellableOrbit(map: MapLibreMap, run: Run, ms: number): Promise<void> {
  const facade = {
    getBearing: () => map.getBearing(),
    setBearing: (bearing: number) => {
      if (!run.cancelled) map.setBearing(bearing)
    },
  } as unknown as MapLibreMap
  return orbit(facade, ms)
}

/** Resolves as soon as the run is cancelled or skipped — stops awaiting a long animation. */
function interruption(run: Run): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      run.wake.delete(finish)
      resolve()
    }
    run.wake.add(finish)
  })
}

/* ------------------------------------------------------------------ *
 * Overlay rendering
 * ------------------------------------------------------------------ */

interface Chrome {
  progress: HTMLElement
  ticks: HTMLElement[]
  title: HTMLElement
  body: HTMLElement
  card: HTMLElement
  next: HTMLElement
  overlay: HTMLElement
}

/**
 * Build the narration card inside the existing `#tour-overlay` and reveal it.
 *
 * Two handlers, and the difference between them is the entire bug fix:
 *   `onNext` — the full-bleed surface, and the big primary button. Tap = next stop.
 *   `onDone` — the one labelled control that leaves. Nothing else exits.
 */
function buildOverlay(overlay: HTMLElement, onNext: () => void, onDone: () => void): Chrome {
  overlay.replaceChildren()
  overlay.classList.add('tour')

  // Full-bleed and pointer-catching. It used to cancel the tour; now it ADVANCES it,
  // which is what everyone was already trying to do. It also stops a stray drag from
  // fighting the camera mid-flight.
  const scrim = document.createElement('button')
  scrim.type = 'button'
  scrim.className = 'tour__scrim'
  scrim.setAttribute('data-testid', 'tour-scrim')
  scrim.setAttribute('aria-label', 'Next stop')
  scrim.addEventListener('click', onNext)

  const done = document.createElement('button')
  done.type = 'button'
  done.className = 'tour__done'
  done.setAttribute('data-testid', 'tour-stop')
  done.setAttribute('aria-label', 'Close the tour')

  const doneMark = document.createElement('span')
  doneMark.className = 'tour__done-mark'
  doneMark.setAttribute('aria-hidden', 'true')
  doneMark.textContent = '✕'

  const doneLabel = document.createElement('span')
  doneLabel.textContent = 'Done'

  done.append(doneMark, doneLabel)
  done.addEventListener('click', (event) => {
    event.stopPropagation()
    onDone()
  })

  const card = document.createElement('div')
  card.className = 'tour__card'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')

  const meta = document.createElement('div')
  meta.className = 'tour__meta'

  const progress = document.createElement('span')
  progress.className = 'tour__progress'
  progress.setAttribute('data-testid', 'tour-progress')

  const tickRow = document.createElement('span')
  tickRow.className = 'tour__ticks'
  tickRow.setAttribute('aria-hidden', 'true')
  const ticks: HTMLElement[] = TOUR_STOPS.map(() => {
    const tick = document.createElement('span')
    tick.className = 'tour__tick'
    tickRow.append(tick)
    return tick
  })

  const title = document.createElement('h2')
  title.className = 'tour__title'

  const body = document.createElement('p')
  body.className = 'tour__body'

  // The primary action, and the only place --gold appears in tour chrome (REDESIGN §2.1).
  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'tour__next'
  next.setAttribute('data-testid', 'tour-next')
  next.addEventListener('click', (event) => {
    event.stopPropagation()
    onNext()
  })

  const hint = document.createElement('p')
  hint.className = 'tour__hint'
  hint.textContent = 'Or tap anywhere on the map'

  meta.append(progress, tickRow)
  card.append(meta, title, body, next, hint)
  overlay.append(scrim, done, card)
  overlay.hidden = false
  overlay.classList.add('is-playing')

  return { progress, ticks, title, body, card, next, overlay }
}

/** Put the app back exactly as we found it. Safe to call twice. */
function teardownOverlay(overlay: HTMLElement): void {
  overlay.replaceChildren()
  overlay.classList.remove('tour', 'is-playing')
  overlay.removeAttribute('data-stop')
  overlay.hidden = true
}

/** Swap in one stop's copy, re-triggering the card's entrance so stops cross-fade. */
function renderStop(chrome: Chrome, stop: TourStop, index: number): void {
  chrome.card.classList.remove('is-in')
  // Force a reflow so removing and re-adding the class restarts the transition rather
  // than being coalesced into a no-op by the browser.
  void chrome.card.offsetWidth

  // 1-based, and readable by a test without parsing prose.
  chrome.overlay.dataset.stop = String(index + 1)

  chrome.progress.textContent = progressLabel(index)
  chrome.title.textContent = stop.title
  chrome.body.textContent = stop.body
  chrome.next.textContent = index === TOUR_STOPS.length - 1 ? 'Finish' : 'Next stop'
  for (const [i, tick] of chrome.ticks.entries()) {
    tick.classList.toggle('is-done', i <= index)
  }

  chrome.card.classList.add('is-in')
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Play the tour. `onEnd` fires exactly once — whether the loop finished on its own or the
 * user pressed Done — so the orchestrator can restore the sheet and scrubber in one place.
 *
 * Starting while a tour is already running restarts cleanly: the previous run is stopped
 * (and its `onEnd` fired) first.
 */
export function startTour(map: MapLibreMap, overlay: HTMLElement, onEnd: () => void): void {
  stopTour()

  const run: Run = {
    cancelled: false,
    ended: false,
    index: 0,
    rendered: -1,
    chrome: null,
    wake: new Set(),
    detach: [],
    onEnd,
  }
  current = run

  const chrome = buildOverlay(overlay, nextStop, stopTour)
  run.chrome = chrome
  run.detach.push(() => teardownOverlay(overlay))

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') stopTour()
  }
  document.addEventListener('keydown', onKey)
  run.detach.push(() => document.removeEventListener('keydown', onKey))

  // NOTE: no `dragstart` cancel. The map is behind a full-bleed surface so a drag cannot
  // reach it anyway, and "the camera moved, so throw the user out" is exactly the kind of
  // surprise exit this rewrite removes.

  void play(map, run)
}

/**
 * Skip to the next stop immediately. This is what a tap does — on the scrim, on the card,
 * on the big button. On the final stop there is nowhere further to go, so it finishes the
 * tour; the button is labelled "Finish" there, so nothing about that is a surprise.
 */
function nextStop(): void {
  const run = current
  if (!run || run.cancelled) return

  if (run.index >= TOUR_STOPS.length - 1) {
    stopTour()
    return
  }

  run.index += 1
  show(run, run.index)
  wakeAll(run)
}

/**
 * Cancel immediately and restore the app. Idempotent, and safe to call from inside
 * `onEnd` — `ended` is set before the callback runs, so it cannot recurse.
 */
export function stopTour(): void {
  const run = current
  if (!run) return
  current = null
  run.cancelled = true

  wakeAll(run)
  run.wake.clear()

  for (const detach of run.detach) detach()
  run.detach.length = 0

  if (!run.ended) {
    run.ended = true
    run.onEnd()
  }
}

/**
 * The sequence itself.
 *
 * A `while` over `run.index` rather than a `for` over the array, because the cursor can
 * move under us at any await: `nextStop()` bumps it and wakes whatever we are waiting on,
 * and the `run.index !== index` checks below restart the beat on the new stop instead of
 * finishing the old one. Every await is also followed by a cancellation check.
 */
async function play(map: MapLibreMap, run: Run): Promise<void> {
  const reduced = prefersReducedMotion()
  const hold = reduced ? REDUCED_HOLD_MS : HOLD_MS

  while (!run.cancelled) {
    const index = run.index
    const stop = TOUR_STOPS[index]
    if (!stop) break

    show(run, index)

    await flyAndSettle(map, run, stop.target, reduced)
    if (run.cancelled) return
    if (run.index !== index) continue

    await sleep(run, Math.min(stop.holdMs, hold))
    if (run.cancelled) return
    if (run.index !== index) continue

    // The finale: a full turn over Ring Road with the last card still up.
    if (index === TOUR_STOPS.length - 1) {
      if (!reduced) {
        await Promise.race([cancellableOrbit(map, run, ORBIT_MS), interruption(run)])
        if (run.cancelled) return
        if (run.index !== index) continue
      }
      break
    }

    run.index = index + 1
  }

  stopTour()
}
