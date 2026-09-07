# UVic Tour — Product & Design Spec

**A stylized 3D campus map that shows one specific person exactly where their classes are,
how to get there, and what else on campus is worth knowing about.**

Audience: one first-year student starting at UVic, Fall 2026 (Sep 09 – Dec 07).
Delivered as a single URL they open on a phone or laptop. No login, no install, works offline.

---

## 1. The user and the job

The friend has five courses across **three buildings**. They have never been on campus.
The terrifying moments are:

1. **Monday 08:30** — first class of the week, earliest start, a building they've never seen.
2. **Tuesday 12:20** — walking out of MacLaurin needing to be in ECS in 70 minutes, with no
   idea which direction that even is.
3. **Any evening** — PSYC ends at 19:20 in November. Victoria sunset is ~16:20. It is fully
   dark and they need the bus loop.
4. **Finding the actual room.** MacLaurin has A/B/D wings. "D287" is meaningless to a newcomer.

The app's job is to make each of those a non-event.

## 2. The schedule (source of truth)

| Course | Title | CRN | Days | Time | Building | Room | Instructor |
|---|---|---|---|---|---|---|---|
| BIOL 184 A01 | Evolution and Biodiversity | 10258 | Mon, Thu | 08:30–09:50 | Bob Wright Centre | B150 | David Punzalan |
| ITAL 100A A01 | Beginners' Italian I | 11996 | Tue, Wed, Fri | 11:30–12:20 | MacLaurin | D287 | Marina Bettaglio |
| BIOL 150A A02 | Modern Biology | 10257 | Tue, Wed, Fri | 13:30–14:20 | Engineering/Comp Sci | 123 | Gerry Gourlay |
| PSYC 100B A01 | Introductory Psychology II | 13005 | Mon, Thu | 16:30–17:50 | MacLaurin | A144 | Imran Tatla |
| PSYC 100A A04 | Introductory Psychology I | 13004 | Mon, Wed | 18:00–19:20 | MacLaurin | A144 | Randal Tonks |

All 1.5 units. Term: 2026-09-09 → 2026-12-07. Campus: Main (Gordon Head).

**Derived facts the app must surface:**
- Mon 17:50→18:00 is a 10-minute gap **in the same room** → "Stay put."
- Tue/Wed/Fri 12:20→13:30 is the only real walk between classes: MacLaurin → ECS, 266 m, ~4 min.
- Wednesday is the heaviest day (3 classes, 11:30 → 19:20).
- Monday has a 6h40m midday gap — the natural slot for the gym.

## 3. Verified data foundation

Queried live from OpenStreetMap via Overpass (2026-09-07):

- **382 building polygons**, 133 named. All three class buildings present with geometry.
- **959 walkable ways** → graph of **5,779 nodes / 6,289 edges**, largest connected
  component holds **98.2%** of nodes. Real pathfinding is viable.
- Only 13 buildings carry `building:levels` → **heights are authored by us**, which is
  what we want anyway for a stylized look.

Confirmed coordinates:

| Building | Lat | Lon |
|---|---|---|
| Bob Wright Centre | 48.46214 | -123.30903 |
| MacLaurin Building | 48.46280 | -123.31386 |
| Engineering/Computer Science | 48.46103 | -123.31144 |
| CARSA (gym) | 48.46790 | -123.31119 |
| Mearns Centre / McPherson Library | 48.46342 | -123.30935 |
| Student Union Building | 48.46508 | -123.30819 |

## 4. Design direction — "Night Campus"

Not a map. An **illuminated architectural model** seen at night.

**Why this direction:** a conventional basemap (roads, labels, beige) reads as Google Maps
and instantly feels generic. By rendering *zero* raster tiles and supplying every polygon
ourselves, we get total art direction, no API key, no attribution box, and a much smaller
payload. The campus floats in darkness; only what matters is lit.

### Palette

Deep midnight base with UVic's blue/gold DNA, without looking corporate.

| Token | Value | Use |
|---|---|---|
| `--void` | `#05070E` | Page + map background |
| `--ground` | `#0B1020` | Campus ground plane |
| `--bldg` | `#18213A` | Ordinary building fill |
| `--bldg-edge` | `#2E3E63` | Ordinary building top edge |
| `--gold` | `#FFB627` | **Your** class buildings — the hero color |
| `--gold-dim` | `#8A6318` | Gold at rest |
| `--cyan` | `#4DD8E6` | Tour stops / points of interest |
| `--path` | `#1E2E4D` | Footpaths at rest |
| `--route` | `#FFD873` | Active walking route |
| `--text` | `#E8EDF7` | Primary text |
| `--text-dim` | `#7C89A6` | Secondary text |
| `--danger` | `#FF6B5A` | Tight transition warning |

Strict rule: **gold is reserved for the friend's own buildings and nothing else.** That single
constraint is what makes the map instantly readable — their eye goes straight to what matters.

### Typography

- **Space Grotesk** — headings, building names, numbers. Geometric, slightly odd, has character.
- **JetBrains Mono** — times, room codes, CRNs, countdowns. Tabular figures matter for the clock.

Both from Google Fonts, preloaded, with system fallbacks.

### Motion (this is where "feel" lives)

| Moment | Behavior |
|---|---|
| **First load** | Buildings rise from height 0 → full over 1400 ms, staggered by distance from campus center (ripple outward), `easeOutCubic`. This is the wow moment. |
| **Camera flight** | `flyTo` with `curve: 1.42`, `speed: 0.7` — a deliberate arc, not a snap. ~1.8 s. |
| **Next class** | Its building's glow breathes on a 3 s sine loop. |
| **Route draw** | Line draws on over 700 ms, then dashes flow continuously toward the destination. |
| **Panel** | 220 ms slide + fade, `cubic-bezier(.22,1,.36,1)`. |
| **Reduced motion** | All of the above collapse to instant state changes when `prefers-reduced-motion`. |

### Layout

**Desktop (≥900px):** map full-bleed. Left rail 380 px, translucent dark glass
(`backdrop-filter: blur(20px)`), holding Now/Next + class list. Bottom-center: week
scrubber. Top-right: layer toggles + tour button.

**Mobile (<900px):** map full-bleed. Bottom sheet at 3 detents (peek 120 px / half / full),
drag or tap to move. Scrubber becomes a horizontal day-pill strip above the sheet.

## 5. Features

### 5.1 Now / Next — the default view
Opens to the live moment. One card, unmissable:
- **In class now:** course, room, "ends in 34 min".
- **Between classes:** next course, countdown, walk time, "leave by HH:MM".
- **Done for the day / weekend:** next class with day name, plus a nudge toward a tour stop.
- **Outside term dates:** falls back to a "term starts Sep 9" state with a Monday preview.

Clock ticks every second. Countdown uses tabular mono figures so it doesn't jitter.

### 5.2 Click a class → cinematic flight
Camera arcs to the building, pitches to ~55°, building flares gold, a room pin drops with
the room code. Panel swaps to a detail card: instructor, days, time, room decoder, and
"route from here".

### 5.3 Week scrubber
A horizontal Mon–Fri timeline, 07:00–21:00. Class blocks sit on it in gold. Drag the
playhead and the map re-lights in real time — buildings ignite as their class starts.
Instantly communicates the *shape* of the week. Snap-to-class-start on click.

### 5.4 Real walking routes
A* over the baked OSM graph. Buildings snap to their nearest graph node. Renders as a
flowing gold line with distance + duration at 1.35 m/s. Zero network calls.

### 5.5 Transition intelligence
For every consecutive pair on a day, compute gap vs. walk time and classify:
- **Same room** → "Stay put — same room, just a new prof." *(Mon 17:50→18:00)*
- **Comfortable** (gap > walk + 10 min) → quiet gray note.
- **Tight** (gap < walk + 5 min) → amber, route pre-drawn.
- **Impossible** (gap < walk) → red warning.

### 5.6 Tour stops layer
Hand-authored POIs in cyan, toggleable, each with a one-line "why you care":
CARSA (gym), McPherson Library, Student Union, Mystic Market, the Cove, BiblioCafé,
bus loop, Finnerty Gardens, First Peoples House, Cadboro Bay lookout, and the campus
rabbits. Each has a card; clicking flies the camera and offers a route.

### 5.7 Room decoder
Hand-authored per-room guidance, because OSM has no indoor data:
> **MacLaurin D287** — D wing, 2nd floor. Enter from the Ring Road side; D wing is the
> north end. Stairs immediately left of the entrance.

Six entries — one per distinct room, plus the three main buildings' entrances.

### 5.8 Cinematic tour mode
Press play. Camera flies a scripted loop: arrival at the bus loop → each class building in
week order → gym → library → food → and back. Each stop holds ~4 s with its card. Full
orbit at the finish. Escape or click exits. This is the "show your friend" mode.

### 5.9 Daylight awareness
Because it genuinely matters here: each class knows whether it *ends* after sunset for
Victoria in that week. Evening classes get a small moon marker and the ground/sky shift
cooler. PSYC 100A ending 19:20 in November is flagged: "Dark walk — bus loop is 6 min east."

### 5.10 Offline / PWA
All data baked into the bundle. Service worker caches everything on first load. Works on
campus with no signal. Installable to home screen.

## 6. Explicit non-goals

- No live transit times, no real UVic API integration, no scraping behind login.
- No indoor floor plans beyond the hand-authored room hints.
- No accounts, no backend, no database. Static files only.
- No photorealistic 3D (explicitly declined).
- Not a general-purpose UVic app — it is tuned to one schedule, edited in one file.

## 7. Success criteria

1. Loads to interactive in **under 2 s** on a mid-range phone over 4G.
2. From cold open, the friend can answer *"where is my next class and when do I leave?"*
   in **under 5 seconds**, without tapping anything.
3. Every one of the 5 courses flies to the correct, verified building.
4. Runs with **no API key and no network** after first load.
5. Someone who has never seen it says "whoa" within the first ten seconds.
