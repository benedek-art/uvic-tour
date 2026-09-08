/**
 * The MapLibre style object for "Warm Paper".
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
 * Colours are the locked tokens from `src/tokens.css` (docs/REDESIGN.md). They are
 * duplicated here as literals because MapLibre paints into a WebGL canvas and cannot read
 * CSS custom properties — this file is the one sanctioned place for colour literals, and
 * every literal below is a verbatim copy of a token. If a token changes, change it there
 * first, then mirror it here. Never invent a value that isn't in tokens.css.
 *
 * LIGHT THEME — WHERE THE DEPTH COMES FROM
 * ----------------------------------------
 * The old dark theme got depth for free: anything glowing read as near, anything dim read
 * as far. On warm paper there is no glow to spend, so the model is built out of *value*:
 * ground is the lightest plane, roofs step down from it, and walls step down again. All of
 * that separation is produced by the `light` rig below rather than by extra layers, because
 * MapLibre gives a `fill-extrusion` exactly one colour and then shades its faces.
 *
 * The relevant half of MapLibre's fill-extrusion vertex shader is:
 *
 *     directional = clamp(dot(faceNormal, lightPos), 0, 1)
 *     directional = mix(1 - intensity, max(1 - colorvalue + intensity, 1), directional)
 *     if (wall) directional *= clamp(..., mix(0.7, 0.98, 1 - intensity), 1)   // vertical gradient
 *     rgb = (color + 0.03) * directional
 *
 * Read off that: the shader can only ever *darken* the colour you give it. So the colour
 * set on the layer is effectively the **roof** colour — roofs face the light and come back
 * almost untouched — and the walls are what the rig drives down. Hence:
 *
 *   `fill-extrusion-color` = `--bldg`  ->  roofs land at ~`--bldg`
 *   the light rig           ->  sunlit walls land near `--bldg-edge`, shadow walls below it
 *
 * `--bldg-edge` is therefore expressed as the *edge* of the mass rather than painted onto a
 * second layer: a separate roof-cap layer would double the extrusion draw calls and force
 * the rise animation in `scene.ts` to drive four layers instead of two.
 *
 * Also note the `if (wall)` above: MapLibre's vertical gradient only touches faces with a
 * horizontal normal, so turning it ON darkens walls without ever dulling a roof. On a light
 * theme that is exactly the effect we want, so it is on for both building layers.
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

// --- palette (mirrors src/tokens.css — docs/REDESIGN.md §1) -------------------------------
/** `--void`. The paper the chrome sits on; the map ground is a half-step deeper than this. */
export const COLOR_VOID = '#F4F0E8'
/** `--ground`. The campus ground plane, and the lightest thing in the scene. */
export const COLOR_GROUND = '#EAE4D8'
/** `--bldg`. Ordinary buildings — read as the roof value; see the lighting note above. */
export const COLOR_BLDG = '#D9D1C3'
/** `--bldg-edge`. The value ordinary walls are lit down through. Kept for reference. */
export const COLOR_BLDG_EDGE = '#C7BEAD'
/** `--path`. Footpaths, drawn as fine lines rather than lit filaments. */
export const COLOR_PATH = '#D7CFC0'
/** `--gold` — terracotta. RESERVED: the student's own class buildings and nothing else. */
export const COLOR_GOLD = '#C0562F'

// --- the light rig -----------------------------------------------------------------------

/**
 * `anchor: 'viewport'` — the light is fixed to the *screen*, not to the campus.
 *
 * With `'map'` the sun is pinned to north, so spinning the campus swings the shadows around
 * and half the buildings fall into their dark side depending on which way the user happens
 * to be facing. On a light theme that costs legibility for a gimmick: the whole reason to
 * shade at all here is so a building reads as a solid. Fixing the light to the viewport
 * means every building is lit the same way at every bearing.
 */
export const LIGHT_ANCHOR = 'viewport'

/**
 * `[r, azimuth, polar]`.
 *   - `r` 1.15 — the vector length; it scales the dot product before it is clamped, so a
 *     little over 1 keeps roofs at full colour instead of slightly grey.
 *   - `azimuth` 205°. 0° is the top of the viewport and degrees run clockwise, so 180° is
 *     the bottom of the screen — the direction the camera is looking *from*.
 *   - `polar` 35° — 0° is straight overhead, 90° is the horizon. At 35° a roof (normal up)
 *     gets a dot of ~0.94 and a wall gets at most ~0.66, which is the roof-versus-wall
 *     separation the model is built on. Pushing this toward the horizon flattens the roofs;
 *     pulling it to 0 flattens the walls.
 *
 * The azimuth is the number that was wrong for a whole iteration, so it is worth spelling
 * out. 315° (upper-left) is the drafting convention and it looks like the obvious choice —
 * but at pitch 50 the only walls on screen are the ones facing the *viewer*, whose normals
 * point at ~180°. A light at 315° is 135° away from those, the dot product clamps to zero,
 * and every single visible wall lands on the shadow value: the campus renders as flat dark
 * stencils with pale lids, which is the light-theme version of a washed-out blob. Measured
 * off a screenshot, one wall tone accounted for 5.2% of the map and no lit tone appeared at
 * all.
 *
 * 205° sits just off the viewer's shoulder, which is what gives the visible faces a range
 * instead of a single tone:
 *
 *     face pointing down-screen (toward camera)   L* ~66   lit
 *     face pointing screen-left                   L* ~57   half
 *     face pointing screen-right                  L* ~49   shadow
 *
 * Three wall values plus the roof is what makes a box read as a box. Rotating this back
 * toward 270-315 costs all of it.
 */
export const LIGHT_POSITION: [number, number, number] = [1.15, 205, 35]

/**
 * How hard the rig bites. From the shader above, an unlit wall is multiplied by
 * `1 - intensity`, so this is really "how dark is the shadow side".
 *
 * 0.5 (the spec default) drove shadow walls down to roughly 40% luminance — on paper that
 * reads as dirt, not shade. 0.38 lands the four planes of the model at roughly:
 *
 *     ground  L* 90   (--ground, untouched)
 *     roof    L* 85   (~--bldg)
 *     lit wall L* 67
 *     shadow wall L* 50
 *
 * — a legible architectural stack that still leaves the page feeling calm.
 */
export const LIGHT_INTENSITY = 0.44

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

/**
 * Resting opacity of the footpath tracery.
 *
 * On the dark theme these were luminous filaments and 0.85 let them bloom. `--path` on
 * `--ground` is only about six L* apart, so any opacity taken off them here is contrast the
 * paths do not have to spare — they are drawn at full strength and kept fine instead.
 */
export const PATH_OPACITY = 1

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
    name: 'Warm Paper',

    // The rig every extrusion in this style is shaded by. See the block comment at the top
    // of the file for what each number buys.
    light: {
      anchor: LIGHT_ANCHOR,
      position: LIGHT_POSITION,
      intensity: LIGHT_INTENSITY,
      // `color` is deliberately left at its white default: the warmth in this scene should
      // come from the building colours, not from a tinted lamp laid over everything.
    },

    sources: {
      buildings: { type: 'geojson', data: buildings },
      paths: { type: 'geojson', data: paths },
    },
    layers: [
      // 1. The ground plane. The lightest surface in the scene, and a half-step deeper than
      //    the `--void` paper the cards and the top bar sit on, so the map reads as a
      //    surface laid on the page rather than as a hole cut out of it.
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': COLOR_GROUND },
      },

      // 2. Footpaths — fine drawn lines. The old style blurred these to make them glow;
      //    `line-blur: 0` is the whole difference between a lit filament and a pen line,
      //    and a pen line is what survives on paper. Widths are up a notch on the dark
      //    theme's because `--path` on `--ground` is a very quiet contrast and a hairline
      //    at zoom 14.8 would simply disappear.
      {
        id: LAYER_PATHS,
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOR_PATH,
          'line-opacity': PATH_OPACITY,
          'line-blur': 0,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 15, 1.4, 18, 3],
        },
      },

      // 3. Every ordinary building. Starts at height 0 — `playRiseAnimation` ramps it up.
      //    Opaque: at 0.92 the ground showed through the walls and the shading the light rig
      //    works so hard for got washed straight back out.
      {
        id: LAYER_BUILDINGS,
        type: 'fill-extrusion',
        source: 'buildings',
        filter: ordinaryFilter([]),
        paint: {
          'fill-extrusion-color': COLOR_BLDG,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-base': 0,
          'fill-extrusion-height': riseHeightExpression(0),
        },
      },

      // 4. The three class buildings. Terracotta — the one saturated thing on the whole
      //    page, and the only reason the user can find their class at a glance. Shaded by
      //    the same rig as everything else (the dark theme flat-lit these to make them glow;
      //    on paper a flat patch of colour reads as a sticker, and a shaded solid reads as
      //    a building). Terracotta against beige carries the hierarchy on hue alone.
      {
        id: LAYER_HERO,
        type: 'fill-extrusion',
        source: 'buildings',
        filter: heroFilter([]),
        paint: {
          'fill-extrusion-color': COLOR_GOLD,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-base': 0,
          'fill-extrusion-height': riseHeightExpression(0),
        },
      },

      // --- space above this line is reserved for `route` and marker layers. ---
    ],
  }

  return style as StyleSpecification
}
