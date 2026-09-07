/**
 * Everything that floats above the campus as HTML: the room pin for the selected class,
 * and the cyan tour-stop markers.
 *
 * These are DOM markers (`maplibregl.Marker`), never MapLibre `symbol` layers. A symbol
 * layer needs a glyph server to render text, and a glyph server is a network fetch — which
 * would break the one hard promise this app makes (SPEC §5.10: works with no signal).
 * `style.ts` deliberately ships no `glyphs` URL for the same reason.
 *
 * Colour rule (SPEC §4): gold marks the student's own class buildings and nothing else.
 * The room pin is gold because that is exactly what it marks. POIs are cyan, always.
 */

import { Marker } from 'maplibre-gl'
// Aliased: a bare `import type { Map }` would shadow the global `Map` constructor.
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { POI } from '../data/pois'
import './map.css'

// --- room pin ----------------------------------------------------------------------------

let roomPin: Marker | null = null

/**
 * Drop the gold room pin, e.g. `D287`, above a building.
 *
 * `lonlat` is `[lon, lat]` — MapLibre's own order, because that is what every caller
 * already has from a camera target. Only one pin exists at a time: a second call moves it
 * rather than littering the map.
 *
 * The element carries `data-testid="room-pin"` and the room code as its text, which is
 * what the E2E suite asserts on.
 */
export function dropRoomPin(map: MapLibreMap, lonlat: [number, number], label: string): void {
  clearRoomPin(map)

  const el = document.createElement('div')
  el.className = 'room-pin'
  el.setAttribute('data-testid', 'room-pin')
  // Decorative twice over: the room code is already announced in the detail card, and the
  // pin can't be focused. Keeping it out of the a11y tree avoids a duplicate reading.
  el.setAttribute('aria-hidden', 'true')

  const chip = document.createElement('span')
  chip.className = 'room-pin__chip'
  chip.textContent = label

  const stem = document.createElement('span')
  stem.className = 'room-pin__stem'

  const dot = document.createElement('span')
  dot.className = 'room-pin__dot'

  el.append(chip, stem, dot)

  // `bottom` anchors the dot — the pointy end — on the coordinate.
  roomPin = new Marker({ element: el, anchor: 'bottom' }).setLngLat(lonlat).addTo(map)
}

/** Remove the room pin. Safe to call when there isn't one. */
export function clearRoomPin(_map: MapLibreMap): void {
  roomPin?.remove()
  roomPin = null
}

// --- tour stops --------------------------------------------------------------------------

interface POIMarker {
  poi: POI
  marker: Marker
}

let poiMarkers: POIMarker[] = []
let poiMap: MapLibreMap | null = null
let poisVisible = true

/**
 * Render one cyan marker per tour stop.
 *
 * Idempotent: any previous set is torn down first, so calling this again after the POI list
 * changes replaces the markers instead of stacking a second copy on top of the first.
 *
 * `onSelect` fires on tap. The caller decides what that means — flying the camera and
 * opening the stop's card (SPEC §5.6).
 */
export function renderPOIs(map: MapLibreMap, pois: POI[], onSelect: (p: POI) => void): void {
  for (const m of poiMarkers) m.marker.remove()
  poiMarkers = []
  poiMap = map

  for (const poi of pois) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'poi-marker'
    el.setAttribute('data-testid', 'poi-marker')
    el.setAttribute('data-poi-id', poi.id)
    el.setAttribute('data-poi-category', poi.category)
    // The visible dot is 11px; the button around it is a full 44px tap target.
    el.setAttribute('aria-label', `${poi.name} — tour stop`)
    el.title = poi.name

    const dot = document.createElement('span')
    dot.className = 'poi-marker__dot'
    el.append(dot)

    el.addEventListener('click', (ev) => {
      // Without this the click also reaches the map canvas and deselects what we just
      // selected.
      ev.stopPropagation()
      onSelect(poi)
    })

    // POIs are point-like, so centre the dot on the coordinate rather than anchoring
    // it at the bottom the way the room pin does.
    const marker = new Marker({ element: el, anchor: 'center' }).setLngLat([poi.lon, poi.lat])
    if (poisVisible) marker.addTo(map)
    poiMarkers.push({ poi, marker })
  }
}

/**
 * Show or hide the whole tour-stop layer (SPEC §5.6 — it's toggleable).
 *
 * Markers are detached and re-attached rather than hidden with CSS: MapLibre owns the
 * inline styles on a marker element, so fighting it with a `display` rule is asking for a
 * version bump to break this quietly.
 *
 * Remembers the state, so a `renderPOIs` call while the layer is off stays off.
 */
export function setPOIsVisible(visible: boolean): void {
  poisVisible = visible
  if (!poiMap) return
  for (const { marker } of poiMarkers) {
    if (visible) marker.addTo(poiMap)
    else marker.remove()
  }
}
