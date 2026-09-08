// @vitest-environment jsdom
/**
 * Home base — the walk from Roderick Haig-Brown to the first class of the day.
 *
 * The whole feature rests on one string matching one OSM `name`, and on the
 * `[lat, lon]` / `[lon, lat]` flip being done exactly once. Both failures are silent:
 * a bad name yields `null`, a swapped pair yields a route across the Pacific. So these
 * tests pin the centroid inside the campus bounding box and cap every walk at 20
 * minutes — UVic's main campus is about a kilometre across, so anything longer is a
 * coordinate bug, not a long walk.
 *
 * The DOM half is deliberately shallow and mounts the two cards directly rather than
 * the whole sheet: it checks that the home line appears for a first class, does *not*
 * appear for a later one (the building-to-building path must not regress), and that
 * the detail card's button reports a distance and calls back.
 */
import { describe, it, expect, vi } from 'vitest'
import { HOME_BUILDING, HOME_LABEL, homeCentroid, walkFromHome } from '../../src/data/home'
import { COURSES } from '../../src/data/schedule'
import { createStore } from '../../src/ui/store'
import { createDetail } from '../../src/ui/detail-card'
import { WEEK, createNowNext, homeWalkLine, isFirstOfDay } from '../../src/ui/now-next'
import type { AppState } from '../../src/ui/sheet'

/** Main campus (Gordon Head), generously padded. */
const LAT_MIN = 48.4585
const LAT_MAX = 48.47
const LON_MIN = -123.32
const LON_MAX = -123.302

const CLASS_BUILDINGS = [...new Set(COURSES.map((c) => c.building))]

function stateAt(now: Date): AppState {
  return {
    now,
    selected: null,
    scrubMinutes: null,
    scrubDay: 'Mon',
    layers: { pois: true, paths: true },
    tourPlaying: false,
  }
}

describe('home base', () => {
  it('names the residence exactly as OpenStreetMap does', () => {
    expect(HOME_BUILDING).toBe('Roderick Haig-Brown')
    expect(HOME_LABEL).toBe('Home')
  })

  it('resolves to a real centroid inside the campus bbox', () => {
    const home = homeCentroid()
    expect(home).not.toBeNull()
    const [lat, lon] = home!
    expect(lat).toBeGreaterThanOrEqual(LAT_MIN)
    expect(lat).toBeLessThanOrEqual(LAT_MAX)
    expect(lon).toBeGreaterThanOrEqual(LON_MIN)
    expect(lon).toBeLessThanOrEqual(LON_MAX)
  })

  it('covers all three class buildings', () => {
    expect(CLASS_BUILDINGS).toHaveLength(3)
  })

  it.each(CLASS_BUILDINGS)('walks to %s in a sane distance and time', (building) => {
    const walk = walkFromHome(building)
    expect(walk).not.toBeNull()
    expect(walk!.metres).toBeGreaterThan(0)
    expect(walk!.minutes).toBeGreaterThan(0)
    expect(walk!.minutes).toBeLessThan(20)
  })

  it('returns null for a building that is not on campus', () => {
    expect(walkFromHome('Hogwarts School of Witchcraft and Wizardry')).toBeNull()
  })

  it('memoises repeat lookups, misses included', () => {
    const first = walkFromHome(CLASS_BUILDINGS[0]!)
    expect(walkFromHome(CLASS_BUILDINGS[0]!)).toBe(first)
    expect(walkFromHome('Nowhere Hall')).toBeNull()
    expect(walkFromHome('Nowhere Hall')).toBeNull()
  })
})

describe('homeWalkLine', () => {
  it('describes the walk for the first class of a day', () => {
    const first = WEEK.Mon[0]!
    expect(isFirstOfDay(first)).toBe(true)
    const line = homeWalkLine(first)!
    expect(line).toMatch(/^\d+ min from home · leave by \d{2}:\d{2}$/)
  })

  it('leaves later classes to the building-to-building logic', () => {
    const second = WEEK.Mon[1]!
    expect(isFirstOfDay(second)).toBe(false)
    expect(homeWalkLine(second)).toBeNull()
  })
})

describe('Now/Next card', () => {
  it('shows the walk from home before the first class of the day', () => {
    const view = createNowNext({ store: createStore(stateAt(new Date())), onSelect: () => {} })
    // Mon 07:00 — up early, BIOL 184 at 08:30 is the first class of the day.
    view.update(stateAt(new Date('2026-09-14T07:00:00-07:00')), true)

    const line = view.el.querySelector('[data-testid="home-walk"]')
    expect(line).not.toBeNull()
    expect((line as HTMLElement).hidden).toBe(false)
    expect(line!.textContent).toContain('from home')
    expect(line!.textContent).toContain('leave by')
  })

  it('does not claim a walk from home once the day has started', () => {
    const view = createNowNext({ store: createStore(stateAt(new Date())), onSelect: () => {} })
    // Mon 16:00 — PSYC 100B is next, but BIOL 184 already happened, so the walk
    // that matters is Bob Wright -> MacLaurin.
    view.update(stateAt(new Date('2026-09-14T16:00:00-07:00')), true)

    expect(view.el.querySelector('[data-testid="home-walk"]')).toBeNull()
    expect(view.el.textContent).toContain('min walk')
  })

  it('never shows two home-walk elements after re-rendering', () => {
    const view = createNowNext({ store: createStore(stateAt(new Date())), onSelect: () => {} })
    view.update(stateAt(new Date('2026-09-14T07:00:00-07:00')), true)
    view.update(stateAt(new Date('2026-09-14T16:00:00-07:00')), true)
    view.update(stateAt(new Date('2026-09-14T07:00:00-07:00')), true)
    expect(view.el.querySelectorAll('[data-testid="home-walk"]')).toHaveLength(1)
  })
})

describe('detail card', () => {
  function mountDetail(session: AppState['selected']) {
    const onRouteFromHome = vi.fn()
    const state = { ...stateAt(new Date('2026-09-14T07:00:00-07:00')), selected: session }
    const view = createDetail({
      store: createStore(state),
      onSelect: () => {},
      onRoute: () => {},
      onRouteFromHome,
    })
    view.update(state)
    return { view, onRouteFromHome }
  }

  it('offers a route from home for every class', () => {
    for (const session of WEEK.Wed) {
      const { view } = mountDetail(session)
      const button = view.el.querySelector('[data-testid="route-from-home-btn"]')
      expect(button, session.course.code).not.toBeNull()
      expect(button!.textContent).toBe('Walk from home')   // plain-language rename in the redesign
    }
  })

  it('reports the distance and hands the walk to the orchestrator', () => {
    const session = WEEK.Mon[0]!
    const { view, onRouteFromHome } = mountDetail(session)
    const button = view.el.querySelector('[data-testid="route-from-home-btn"]') as HTMLButtonElement
    button.click()

    expect(onRouteFromHome).toHaveBeenCalledWith(session)
    const summary = view.el.querySelector('[data-testid="route-summary"]')!
    expect(summary.textContent).toMatch(/^\d+ m · \d+ min from home$/)
  })

  it('still renders without the optional callback wired', () => {
    const session = WEEK.Mon[0]!
    const state = { ...stateAt(new Date('2026-09-14T07:00:00-07:00')), selected: session }
    const view = createDetail({ store: createStore(state), onSelect: () => {}, onRoute: () => {} })
    view.update(state)
    const button = view.el.querySelector('[data-testid="route-from-home-btn"]') as HTMLButtonElement
    expect(() => button.click()).not.toThrow()
  })
})
