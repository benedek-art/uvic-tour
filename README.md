# UVic Tour

A stylized 3D campus map that shows one student exactly where their Fall 2026 classes are,
how long the walk is, and what else on campus is worth knowing about.

Built for a first-year starting at the University of Victoria who has never been on campus.

![Night Campus](docs/preview.png)

## What it does

- **Now / Next** — opens to the live moment. *"NEXT UP · PSYC 100B · MACL A144 · 30:00 until it starts · 9 min walk, leave by 16:21."* No tapping required.
- **Tap a class, fly to it** — the camera arcs to the building, which flares gold, and a room pin drops.
- **Find the actual room** — hand-written directions per room, because "MacLaurin D287" means nothing to a newcomer. *"D wing is the north end. Enter from the Ring Road side and take the stairs immediately left of the entrance."*
- **Real walking routes** — A* over a walk graph baked from OpenStreetMap, drawn as a flowing gold line. No network calls.
- **Transition intelligence** — knows that Monday's 10-minute PSYC handoff is *the same room*, and says "Stay put" instead of panicking.
- **Week scrubber** — drag through the week and watch buildings ignite as classes start.
- **Tour stops** — the gym, library, food, bus loop, Finnerty Gardens, and the campus rabbits.
- **Daylight awareness** — Victoria's sun sets at 16:19 by the end of term. Evening classes are flagged as dark walks.
- **Works offline** — everything is precached. Campus wifi is unreliable; this isn't.

## The design

"Night Campus": an illuminated architectural model, not a map. The app renders **zero raster
tiles** — every polygon comes from our own committed GeoJSON, which means no API key, no
attribution box, total art direction, and a small payload.

One rule makes the map instantly readable: **gold is reserved exclusively for the student's
own three class buildings.** Everything else is dark blue-grey; tour stops are cyan.

## Changing the schedule

Everything is driven by one file: [`src/data/schedule.ts`](src/data/schedule.ts). Edit the
five `Course` entries and the whole app follows — map highlighting, routes, scrubber, warnings.

`building` strings **must** match the OpenStreetMap `name` exactly, since the map layers
filter on them. The three currently in use:

- `'Bob Wright Centre'`
- `'MacLaurin Building'`
- `'Engineering/Computer Science Building'`

Room-finding hints live in [`src/data/rooms.ts`](src/data/rooms.ts); tour stops in
[`src/data/pois.ts`](src/data/pois.ts).

## Commands

```bash
npm install
npm run dev        # dev server
npm run build      # production build
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright, WebKit @ iPhone 13)
npm run data       # re-bake campus geometry from OpenStreetMap
```

## Architecture

| Layer | What lives there |
|---|---|
| `scripts/build-data.ts` | One-shot Overpass fetch → buildings/paths GeoJSON + walk graph. Output is committed. |
| `src/core/` | Pure logic — week grid, A* router, transitions, sunset. No DOM, no map. Enforced by a guard test. |
| `src/map/` | MapLibre scene, camera, route layer, markers. |
| `src/ui/` | Bottom sheet, Now/Next, class list, detail card, scrubber, tour. |
| `src/data/` | The schedule, room hints, POIs, and generated geometry. |

`src/core/` is deliberately pure so all the interesting logic is unit-testable without a browser.

## Data

Campus geometry comes from [OpenStreetMap](https://www.openstreetmap.org/copyright)
(© OpenStreetMap contributors, ODbL), fetched once at build time via the Overpass API and
committed to `src/data/generated/`. Re-run `npm run data` to refresh it.

Building heights are authored rather than surveyed — OSM only carries `building:levels` for
13 of 375 buildings, and a stylized model wants deliberate proportions anyway.

## Caveats

- Some tour-stop coordinates are **estimated**, not surveyed — they're labelled as such in
  `src/data/pois.ts`. The Cove, Finnerty Gardens, and the Cadboro Bay lookout are
  "walk this way" pins, not precise locations.
- Room-interior guidance is hand-written from public building layouts. It's meant to get a
  newcomer to the right wing and floor, not to replace signage.
- Not affiliated with the University of Victoria.

## Fonts

Space Grotesk and JetBrains Mono, self-hosted under the SIL Open Font License
(see `public/fonts/`).
