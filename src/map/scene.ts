/**
 * The map scene: creates the MapLibre map, frames the campus, and plays the load
 * animation — buildings rising out of darkness in a ripple from the campus centre.
 *
 * Nothing in here touches the network. The two GeoJSON files are bundled at build time
 * (see the `geojson-as-json` plugin in `vite.config.ts`).
 */

import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
// @ts-ignore -- CSS side-effect import; see note in main.ts.
import 'maplibre-gl/dist/maplibre-gl.css'
// @ts-ignore -- Vite `?worker&url` import; `vite/client` types are not in tsconfig's `types` array.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import buildingsData from '../data/generated/buildings.geojson'
// @ts-ignore -- paths.geojson has no sibling .d.ts (buildings.geojson does). The Vite
// `geojson-as-json` plugin supplies the parsed FeatureCollection at runtime.
import pathsData from '../data/generated/paths.geojson'

import {
  CAMPUS_BBOX,
  CAMPUS_CENTER,
  LAYER_BUILDINGS,
  LAYER_HERO,
  LAYER_PATHS,
  PATH_OPACITY,
  campusStyle,
  heroFilter,
  ordinaryFilter,
  riseHeightExpression,
} from './style'

/**
 * MapLibre 6 ships its GeoJSON/tile worker as a bare ESM file that imports a sibling
 * chunk, and locates it with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`.
 * Neither half of that survives Vite:
 *   - in dev, pre-bundling rewrites the URL to `/node_modules/.vite/deps/
 *     maplibre-gl-worker.mjs`, which does not exist;
 *   - in a production build, the raw worker is copied into `assets/` but its
 *     `./maplibre-gl-shared.mjs` import is not emitted alongside it.
 * Either way the worker never starts, no source ever finishes loading, the `load` event
 * never fires, and the map sits on a black screen forever with no console error.
 *
 * `?worker&url` makes Vite bundle the worker properly and hand back a URL that is correct
 * in both dev and prod. It also means the worker lands in `dist/assets/*.js`, which the
 * PWA precache glob already covers — so it works offline too.
 */
setWorkerUrl(maplibreWorkerUrl as string)

// --- camera constants --------------------------------------------------------------------

/** SPEC §4: an illuminated model seen from a low oblique angle, not a top-down map. */
export const INITIAL_PITCH = 50
export const INITIAL_BEARING = -18

/** Duration of the building rise, in ms (SPEC §4 motion table). */
export const RISE_MS = 1400

/** How far the camera pulls back / flattens before easing into the framed pose. */
const ENTRY_ZOOM_OFFSET = 0.45
const ENTRY_PITCH_OFFSET = 18

/**
 * `fitBounds` solves for a rectangle that fully contains the campus. At pitch 50 on a tall
 * portrait phone the campus reads as a wide, shallow band, so an exact fit leaves the model
 * marooned in the middle of the frame. These two numbers push it back up to something with
 * presence: a little more zoom, and a downward nudge that leaves headroom at the top and
 * keeps the campus clear of the bottom sheet that mounts later.
 * Both were tuned against screenshots at 390x844.
 */
const FRAME_ZOOM_BOOST = 0.35
const FRAME_PAN_Y = 20

const MIN_ZOOM = 13.3
const MAX_ZOOM = 18.5
const MAX_PITCH = 70

/** Generous slack around the baked bbox so a stray swipe can't fling the user into the Pacific. */
const BOUNDS_PAD_LON = 0.016
const BOUNDS_PAD_LAT = 0.009

type Camera = { center: [number, number]; zoom: number; pitch: number; bearing: number }

/** The framed "home" pose, computed once per map from the real building extent. */
const homeCamera = new WeakMap<MapLibreMap, Camera>()
/** Guards against a second caller re-triggering the load animation. */
const risePlayed = new WeakSet<MapLibreMap>()

// --- small helpers -----------------------------------------------------------------------

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

/**
 * The one place we cast into MapLibre's paint-property types. The style spec accepts
 * expression arrays here, but the generated `.d.ts` types them as a closed union that a
 * freshly-built array literal will never structurally match.
 */
function setExtrusionHeight(map: MapLibreMap, layerId: string, expr: unknown): void {
  map.setPaintProperty(layerId, 'fill-extrusion-height', expr as never)
}

function setLineOpacity(map: MapLibreMap, layerId: string, value: number): void {
  map.setPaintProperty(layerId, 'line-opacity', value as never)
}

function setLayerFilter(map: MapLibreMap, layerId: string, filter: unknown): void {
  map.setFilter(layerId, filter as never)
}

/** Apply one frame of the rise to both extrusion layers. */
function applyRise(map: MapLibreMap, t: number): void {
  if (!map.getLayer(LAYER_BUILDINGS)) return
  const expr = riseHeightExpression(t)
  setExtrusionHeight(map, LAYER_BUILDINGS, expr)
  setExtrusionHeight(map, LAYER_HERO, expr)
}

/** True extent of the committed building polygons — more honest than the query bbox. */
function buildingExtent(): [[number, number], [number, number]] {
  let w = 180
  let s = 90
  let e = -180
  let n = -90
  for (const f of buildingsData.features) {
    for (const ring of f.geometry.coordinates) {
      for (const pt of ring) {
        const lon = pt[0]
        const lat = pt[1]
        if (lon < w) w = lon
        if (lon > e) e = lon
        if (lat < s) s = lat
        if (lat > n) n = lat
      }
    }
  }
  return [
    [w, s],
    [e, n],
  ]
}

/**
 * Frame the whole campus for the current viewport. Authored for a 390x844 phone: we let
 * MapLibre solve the zoom from the real extent rather than hardcoding one, so the same
 * call is correct on a phone and on a desktop.
 */
function computeHomeCamera(map: MapLibreMap): Camera {
  // Solve the fit flat (pitch 0). Asking `fitBounds` to solve it *at* 50 degrees makes it
  // fit the bounds inside the pitched trapezoid, which throws away roughly a zoom level
  // and leaves the campus as a postage stamp in the middle of the screen.
  map.fitBounds(buildingExtent(), {
    padding: { top: 12, bottom: 12, left: 12, right: 12 },
    pitch: 0,
    bearing: INITIAL_BEARING,
    maxZoom: 17,
    duration: 0,
  })

  const c = map.getCenter()
  const center: [number, number] = [c.lng, c.lat]
  const zoom = map.getZoom() + FRAME_ZOOM_BOOST

  // Apply the pitch, then nudge so the model sits with headroom above and breathing room
  // below rather than pinned dead-centre.
  map.jumpTo({ center, zoom, pitch: INITIAL_PITCH, bearing: INITIAL_BEARING })
  map.panBy([0, FRAME_PAN_Y], { duration: 0 })
  const c2 = map.getCenter()

  return {
    center: [c2.lng, c2.lat],
    zoom,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
  }
}

// --- public API --------------------------------------------------------------------------

/**
 * Create the map, mount it into `container`, and resolve once the style and both GeoJSON
 * sources are loaded. Buildings are flat (height 0) on resolve — call
 * `playRiseAnimation` to lift them — unless the viewer has asked for reduced motion, in
 * which case the scene is already at its final state.
 */
export async function initScene(container: HTMLElement): Promise<MapLibreMap> {
  const [west, south, east, north] = CAMPUS_BBOX

  const map = new MapLibreMap({
    container,
    style: campusStyle(buildingsData, pathsData),
    center: CAMPUS_CENTER,
    zoom: 14.4,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    maxPitch: MAX_PITCH,
    maxBounds: [
      [west - BOUNDS_PAD_LON, south - BOUNDS_PAD_LAT],
      [east + BOUNDS_PAD_LON, north + BOUNDS_PAD_LAT],
    ],
    // We render no third-party tiles, so there is nothing to attribute and no logo to show.
    attributionControl: false,
    maplibreLogo: false,
    // MapLibre owns every touch gesture; we never call preventDefault on the container.
    dragRotate: true,
    dragPan: true,
    pitchWithRotate: true,
    touchZoomRotate: true,
    touchPitch: true,
    canvasContextAttributes: { antialias: true },
    fadeDuration: 0,
  })

  await new Promise<void>((resolve) => {
    if (map.loaded()) {
      resolve()
      return
    }
    map.once('load', () => resolve())
  })

  const home = computeHomeCamera(map)
  homeCamera.set(map, home)

  if (prefersReducedMotion()) {
    // No entrance: land on the final pose with the buildings already up.
    map.jumpTo(home)
    applyRise(map, 1)
  } else {
    // Start pulled back and flatter so the rise has somewhere to travel to.
    map.jumpTo({
      center: home.center,
      zoom: Math.max(MIN_ZOOM, home.zoom - ENTRY_ZOOM_OFFSET),
      pitch: Math.max(0, home.pitch - ENTRY_PITCH_OFFSET),
      bearing: home.bearing,
    })
  }

  return map
}

/**
 * Paint exactly these buildings gold. Gold is reserved for the student's own class
 * buildings — passing anything else here breaks the one rule that makes the map readable.
 * Names must match the OpenStreetMap `name` property character-for-character.
 */
export function setHeroBuildings(map: MapLibreMap, names: string[]): void {
  if (!map.getLayer(LAYER_HERO)) return
  // The two extrusion layers are kept disjoint so identical geometry never z-fights.
  setLayerFilter(map, LAYER_HERO, heroFilter(names))
  setLayerFilter(map, LAYER_BUILDINGS, ordinaryFilter(names))
}

/**
 * The hero moment: buildings rise out of the dark in a ripple from the campus centre while
 * the camera settles into its framed pose and the footpaths fade up underneath.
 *
 * Resolves when the rise is finished. Safe to call more than once — subsequent calls
 * resolve immediately rather than restarting.
 */
export function playRiseAnimation(map: MapLibreMap): Promise<void> {
  if (risePlayed.has(map)) return Promise.resolve()
  risePlayed.add(map)

  const home = homeCamera.get(map)

  if (prefersReducedMotion()) {
    applyRise(map, 1)
    setLineOpacity(map, LAYER_PATHS, PATH_OPACITY)
    if (home) map.jumpTo(home)
    return Promise.resolve()
  }

  applyRise(map, 0)
  setLineOpacity(map, LAYER_PATHS, 0)

  if (home) {
    map.easeTo({
      center: home.center,
      zoom: home.zoom,
      pitch: home.pitch,
      bearing: home.bearing,
      duration: RISE_MS + 500,
      easing: easeOutCubic,
      essential: true,
    })
  }

  return new Promise<void>((resolve) => {
    const start = performance.now()
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / RISE_MS)
      applyRise(map, easeOutCubic(p))
      // Paths come up first and fast, so the buildings rise out of a lit ground plan.
      setLineOpacity(map, LAYER_PATHS, PATH_OPACITY * Math.max(0, Math.min(1, p / 0.4)))
      if (p < 1) {
        requestAnimationFrame(frame)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(frame)
  })
}
