// @vitest-environment jsdom
/**
 * Smoke test for cinematic tour mode (src/ui/tour.ts).
 *
 * Focused on the four things that would break silently and never show up in a
 * screenshot review:
 *
 *   1. The SCRIPT is right — eight stops, in the narrative order, every one of them
 *      carrying real copy and a camera pose that is actually on campus. A typo'd
 *      coordinate flies to the middle of the Pacific and looks like a black screen.
 *   2. The RUNNER cannot hang. `moveend` is not guaranteed to arrive, so the deadman
 *      timer is tested directly by never firing one.
 *   3. CANCELLING cleans up: `onEnd` fires exactly once and the overlay goes away.
 *   4. The launch button mounts and calls back.
 *
 * The map is a stub. Real camera behaviour belongs to the E2E suite; what matters here
 * is the sequencing logic, which is pure enough to test without WebGL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { TOUR_STOPS, mountTourButton, startTour, stopTour } from '../../src/ui/tour'

/** SPEC §3. Every pose in the script must land inside this box. */
const BBOX = { minLon: -123.32, maxLon: -123.302, minLat: 48.4585, maxLat: 48.47 }

/** The narrative from SPEC §5.8 / plan Task 13, in order. */
const EXPECTED_ORDER = [
  'You arrive here',
  'Bob Wright Centre',
  'MacLaurin Building',
  'Engineering / Computer Science',
  'CARSA',
  'McPherson Library',
  'The SUB',
  "That's the loop",
]

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

const cardCount = (overlay: HTMLElement): string =>
  overlay.querySelector('.tour__count')?.textContent ?? ''

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
  it('shows the first stop and flies there', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, api } = stubMap()

    startTour(map, overlay, () => {})

    expect(overlay.hidden).toBe(false)
    expect(overlay.querySelector('.tour__title')?.textContent).toBe(EXPECTED_ORDER[0])
    expect(cardCount(overlay)).toBe('1 / 8')
    expect(api.flyTo).toHaveBeenCalledTimes(1)
  })

  it('advances on the deadman timer when moveend never arrives', async () => {
    vi.useFakeTimers()
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()

    startTour(map, overlay, () => {})
    expect(cardCount(overlay)).toBe('1 / 8')

    // Never emit `moveend`. The flight deadman (7 s) plus the 4 s hold must still
    // carry the tour to stop 2 — a stalled tour is the worst possible failure here.
    await vi.advanceTimersByTimeAsync(11_500)
    expect(cardCount(overlay)).toBe('2 / 8')
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

  it('Escape, the scrim and stopTour() all cancel once and clean up', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map, listenerCount } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(overlay.hidden).toBe(true)
    expect(overlay.classList.contains('is-playing')).toBe(false)
    expect(listenerCount('dragstart')).toBe(0)

    // Already stopped: no double callback, and a redundant stop is a no-op.
    stopTour()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('the Stop button ends the tour', () => {
    setReducedMotion(false)
    const overlay = makeOverlay()
    const { map } = stubMap()
    const onEnd = vi.fn()

    startTour(map, overlay, onEnd)
    overlay.querySelector<HTMLButtonElement>('[data-testid="tour-stop"]')!.click()

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
    expect(cardCount(overlay)).toBe('1 / 8')
  })
})
