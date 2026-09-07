// src/map/camera.ts
//
// Every named camera move in the app lives here: the cinematic arc to a class
// building (SPEC §4 Motion, §5.2), the campus overview, and the slow orbit used
// by the guided tour. Nothing else is allowed to call `flyTo` directly, so the
// motion vocabulary stays consistent — and so `prefers-reduced-motion` is
// honoured in exactly one place instead of a dozen.
//
// IMPORTANT: this module must stay importable in a plain Node process (the unit
// test has no DOM and no WebGL). MapLibre is therefore a *type-only* import and
// `buildingTarget` is pure — it computes centroids straight from the baked
// GeoJSON.

// Aliased so the global `Map` constructor stays usable as a value below.
import type { Map as MapLibreMap } from 'maplibre-gl'
import buildings from '../data/generated/buildings.geojson'

export interface CameraTarget {
  /** [lon, lat] */
  center: [number, number]
  zoom: number
  /** Degrees. Always within the 45..65 "architectural model" band from SPEC §4. */
  pitch: number
  bearing: number
}

/** SPEC §4: a deliberate arc, not a snap. ~1.8 s across campus. */
const FLY = { curve: 1.42, speed: 0.7, essential: true } as const

/** Close enough to read a room pin, far enough to keep neighbours for context. */
const BUILDING_ZOOM = 17.5
/** SPEC §5.2: "pitches to ~55°". */
const BUILDING_PITCH = 55
/** A slight three-quarter view reads as a model rather than a floor plan. */
const BUILDING_BEARING = -18

/** Overview framed for a 390 px-wide phone screen — mobile is the primary target. */
const CAMPUS_CENTER: [number, number] = [-123.308165, 48.464965]
const CAMPUS_ZOOM = 14.6
const CAMPUS_PITCH = 50
const CAMPUS_BEARING = -18

export const CAMPUS_TARGET: CameraTarget = {
  center: CAMPUS_CENTER,
  zoom: CAMPUS_ZOOM,
  pitch: CAMPUS_PITCH,
  bearing: CAMPUS_BEARING,
}

function prefersReducedMotion(): boolean {
  if (typeof matchMedia === 'undefined') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Average of a closed ring's distinct vertices. Plenty accurate at campus scale. */
function ringCentroid(ring: readonly (readonly [number, number])[]): [number, number] | null {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!first || !last) return null
  // GeoJSON rings repeat the first vertex at the end; don't double-weight it.
  const n = ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.length - 1 : ring.length
  if (n < 1) return null
  let lon = 0
  let lat = 0
  for (let i = 0; i < n; i++) {
    const v = ring[i]
    if (!v) return null
    lon += v[0]
    lat += v[1]
  }
  return [lon / n, lat / n]
}

const centroidByName: ReadonlyMap<string, [number, number]> = (() => {
  const m = new Map<string, [number, number]>()
  for (const f of buildings.features) {
    const name = f.properties.name
    if (!name || m.has(name)) continue
    const outer = f.geometry.coordinates[0]
    if (!outer) continue
    const c = ringCentroid(outer)
    if (c) m.set(name, c)
  }
  return m
})()

/**
 * Pure: resolve an OSM building name to a camera pose. `null` when unknown, so
 * callers can fall back to the campus overview instead of flying nowhere.
 */
export function buildingTarget(name: string): CameraTarget | null {
  const center = centroidByName.get(name)
  if (!center) return null
  return {
    center: [center[0], center[1]],
    zoom: BUILDING_ZOOM,
    pitch: BUILDING_PITCH,
    bearing: BUILDING_BEARING,
  }
}

function move(map: MapLibreMap, target: CameraTarget): void {
  if (prefersReducedMotion()) {
    map.jumpTo(target)
    return
  }
  map.flyTo({ ...target, ...FLY })
}

/** Back to the whole campus, framed for a phone. */
export function frameCampus(map: MapLibreMap): void {
  move(map, CAMPUS_TARGET)
}

/** Arc to a named building. No-op when the name isn't in the baked data. */
export function flyToBuilding(map: MapLibreMap, name: string): void {
  const target = buildingTarget(name)
  if (!target) return
  move(map, target)
}

/** Arc to an arbitrary point, keeping the house pitch/bearing. */
export function flyToPoint(map: MapLibreMap, lonlat: [number, number], zoom = BUILDING_ZOOM): void {
  move(map, {
    center: [lonlat[0], lonlat[1]],
    zoom,
    pitch: BUILDING_PITCH,
    bearing: BUILDING_BEARING,
  })
}

/**
 * Slowly rotate a full 360° over `ms`, resolving when the turn completes.
 * Resolves immediately (with no motion) under reduced motion.
 */
export function orbit(map: MapLibreMap, ms: number): Promise<void> {
  if (ms <= 0 || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
    return Promise.resolve()
  }
  const start = map.getBearing()
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return new Promise<void>((resolve) => {
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const t = Math.min(1, (now - t0) / ms)
      map.setBearing(start + t * 360)
      if (t < 1) {
        requestAnimationFrame(step)
      } else {
        map.setBearing(start)
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}
