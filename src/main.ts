/**
 * Bootstrap and wiring.
 *
 * Every feature module is self-contained and was built in isolation; this file is the
 * single seam where they meet. Keep it declarative — logic belongs in the modules.
 */
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
import './style.css'
import './chrome.css'

// Offline. Precaches the whole bundle — map geometry, walk graph, MapLibre and its
// worker, the self-hosted fonts — so the app opens on campus with no signal.
// `autoUpdate` in vite.config.ts means a new build takes over on the next visit.
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })

import { COURSES, SCHEDULE_BUILDINGS, type Day } from './data/schedule'
import { POIS } from './data/pois'
import { HOME_BUILDING } from './data/home'
import { buildWeek, type Session } from './core/week'
import { dayOfDate } from './core/time'
import { buildingCentroid } from './core/transitions'

import { initScene, playRiseAnimation, setHeroBuildings } from './map/scene'
import { flyToBuilding, flyToPoint, frameCampus } from './map/camera'
import { showRoute, clearRoute } from './map/route-layer'
import { dropRoomPin, clearRoomPin, renderPOIs, setPOIsVisible } from './map/markers'

import { createStore } from './ui/store'
import { mountSheet, type AppState } from './ui/sheet'
import { mountScrubber } from './ui/scrubber'
import { mountLayerToggles } from './ui/layers'
import { mountTourButton, startTour, stopTour } from './ui/tour'
import { showPOICard, showBuildingCard, hidePlaceCard, mountLegend } from './ui/place-card'

const WEEK = buildWeek(COURSES)

function dismissBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('is-gone')
  window.setTimeout(() => { boot.hidden = true }, 450)
}

async function main(): Promise<void> {
  const container = document.getElementById('map')
  if (!container) throw new Error('#map container is missing from index.html')

  const map = await initScene(container)
  setHeroBuildings(map, [...SCHEDULE_BUILDINGS])

  const rise = playRiseAnimation(map)
  dismissBoot()

  const store = createStore<AppState>({
    now: new Date(),
    selected: null,
    scrubMinutes: null,
    scrubDay: dayOfDate(new Date()) ?? 'Mon',
    layers: { pois: true, paths: true },
    tourPlaying: false,
  })

  // --- map <- ui ---------------------------------------------------------------------
  function selectSession(s: Session | null): void {
    hidePlaceCard()
    store.set({ selected: s })
    if (!s) { clearRoomPin(map); clearRoute(map); frameCampus(map); return }
    clearRoute(map)
    flyToBuilding(map, s.course.building)
    const c = buildingCentroid(s.course.building)   // [lat, lon]
    if (c) dropRoomPin(map, [c[1], c[0]], s.course.room)
  }

  function routeFromHome(lat: number, lon: number, _label: string): void {
    const home = buildingCentroid(HOME_BUILDING)
    if (!home) return
    showRoute(map, home, [lat, lon])
  }

  function drawRoute(from: Session, to: Session): void {
    const a = buildingCentroid(from.course.building)
    const b = buildingCentroid(to.course.building)
    if (a && b) showRoute(map, a, b)
  }

  await rise

  // --- ui --------------------------------------------------------------------------
  mountSheet(document.getElementById('sheet')!, {
    store,
    onSelect: selectSession,
    onRoute: drawRoute,
    onRouteFromHome: (to: Session) => {
      const home = buildingCentroid(HOME_BUILDING)
      const dest = buildingCentroid(to.course.building)
      if (home && dest) showRoute(map, home, dest)
    },
  })

  mountScrubber(document.getElementById('scrubber')!, {
    store,
    onScrub: (day: Day, minutes: number | null) => {
      store.set({ scrubDay: day, scrubMinutes: minutes })
    },
  })

  const topbar = document.getElementById('topbar')!
  topbar.hidden = false
  mountLayerToggles(topbar, (id, on) => {
    const layers = { ...store.get().layers, [id]: on }
    store.set({ layers })
    if (id === 'pois') setPOIsVisible(on)
    if (id === 'paths' && map.getLayer('paths')) {
      map.setLayoutProperty('paths', 'visibility', on ? 'visible' : 'none')
    }
  })

  // --- keep the scrubber clear of the sheet ------------------------------------------
  // The sheet measures its own peek height (140-240px depending on the Now/Next card),
  // so a hardcoded offset in scrubber.css would overlap it. Publish the real height and
  // get the scrubber out of the way entirely once the sheet is expanded over it.
  const sheetEl = document.getElementById('sheet')!
  const scrubEl = document.getElementById('scrubber')!
  const syncChrome = (): void => {
    const detent = sheetEl.dataset['detent'] ?? 'peek'
    if (detent === 'peek') {
      // The sheet is taller than its peek and hangs below the fold, so measure the
      // VISIBLE portion (viewport bottom minus its top), not its full height.
      const r = sheetEl.getBoundingClientRect()
      const h = Math.round(Math.max(0, window.innerHeight - r.top))
      // Set on the element, not :root — scrubber.css declares --sheet-peek on `.scrub`,
      // which would outrank a :root override.
      scrubEl.style.setProperty('--sheet-peek', `${h}px`)
      // Publish how much chrome sits at the bottom so floating overlays (place card,
      // legend) can clear it instead of guessing a fixed offset.
      const chromeH = Math.round(Math.max(0, window.innerHeight - scrubEl.getBoundingClientRect().top))
      document.documentElement.style.setProperty('--chrome-bottom', `${chromeH}px`)
      scrubEl.classList.remove('is-hidden')
    } else {
      scrubEl.classList.add('is-hidden')
    }
    // Tell the camera which part of the canvas is actually visible, so the campus is
    // framed in the clear band between the top bar and the panels instead of behind them.
    //
    // Padding is derived from the RESTING (peek) layout only. Recomputing it as the sheet
    // is dragged would shift the camera centre on every detent change and walk the view
    // off the campus — the sheet expanding is a temporary overlay, not a new framing.
    if (detent === 'peek') {
      const topbarEl = document.getElementById('topbar')
      const topPad = topbarEl && !topbarEl.hidden ? Math.round(topbarEl.getBoundingClientRect().height) : 0
      const scrubTop = scrubEl.getBoundingClientRect().top
      const bottomPad = Math.round(Math.max(0, window.innerHeight - scrubTop))
      map.setPadding({ top: topPad + 8, bottom: bottomPad + 8, left: 8, right: 8 })
    }
  }
  new ResizeObserver(syncChrome).observe(sheetEl)
  new MutationObserver(syncChrome).observe(sheetEl, { attributes: true, attributeFilter: ['data-detent'] })
  syncChrome()
  frameCampus(map)

  // --- guided tour -------------------------------------------------------------------
  const overlay = document.getElementById('tour-overlay')!
  // The tour draws its own Stop button in the overlay, so the whole top bar steps aside
  // too — otherwise the launch button and layer toggles collide with it on a phone.
  const chrome = [document.getElementById('sheet')!, scrubEl, topbar]
  const setChromeHidden = (hidden: boolean): void => {
    for (const el of chrome) el.classList.toggle('is-hidden', hidden)
  }
  mountTourButton(topbar, () => {
    if (store.get().tourPlaying) { stopTour(); return }
    store.set({ tourPlaying: true, selected: null })
    clearRoomPin(map)
    clearRoute(map)
    setChromeHidden(true)
    // Defer by a tick: the tour mounts a full-bleed cancel scrim, and the very click that
    // started the tour would otherwise keep propagating straight into it and cancel.
    setTimeout(() => startTour(map, overlay, () => {
      store.set({ tourPlaying: false })
      setChromeHidden(false)
      syncChrome()
      frameCampus(map)
    }), 0)
  })

  // Tapping a tour stop must actually TELL you something — each POI carries a
  // hand-written line about why it's worth knowing, which was never being shown.
  renderPOIs(map, POIS, (poi) => {
    store.set({ selected: null })
    clearRoomPin(map)
    clearRoute(map)
    flyToPoint(map, [poi.lon, poi.lat], 17)
    showPOICard(poi, { onRouteFromHome: routeFromHome })
  })

  // Tapping a building explains why it is (or isn't) gold. Without this there was
  // nothing on screen saying what the highlighted buildings even meant.
  for (const layer of ['buildings-hero', 'buildings-3d']) {
    if (!map.getLayer(layer)) continue
    map.on('click', layer, (e) => {
      const name = e.features?.[0]?.properties?.['name']
      if (typeof name !== 'string' || !name) return
      const here = COURSES.filter(c => c.building === name)
      const c = buildingCentroid(name)
      store.set({ selected: null })
      clearRoomPin(map)
      showBuildingCard(name, here, c ? { lat: c[0], lon: c[1] } : null,
        { onRouteFromHome: routeFromHome })
    })
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }

  mountLegend()

  Object.assign(window, { __map: map, __store: store, __week: WEEK })
}

main().catch((err: unknown) => {
  console.error('[uvic-tour] failed to start', err)
  const message = document.getElementById('boot')?.querySelector('p')
  if (message) message.textContent = 'Campus failed to load'
})
