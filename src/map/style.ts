/**
 * The MapLibre style object for "Night Campus".
 *
 * ARCHITECTURAL RULE — READ BEFORE EDITING
 * ----------------------------------------
 * This style renders **zero raster tiles**. There is no basemap, no tile server, no API
 * key, and no `glyphs` URL. Every visible pixel comes from our own committed GeoJSON in
 * `src/data/generated/`. That is what makes the app offline-capable and what gives us
 * total art direction.
 *
 * Two consequences worth spelling out:
 *   1. Adding a `raster` source breaks offline mode and the look. Don't.
 *   2. There are no `symbol`/text layers, because those require a glyph server (a network
 *      fetch). All labels in this app are HTML DOM markers instead.
 *
 * Colours are the locked tokens from `src/tokens.css` (SPEC §4). They are duplicated here
 * as literals because MapLibre paints into a WebGL canvas and cannot read CSS custom
 * properties. If a token changes, change it there first, then mirror it here.
 */

import type { MapOptions } from 'maplibre-gl'
import meta from '../data/generated/meta.json'

/**
 * `maplibregl.StyleSpecification`. MapLibre 6 does not re-export the style-spec types from
 * its own entry point, so we recover the exact same type from the public `MapOptions`.
 */
export type StyleSpecification = Exclude<NonNullable<MapOptions['style']>, string>

/** [lon, lat] — campus centre, straight from the baked `meta.json`. */
export const CAMPUS_CENTER: [number, number] = [meta.center[0] as number, meta.center[1] as number]

/** [west, south, east, north] — the Overpass query bbox the campus data was baked from. */
export const CAMPUS_BBOX: [number, number, number, number] = [
  meta.bbox[0] as number,
  meta.bbox[1] as number,
  meta.bbox[2] as number,
  meta.bbox[3] as number,
]

// --- palette (mirrors src/tokens.css — SPEC §4) ------------------------------------------
export const COLOR_VOID = '#05070E'
export const COLOR_BLDG = '#18213A'
export const COLOR_PATH = '#1E2E4D'
/** RESERVED: the student's own class buildings and nothing else. */
export const COLOR_GOLD = '#FFB627'

// --- art direction knobs -----------------------------------------------------------------

/**
 * Vertical exaggeration. The whole campus has to fit a 390px-wide phone screen, which puts
 * us around zoom 14.8 — where a real 8 m building is barely two pixels tall and the scene
 * reads as flat. Multiplying every height by this constant turns it back into a legible
 * architectural model. It scales all buildings equally, so relative heights stay truthful.
 */
export const HEIGHT_SCALE = 3.2

/** Rise animation shaping. `riseDelay` (0..1 = distance from campus centre) staggers the ripple. */
export const RISE_STAGGER = 0.45
export const RISE_SPAN = 0.55

/** Resting opacity of the ambient footpath tracery. */
export const PATH_OPACITY = 0.85

export const LAYER_BUILDINGS = 'buildings-3d'
export const LAYER_HERO = 'buildings-hero'
export const LAYER_PATHS = 'paths'

/**
 * The data-driven `fill-extrusion-height` expression at a given animation position.
 *
 * MapLibre re-evaluates a paint expression every time the property is set, so the rise is
 * animated by re-setting this each frame with a scalar `t` going 0 -> 1. Each building's
 * own `riseDelay` shifts when its slice of the ramp begins, which makes the rise ripple
 * outward from the campus centre instead of everything popping up at once.
 *
 * Returned as `unknown[]` because the caller casts it at the single `setPaintProperty`
 * boundary in `scene.ts`.
 */
export function riseHeightExpression(t: number): unknown[] {
  return [
    '*',
    ['*', ['get', 'height'], HEIGHT_SCALE],
    ['max', 0, ['min', 1, ['/', ['-', t, ['*', ['get', 'riseDelay'], RISE_STAGGER]], RISE_SPAN]]],
  ]
}

/** Filter matching exactly the named hero buildings. */
export function heroFilter(names: readonly string[]): unknown[] {
  return ['in', ['get', 'name'], ['literal', [...names]]]
}

/** Filter matching everything that is *not* a hero building (keeps the two layers disjoint). */
export function ordinaryFilter(names: readonly string[]): unknown[] {
  return ['!', heroFilter(names)]
}

/**
 * Build the complete style.
 *
 * Layer order, bottom -> top:
 *   background -> paths -> buildings-3d -> buildings-hero
 * The top of the stack is deliberately left free: the route layer and DOM markers are
 * added above `buildings-hero` by other modules.
 *
 * `buildings` / `paths` are typed `unknown` so this module never has to depend on a
 * GeoJSON type package; MapLibre accepts the parsed FeatureCollections directly.
 */
export function campusStyle(buildings: unknown, paths: unknown): StyleSpecification {
  const style = {
    version: 8,
    // No `glyphs` and no `sprite`: no symbol layers, therefore no network fetch. See header.
    name: 'Night Campus',
    sources: {
      buildings: { type: 'geojson', data: buildings },
      paths: { type: 'geojson', data: paths },
    },
    layers: [
      // 1. The void the campus floats in.
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': COLOR_VOID },
      },

      // 2. Footpaths — thin luminous traces. `line-blur` is what makes them read as lit
      //    filaments rather than hairlines.
      {
        id: LAYER_PATHS,
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOR_PATH,
          'line-opacity': PATH_OPACITY,
          'line-blur': 0.6,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1.1, 18, 2.4],
        },
      },

      // 3. Every ordinary building. Starts at height 0 — `playRiseAnimation` ramps it up.
      //    `fill-extrusion-vertical-gradient` darkens the walls automatically, which is
      //    where the sense of depth comes from without any lighting rig.
      {
        id: LAYER_BUILDINGS,
        type: 'fill-extrusion',
        source: 'buildings',
        filter: ordinaryFilter([]),
        paint: {
          'fill-extrusion-color': COLOR_BLDG,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-base': 0,
          'fill-extrusion-height': riseHeightExpression(0),
        },
      },

      // 4. The three class buildings. Gold, opaque, and deliberately flat-lit so they read
      //    as the brightest things on screen. Gold appears nowhere else in the app.
      {
        id: LAYER_HERO,
        type: 'fill-extrusion',
        source: 'buildings',
        filter: heroFilter([]),
        paint: {
          'fill-extrusion-color': COLOR_GOLD,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false,
          'fill-extrusion-base': 0,
          'fill-extrusion-height': riseHeightExpression(0),
        },
      },

      // --- space above this line is reserved for `route` and marker layers. ---
    ],
  }

  return style as StyleSpecification
}
