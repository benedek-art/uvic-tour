// @vitest-environment jsdom
/**
 * Smoke test for guided tour mode (src/ui/tour.ts).
 *
 * Focused on the things that would break silently and never show up in a screenshot
 * review:
 *
 *   1. The SCRIPT is right — eight stops, in the narrative order, starting on the
 *      student's own residence (REDESIGN §3: the tour used to open on the bus loop,
 *      whose coordinate is DERIVED, and it read as "a random place"). Every one of
 *      them carries real copy and a camera pose that is actually on campus; a typo'd
 *      coordinate flies to the middle of the Pacific and looks like a blank screen.
 *   2. A TAP ADVANCES, and never exits. This was the app's worst bug: the scrim
 *      cancelled the tour, so the gesture everyone makes destroyed the thing they had
 *      just started. Tested on the real DOM the module builds.
 *   3. The RUNNER cannot hang. `moveend` is not guaranteed to arrive, so the deadman
 *      timer is tested directly by never firing one.
 *   4. LEAVING cleans up: `onEnd` fires exactly once and the overlay goes away.
 *   5. The launch button mounts and calls back.
 *
 * The map is a stub. Real camera behaviour belongs to the E2E suite; what matters here
 * is the sequencing logic, which is pure enough to test without WebGL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { TOUR_STOPS, mountTourButton, startTour, stopTour } from '../../src/ui/tour'

/** SPEC §3. Every pose in the script must land inside this box. */
const BBOX = { minLon: -123.32, maxLon: -123.302, minLat: 48.4585, maxLat: 48.47 }

/** The rewritten narrative: home first, then outward. */
const EXPECTED_ORDER = [
  'This is you',
  'Your first class',
  'Three of your classes',
  'The odd one out',
  'The library',
  'Food and people',
  'The gym',
  "That's your campus",
]

/**
 * The residence centroid, straight out of `src/data/generated/buildings.geojson`.
 * Hardcoded on purpose: the point of the test is that stop 1 lands on the building
 * the student sleeps in, so re-deriving it from the same helper the code uses would
 * assert nothing.
 */
const HOME_CENTER: [number, number] = [-123.306375, 48.462404]

type Listener = () => void

/** Minimal MapLibre stand-in: records camera calls, lets the test fire map events. */
function stubMap() {
  const listeners = new Map<string, Set<Listener>>()
  const api = {
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    getBearing: vi.fn(() => 0),
    setBearing: vi.fn(),
    on: vi.fn((type: string, fn: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(fn)
      listeners.set(type, set)
    }),
    off: vi.fn((type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn)
    }),
  }
  return {
    map: api as unknown as MapLibreMap,
    api,
    emit(type: string): void {
      for (const fn of [...(listeners.get(type) ?? [])]) fn()
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0
    },
  }
}

/** jsdom's matchMedia always reports `matches: false`; make the answer controllable. */
function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function makeOverlay(): HTMLElement {
  const overlay = document.createElement('div')
  overlay.id = 'tour-overlay'
  overlay.hidden = true
  document.body.append(overlay)
  return overlay
}

const progress = (overlay: HTMLElement): string =>
  overlay.querySelector('.tour__progress')?.textContent ?? ''

const title = (overlay: HTMLElement): string =>
  overlay.querySelector('.tour__title')?.textContent ?? ''

/** Let the runner's awaits resume — the loop reacts to a tap one macrotask later. */
const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0) })

const tapScrim = (overlay: HTMLElement): void => {
  overlay.querySelector<HTMLButtonElement>('[data-testid="tour-scrim"]')!.click()
}

afterEach(() => {
  stopTour()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('TOUR_STOPS', () => {
  it('is the eight-stop narrative, in order', () => {
    expect(TOUR_STOPS).toHaveLength(8)
    expect(TOUR_STOPS.map((s) => s.title)).toEqual(EXPECTED_ORDER)
  })

  it('opens on the student\'s own residence, not the bus loop', () => {
    // REDESIGN §3. The bus loop's coordinate is DERIVED from OSM service ways, so it is
    // an unlabelled patch of road; Roderick Haig-Brown is a building with the student's
    // bed in it. Precision is loose because the centroid follows the polygon, not us.
    const [lon, lat] = TOUR_STOPS[0]!.target.center
    expect(lon).toBeCloseTo(HOME_CENTER[0], 4)
    expect(lat).toBeCloseTo(HOME_CENTER[1], 4)

    // And the derived bus-loop coordinate is nowhere in the script at all.
    const busLoop: [number, number] = [-123.30865, 48.46609]
    for (const stop of TOUR_STOPS) {
      const near =
        Math.abs(stop.target.center[0] - busLoop[0]) < 1e-4 &&
        Math.abs(stop.target.center[1] - busLoop[1]) < 1e-4
      expect(near).toBe(false)
    }
  })

  it.each(TOUR_STOPS.map((s, i) => [i + 1, s] as const))(
    'stop %i has copy and a pose on campus',
    (_n, stop) => {
      expect(stop.title.trim().length).toBeGreaterThan(0)
      expect(stop.body.trim().length).toBeGreaterThan(0)

      const [lon, lat] = stop.target.center
      expect(lon).toBeGreaterThanOrEqual(BBOX.minLon)
      expect(lon).toBeLessThanOrEqual(BBOX.maxLon)
      expect(lat).toBeGreaterThanOrEqual(BBOX.minLat)
      expect(lat).toBeLessThanOrEqual(BBOX.maxLat)

      // SPEC §4: the "architectural model" band. A flat or vertical stop breaks the look.
      expect(stop.target.pitch).toBeGreaterThanOrEqual(45)
      expect(stop.target.pitch).toBeLessThanOrEqual(65)
      expect(stop.holdMs).toBe(4000)
    },
  )
})

describe('mountTourButton', () => {
  it('renders a button that invokes its callback', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const onStart = vi.fn()

    mountTourButton(root, onStart)

    const button = root.querySelector<HTMLButtonElement>('[data-testid="tour-start"]')
    expect(button).not.toBeNull()
    button!.click()
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('appends rather than clearing the bar, and re-mounts idempotently', () => {
    const root = document.createElement('div')
    const sibling = document.createElement('span')
    sibling.className = 'layer-toggles'
    root.append(sibling)
    document.body.append(root)

    mountTourButton(root, () => {})
    mountTourButton(root, () => {})

    expect(root.querySelector('.layer-toggles')).toBe(sibling)
    expect(root.querySelectorAll('.tour-launch')).toHaveLength(1)
  })
})

describe('startTour', () => {
  it('shows the first stop in plain language and flies there', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, api } = stubMap()

    startTour(map, overlay, () => {})

    expect(overlay.hidden).toBe(false)
    expect(title(overlay)).toBe(EXPECTED_ORDER[0])
    expect(progress(overlay)).toBe('Stop 1 of 8')
    expect(overlay.dataset.stop).toBe('1')
    expect(api.flyTo).toHaveBeenCalledTimes(1)
    expect(api.flyTo.mock.calls[0]![0]).toMatchObject({ center: TOUR_STOPS[0]!.target.center })
  })

  it('offers a big labelled Next control, not a guess', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()

    startTour(map, overlay, () => {})

    const next = overlay.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')!
    expect(next.textContent).toBe('Next stop')
    expect(overlay.querySelector('[data-testid="tour-stop"]')?.textContent).toContain('Done')
  })
})

describe('tapping', () => {
  it('ADVANCES the tour instead of exiting it — the whole bug', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    expect(progress(overlay)).toBe('Stop 1 of 8')

    tapScrim(overlay)

    expect(progress(overlay)).toBe('Stop 2 of 8')
    expect(title(overlay)).toBe(EXPECTED_ORDER[1])
    expect(overlay.hidden).toBe(false) // still open
    expect(onEnd).not.toHaveBeenCalled() // and nobody got kicked out
  })

  it('walks the whole way forward on taps without ever exiting early', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)

    // Seven taps takes us from stop 1 to stop 8 with the overlay still up.
    for (let i = 0; i < TOUR_STOPS.length - 1; i++) tapScrim(overlay)

    expect(progress(overlay)).toBe('Stop 8 of 8')
    expect(overlay.hidden).toBe(false)
    expect(onEnd).not.toHaveBeenCalled()
    // On the last stop the button says so, so finishing is never a surprise.
    expect(overlay.querySelector('[data-testid="tour-next"]')?.textContent).toBe('Finish')
  })

  it('the big Next button advances too', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()

    startTour(map, overlay, () => {})
    overlay.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')!.click()

    expect(progress(overlay)).toBe('Stop 2 of 8')
  })

  it('skipping ahead mid-flight abandons the old leg cleanly', async () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, api, listenerCount } = stubMap()

    startTour(map, overlay, () => {})
    expect(listenerCount('moveend')).toBe(1)

    tapScrim(overlay)
    // The card repaints synchronously; the new camera leg is issued when the loop wakes.
    expect(progress(overlay)).toBe('Stop 2 of 8')
    await flush()

    // The old leg's listener is gone and a new flight is under way — not two at once.
    expect(listenerCount('moveend')).toBe(1)
    expect(api.flyTo).toHaveBeenCalledTimes(2)
    expect(api.flyTo.mock.calls[1]![0]).toMatchObject({ center: TOUR_STOPS[1]!.target.center })
  })
})

describe('auto-advance', () => {
  it('advances on its own so a passive viewer never has to do anything', async () => {
    vi.useFakeTimers()
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, emit } = stubMap()

    startTour(map, overlay, () => {})
    expect(progress(overlay)).toBe('Stop 1 of 8')

    emit('moveend') // camera settled
    await vi.advanceTimersByTimeAsync(4_100) // the hold elapses
    expect(progress(overlay)).toBe('Stop 2 of 8')
  })

  it('advances on the deadman timer when moveend never arrives', async () => {
    vi.useFakeTimers()
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()

    startTour(map, overlay, () => {})
    expect(progress(overlay)).toBe('Stop 1 of 8')

    // Never emit `moveend`. The flight deadman (7 s) plus the 4 s hold must still
    // carry the tour to stop 2 — a stalled tour is the worst possible failure here.
    await vi.advanceTimersByTimeAsync(11_500)
    expect(progress(overlay)).toBe('Stop 2 of 8')
  })

  it('runs the whole script to the end and ends itself', async () => {
    vi.useFakeTimers()
    setReducedMotion(true) // jumps, short holds, no closing orbit — deterministic
    const overlay = makeOverlay()
    const { map, api } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(api.jumpTo).toHaveBeenCalledTimes(8)
    expect(api.flyTo).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(overlay.hidden).toBe(true)
    expect(overlay.childElementCount).toBe(0)
  })
})

describe('leaving', () => {
  it('Escape, the Done button and stopTour() all cancel once and clean up', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, listenerCount } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(overlay.hidden).toBe(true)
    expect(overlay.classList.contains('is-playing')).toBe(false)
    expect(overlay.dataset.stop).toBeUndefined()
    // No zombie map listener left firing into a torn-down overlay.
    expect(listenerCount('moveend')).toBe(0)

    // Already stopped: no double callback, and a redundant stop is a no-op.
    stopTour()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('the Done button ends the tour', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    overlay.querySelector<HTMLButtonElement>('[data-testid="tour-stop"]')!.click()

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(overlay.hidden).toBe(true)
  })

  it('Finish on the last stop ends the tour exactly once', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    for (let i = 0; i < TOUR_STOPS.length - 1; i++) tapScrim(overlay)
    expect(onEnd).not.toHaveBeenCalled()

    overlay.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')!.click()

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(overlay.hidden).toBe(true)
  })

  it('does not keep a stale run alive when restarted', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const first = vi.fn()
    const second = vi.fn()

    startTour(map, overlay, first)
    startTour(map, overlay, second)

    expect(first).toHaveBeenCalledTimes(1) // the old run was ended, exactly once
    expect(second).not.toHaveBeenCalled()
    expect(overlay.hidden).toBe(false)
    expect(progress(overlay)).toBe('Stop 1 of 8')
  })
})
