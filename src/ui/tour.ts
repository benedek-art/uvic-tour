/**
 * Cinematic tour mode — the "show your friend around campus" feature (SPEC §5.8).
 *
 * Press play and the camera flies a scripted, narrated loop: you arrive at the bus
 * exchange like everyone does, land on your 8:30 Monday lecture hall, sweep through the
 * three buildings that hold your five classes, then the gym, the library and the food,
 * and finish on a slow orbit over Ring Road. Eight stops, ~4 s each. It is meant to feel
 * like a title sequence, not a slideshow.
 *
 * THREE THINGS THIS MODULE REFUSES TO GET WRONG
 *
 *  1. **It never strands you.** Every flight is chained on the map's `moveend`, but
 *     `moveend` is not a promise — an interrupted or degenerate camera move can simply
 *     never emit one. Each leg therefore also carries a deadman timer that advances the
 *     tour regardless. A tour that hangs is worse than no tour at all.
 *  2. **Cancelling actually cancels.** Escape, a tap anywhere on the map, and the Stop
 *     button all run through one `stopTour()`. A run token (`Run`) is flipped and every
 *     pending timer, listener and awaited promise is woken and discarded, so a stop
 *     mid-flight can't leave a zombie timer firing into a torn-down overlay.
 *  3. **Reduced motion is honoured.** With `prefers-reduced-motion: reduce` the camera
 *     jumps instead of flying, holds are shortened, and the closing orbit is skipped
 *     entirely — nobody gets trapped inside a two-minute animation.
 *
 * FILE BOUNDARIES. This module exports functions and owns exactly two pieces of DOM: the
 * launch button it appends to whatever root the orchestrator hands it, and the contents
 * of the existing `<div id="tour-overlay">`. It never touches the sheet, the scrubber or
 * the store — the orchestrator does that from `onStart` / `onEnd`.
 *
 * Colour note: `--gold` is reserved for the student's own class buildings (SPEC §4).
 * Every piece of tour chrome below is `--cyan` or a neutral token.
 */

// Vite's ambient types declare `*.css` so the side-effect import below typechecks
// without adding "vite/client" to the shared tsconfig.
/// <reference types="vite/client" />

// Aliased: a bare `import type { Map }` would shadow the global `Map` constructor.
import type { Map as MapLibreMap } from 'maplibre-gl'

import { CAMPUS_TARGET, buildingTarget, orbit } from '../map/camera'
import { POIS } from '../data/pois'
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
 * Eight beats, and the order is the whole point: it is the shape of an actual first day.
 * Arrive → first class → the building you'll live in → the odd one out → gym → library →
 * food → and a look at the whole thing from above.
 */
export const TOUR_STOPS: TourStop[] = [
  {
    title: 'You arrive here',
    body: 'Almost everyone starts at this loop. Step off the bus, walk two minutes south, and campus opens up around you.',
    target: poiPose('bus-loop', [-123.30865, 48.46609], 16.9, 52, 24),
    holdMs: HOLD_MS,
  },
  {
    title: 'Bob Wright Centre',
    body: 'Your very first class. 8:30 Monday morning, BIOL 184, room B150. Maybe set two alarms for that one.',
    target: buildingPose('Bob Wright Centre', [-123.30903, 48.46214], 17.5, 55, -30),
    holdMs: HOLD_MS,
  },
  {
    title: 'MacLaurin Building',
    body: 'Three of your five classes live here — Italian in D287, and both Psych sections in the very same room.',
    target: buildingPose('MacLaurin Building', [-123.31386, 48.4628], 17.5, 55, 12),
    holdMs: HOLD_MS,
  },
  {
    title: 'Engineering / Computer Science',
    body: 'BIOL 150A hides in room 123, Tuesday, Wednesday and Friday afternoons. Biology, in the engineering building. Welcome to UVic.',
    target: buildingPose('Engineering/Computer Science Building', [-123.31144, 48.46103], 17.4, 55, -46),
    holdMs: HOLD_MS,
  },
  {
    title: 'CARSA',
    body: 'The gym, already paid for by your tuition. Weights, courts, a climbing wall — and Mondays leave you a six-hour gap.',
    target: poiPose('carsa', [-123.31119, 48.4679], 17.2, 58, 40),
    holdMs: HOLD_MS,
  },
  {
    title: 'McPherson Library',
    body: 'Five floors, and the higher you climb the quieter it gets. Coffee is downstairs, so you never give up your table.',
    target: poiPose('mcpherson-library', [-123.30935, 48.46342], 17.3, 54, -8),
    holdMs: HOLD_MS,
  },
  {
    title: 'The SUB',
    body: 'Food court, pub, and every club on campus. This is where an hour between classes quietly turns into three.',
    target: poiPose('student-union', [-123.30819, 48.46508], 17.2, 56, 62),
    holdMs: HOLD_MS,
  },
  {
    title: "That's the loop",
    body: 'Ring Road holds all of it — five classes, one gym, and a famous number of rabbits. See you in September.',
    target: { center: [CAMPUS_TARGET.center[0], CAMPUS_TARGET.center[1]], zoom: 15.2, pitch: 58, bearing: -18 },
    holdMs: HOLD_MS,
  },
]

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
 * One playthrough. `cancelled` is the token every await checks; `wake` holds the resolve
 * functions of everything currently being awaited so cancelling can unblock them all at
 * once instead of waiting out a 4-second hold.
 */
interface Run {
  cancelled: boolean
  ended: boolean
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

/** Resolves as soon as the run is cancelled — used to stop awaiting a long animation. */
function cancellation(run: Run): Promise<void> {
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
  count: HTMLElement
  ticks: HTMLElement[]
  title: HTMLElement
  body: HTMLElement
  card: HTMLElement
}

/** Build the narration card inside the existing `#tour-overlay` and reveal it. */
function buildOverlay(overlay: HTMLElement, onStop: () => void): Chrome {
  overlay.replaceChildren()
  overlay.classList.add('tour')

  // Full-bleed and pointer-catching: this *is* the "tap the map to exit" surface, and it
  // also stops a stray drag from fighting the camera mid-flight.
  const scrim = document.createElement('div')
  scrim.className = 'tour__scrim'
  scrim.addEventListener('click', onStop)

  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'tour__stop'
  stop.setAttribute('data-testid', 'tour-stop')
  stop.textContent = 'Stop tour'
  stop.addEventListener('click', (event) => {
    event.stopPropagation()
    onStop()
  })

  const card = document.createElement('div')
  card.className = 'tour__card'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')

  const meta = document.createElement('div')
  meta.className = 'tour__meta'

  const count = document.createElement('span')
  count.className = 'tour__count mono'

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

  meta.append(count, tickRow)
  card.append(meta, title, body)
  overlay.append(scrim, stop, card)
  overlay.hidden = false
  overlay.classList.add('is-playing')

  return { count, ticks, title, body, card }
}

/** Put the app back exactly as we found it. Safe to call twice. */
function teardownOverlay(overlay: HTMLElement): void {
  overlay.replaceChildren()
  overlay.classList.remove('tour', 'is-playing')
  overlay.hidden = true
}

/** Swap in one stop's copy, re-triggering the card's entrance so stops cross-fade. */
function renderStop(chrome: Chrome, stop: TourStop, index: number): void {
  chrome.card.classList.remove('is-in')
  // Force a reflow so removing and re-adding the class restarts the transition rather
  // than being coalesced into a no-op by the browser.
  void chrome.card.offsetWidth

  chrome.count.textContent = `${index + 1} / ${TOUR_STOPS.length}`
  chrome.title.textContent = stop.title
  chrome.body.textContent = stop.body
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
 * user bailed out — so the orchestrator can restore the sheet and scrubber in one place.
 *
 * Starting while a tour is already running restarts cleanly: the previous run is stopped
 * (and its `onEnd` fired) first.
 */
export function startTour(map: MapLibreMap, overlay: HTMLElement, onEnd: () => void): void {
  stopTour()

  const run: Run = { cancelled: false, ended: false, wake: new Set(), detach: [], onEnd }
  current = run

  const chrome = buildOverlay(overlay, stopTour)
  run.detach.push(() => teardownOverlay(overlay))

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') stopTour()
  }
  document.addEventListener('keydown', onKey)
  run.detach.push(() => document.removeEventListener('keydown', onKey))

  // Belt and braces: the scrim already swallows taps, but if anything else manages to
  // grab the camera the tour should get out of the way rather than fight it. `dragstart`
  // is user-driven only — `flyTo` never emits it, so this cannot self-cancel.
  const onDrag = (): void => { stopTour() }
  map.on('dragstart', onDrag)
  run.detach.push(() => { map.off('dragstart', onDrag) })

  void play(map, run, chrome)
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

  // Copy first: each waker deletes itself from the set as it resolves.
  for (const wake of [...run.wake]) wake()
  run.wake.clear()

  for (const detach of run.detach) detach()
  run.detach.length = 0

  if (!run.ended) {
    run.ended = true
    run.onEnd()
  }
}

/** The sequence itself. Every await is followed by a cancellation check. */
async function play(map: MapLibreMap, run: Run, chrome: Chrome): Promise<void> {
  const reduced = prefersReducedMotion()
  const hold = reduced ? REDUCED_HOLD_MS : HOLD_MS

  for (const [index, stop] of TOUR_STOPS.entries()) {
    if (run.cancelled) return

    renderStop(chrome, stop, index)

    await flyAndSettle(map, run, stop.target, reduced)
    if (run.cancelled) return

    await sleep(run, Math.min(stop.holdMs, hold))
    if (run.cancelled) return

    // The finale: a full turn over Ring Road with the last card still up.
    if (index === TOUR_STOPS.length - 1 && !reduced) {
      await Promise.race([cancellableOrbit(map, run, ORBIT_MS), cancellation(run)])
      if (run.cancelled) return
    }
  }

  stopTour()
}
