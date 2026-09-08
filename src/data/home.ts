/**
 * Home base — the residence the student actually wakes up in.
 *
 * Every other walk in this app is building-to-building between two classes. The walk
 * that decides whether they are late is the one *before* all of that: room to first
 * class, half asleep, in the dark, in November. This module is the one place that
 * knows where "home" is, so the rest of the UI can answer "when do I leave?" for the
 * first class of the day the same way it does for every later one.
 *
 * `HOME_BUILDING` must match the OSM `name` on the polygon in
 * `src/data/generated/buildings.geojson` exactly — that string is the only link
 * between this module and the campus geometry, and a typo degrades silently to
 * `null` rather than throwing. `tests/unit/home.test.ts` guards it.
 *
 * Coordinate convention (the classic bug in this codebase): GeoJSON vertices are
 * `[lon, lat]`, while `route()` takes `[lat, lon]`. We never do that flip here —
 * `buildingCentroid()` in src/core/transitions.ts already does it once, correctly,
 * and is tested. Reuse it.
 */

import { route } from '../core/router'
import { buildingCentroid } from '../core/transitions'

/** OSM `name` of the residence building. Exact string, verified against buildings.geojson. */
export const HOME_BUILDING = 'Roderick Haig-Brown'

/** What the UI calls it. "Roderick Haig-Brown" is nobody's word for where they sleep. */
export const HOME_LABEL = 'Home'

/** Home's centroid as `[lat, lon]`, or null if the polygon ever goes missing. */
export function homeCentroid(): [number, number] | null {
  return buildingCentroid(HOME_BUILDING)
}

export interface HomeWalk {
  metres: number
  minutes: number
}

/**
 * Memoised so A* never re-runs on a render. `null` is a cached answer too — an
 * unknown building name should cost one lookup, not one per frame — so membership is
 * tested with `has()` rather than an `undefined` check.
 */
const walkCache = new Map<string, HomeWalk | null>()

/**
 * Walking distance and duration from home to a building, centroid to centroid.
 *
 * Returns null when either building is not in the baked geometry, or when the
 * footpath graph cannot connect them (it is one connected component, so in practice
 * only the first case happens).
 */
export function walkFromHome(building: string): HomeWalk | null {
  const cached = walkCache.get(building)
  if (cached !== undefined) return cached

  let result: HomeWalk | null = null
  const from = homeCentroid()
  const to = buildingCentroid(building)
  if (from && to) {
    const r = route(from, to)
    if (r) result = { metres: r.metres, minutes: r.minutes }
  }

  walkCache.set(building, result)
  return result
}
