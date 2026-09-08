/**
 * The walking route, drawn (SPEC §5.4).
 *
 * `route()` in `src/core/router.ts` does the thinking — A* over the baked footpath graph,
 * zero network calls. This module only paints the answer: a gold line that draws itself on
 * over 700 ms, with a second dashed layer flowing toward the destination so the line reads
 * as a direction of travel rather than a static squiggle.
 *
 * Two layers, not one, because MapLibre will not let a single line layer carry both a
 * `line-gradient` (how the draw-on works) and a `line-dasharray` (how the flow works).
 *
 * Contracts worth not breaking:
 *   - `showRoute` takes `[lat, lon]`, matching `route()`. `Route.coords` come back as
 *     `[lon, lat]` in GeoJSON order and are handed to MapLibre untouched.
 *   - Calling `showRoute` twice updates the existing source; it never stacks duplicates.
 *   - Under `prefers-reduced-motion` the line appears complete and nothing animates —
 *     no rAF loop is started at all.
 */

// Aliased: a bare `import type { Map }` would shadow the global `Map` constructor.
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import { route } from '../core/router'

/**
 * A MapLibre style expression. Structurally this is the style spec's
 * `ExpressionSpecification`, which MapLibre 6 does not export from its entry point.
 */
type Expression = (string | number | Expression)[]

/**
 * `setPaintProperty` is generic over the property *name*, so its value type is resolved
 * per property and a locally-built expression array can't be handed to it directly.
 * The one assertion this costs lives here rather than at each of the three call sites.
 */
function setGradient(map: MapLibreMap, layer: string, value: Expression): void {
  // Widened in place rather than pulled out into a local: `setPaintProperty` is a
  // prototype method that reads `this`, so calling a detached reference throws.
  const target = map as unknown as {
    setPaintProperty(l: string, p: string, v: unknown): unknown
  }
  target.setPaintProperty(layer, 'line-gradient', value)
}

const SOURCE_ID = 'route'
const LINE_LAYER = 'route-line'
const DASH_LAYER = 'route-dash'

/** `--route` from src/tokens.css. WebGL can't read CSS custom properties. */
// Terracotta, matching --route in tokens.css. The old '#FFD873' was dark-theme gold
// and all but vanished on the warm paper ground.
const COLOR_ROUTE = '#C0562F'
const TRANSPARENT = 'rgba(255, 216, 115, 0)'

/** SPEC §4 Motion: "Line draws on over 700 ms, then dashes flow continuously." */
const DRAW_MS = 700
/** One dash pattern per ~55 ms reads as flow rather than strobe. */
const DASH_FRAME_MS = 55

/**
 * `line-dasharray` takes no offset, so the flowing effect is faked the way MapLibre's own
 * example does it: cycle through patterns whose dash and gap lengths shift the visible
 * segments one step forward each time.
 */
const DASH_STEPS: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
]

type EmptyFC = { type: 'FeatureCollection'; features: [] }
type RouteFC = {
  type: 'FeatureCollection'
  features: [{ type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } }]
}

function featureCollection(coords: [number, number][]): RouteFC {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    ],
  }
}

const EMPTY: EmptyFC = { type: 'FeatureCollection', features: [] }

let rafId: number | null = null

function stopLoop(): void {
  if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
  rafId = null
}

function prefersReducedMotion(): boolean {
  if (typeof matchMedia === 'undefined') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** A gradient that paints the whole line — i.e. the finished state. */
function solidGradient(): Expression {
  return ['interpolate', ['linear'], ['line-progress'], 0, COLOR_ROUTE, 1, COLOR_ROUTE]
}

/**
 * A gradient painted up to `t` and transparent after it, which is what makes the line
 * appear to draw itself.
 *
 * MapLibre requires `interpolate` stops to be strictly ascending, so `t` is clamped well
 * clear of both ends and the transparent stop is placed a fixed step beyond it.
 */
function partialGradient(t: number): Expression {
  const head = Math.min(0.975, Math.max(0.005, t))
  const tail = head + 0.02
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    COLOR_ROUTE,
    head,
    COLOR_ROUTE,
    tail,
    TRANSPARENT,
    1,
    TRANSPARENT,
  ]
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * Create the source and both layers if they aren't there yet.
 *
 * `addLayer` with no `beforeId` appends to the top of the stack, which puts the route above
 * `background` / `paths` / `buildings-3d` / `buildings-hero` from `style.ts` — the ordering
 * SPEC requires. Every call is guarded by an existence check, so a missing or renamed
 * layer id can never throw.
 */
function ensureLayers(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      // Required by `line-gradient`: without it MapLibre has no `line-progress` to read.
      lineMetrics: true,
      data: EMPTY,
    })
  }

  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        // ~3.5 at the zoom a route is read at, scaled up so it stays legible close in.
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 16, 3.5, 19, 7],
        'line-blur': 0.4,
        'line-opacity': 0.95,
      },
    })
    setGradient(map, LINE_LAYER, solidGradient())
  }

  if (!map.getLayer(DASH_LAYER)) {
    map.addLayer({
      id: DASH_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        // Paper-coloured dashes read as gaps in the terracotta line on a light ground.
        'line-color': '#F4F0E8',
        'line-opacity': 0.55,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 1.8, 19, 3.4],
        'line-dasharray': DASH_STEPS[0]!,
      },
    })
  }
}

/**
 * Draw the walking route between two `[lat, lon]` points and return its cost.
 *
 * Returns null when the router can't connect the two — the baked graph is a single
 * connected component, so in practice that only happens for coordinates off campus.
 * The distance/duration are computed before any map work, so a caller still gets a real
 * answer even if the style isn't ready yet and the paint is deferred.
 */
export function showRoute(
  map: MapLibreMap,
  from: [number, number],
  to: [number, number],
): { metres: number; minutes: number } | null {
  const result = route(from, to)
  if (!result || result.coords.length < 2) return null

  const draw = (): void => {
    ensureLayers(map)

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (!source) return
    // Idempotent: an existing route is replaced, never stacked.
    source.setData(featureCollection(result.coords))

    stopLoop()

    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setGradient(map, LINE_LAYER, solidGradient())
      map.setPaintProperty(DASH_LAYER, 'line-opacity', 0.55)
      map.setPaintProperty(DASH_LAYER, 'line-dasharray', DASH_STEPS[0]!)
      return
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let lastStep = -1

    const frame = (): void => {
      // The layers can disappear underneath us if clearRoute or a style reload lands
      // mid-flight; bail rather than throw.
      if (!map.getLayer(LINE_LAYER) || !map.getLayer(DASH_LAYER)) {
        rafId = null
        return
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const elapsed = now - t0
      const p = Math.min(1, elapsed / DRAW_MS)
      const eased = easeOutCubic(p)

      setGradient(map, LINE_LAYER, p >= 1 ? solidGradient() : partialGradient(eased))
      // The dashes fade in with the draw, then stay.
      map.setPaintProperty(DASH_LAYER, 'line-opacity', 0.55 * eased)

      // Flow toward the destination, forever, at a rate independent of frame rate.
      const step = Math.floor(elapsed / DASH_FRAME_MS) % DASH_STEPS.length
      if (step !== lastStep) {
        lastStep = step
        map.setPaintProperty(DASH_LAYER, 'line-dasharray', DASH_STEPS[step]!)
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
  }

  // `addSource` throws if the style hasn't landed yet, so defer instead of blowing up.
  // Both events are waited on, guarded to fire the draw once: `load` covers the ordinary
  // cold-start case, and `idle` covers the one that would otherwise hang forever — `load`
  // having already fired while a source is still settling, which leaves `isStyleLoaded()`
  // false and a `once('load')` listener waiting for an event that will never come again.
  if (map.isStyleLoaded()) {
    draw()
  } else {
    let drawn = false
    const drawOnce = (): void => {
      if (drawn) return
      drawn = true
      draw()
    }
    map.once('load', drawOnce)
    map.once('idle', drawOnce)
  }

  return { metres: result.metres, minutes: result.minutes }
}

/** Remove the route and stop the flow loop. Safe to call when nothing is drawn. */
export function clearRoute(map: MapLibreMap): void {
  stopLoop()
  for (const id of [DASH_LAYER, LINE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}
