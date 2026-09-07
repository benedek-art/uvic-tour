/**
 * Bootstrap and wiring.
 *
 * Every feature module is self-contained and was built in isolation; this file is the
 * single seam where they meet. Keep it declarative — logic belongs in the modules.
 */
/// <reference types="vite/client" />
import './style.css'

import { COURSES, SCHEDULE_BUILDINGS, type Day } from './data/schedule'
import { POIS } from './data/pois'
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
    store.set({ selected: s })
    if (!s) { clearRoomPin(map); clearRoute(map); frameCampus(map); return }
    clearRoute(map)
    flyToBuilding(map, s.course.building)
    const c = buildingCentroid(s.course.building)   // [lat, lon]
    if (c) dropRoomPin(map, [c[1], c[0]], s.course.room)
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
      scrubEl.classList.remove('is-hidden')
    } else {
      scrubEl.classList.add('is-hidden')
    }
    // Tell the camera which part of the canvas is actually visible, so the campus is
    // framed in the clear band between the top bar and the panels instead of behind them.
    const topbarEl = document.getElementById('topbar')
    const topPad = topbarEl && !topbarEl.hidden ? Math.round(topbarEl.getBoundingClientRect().height) : 0
    const scrubTop = scrubEl.classList.contains('is-hidden')
      ? window.innerHeight
      : scrubEl.getBoundingClientRect().top
    const bottomPad = Math.round(Math.max(0, window.innerHeight - scrubTop))
    map.setPadding({ top: topPad + 8, bottom: bottomPad + 8, left: 8, right: 8 })
  }
  new ResizeObserver(syncChrome).observe(sheetEl)
  new MutationObserver(syncChrome).observe(sheetEl, { attributes: true, attributeFilter: ['data-detent'] })
  syncChrome()
  frameCampus(map)

  renderPOIs(map, POIS, (poi) => {
    store.set({ selected: null })
    clearRoomPin(map)
    flyToPoint(map, [poi.lon, poi.lat], 17)
  })

  Object.assign(window, { __map: map, __store: store, __week: WEEK })
}

main().catch((err: unknown) => {
  console.error('[uvic-tour] failed to start', err)
  const message = document.getElementById('boot')?.querySelector('p')
  if (message) message.textContent = 'Campus failed to load'
})
