/**
 * Tour stops — the "here's what else is on campus" layer (SPEC §5.6).
 *
 * A timetable tells you where your five classes are. It does not tell you where the gym
 * is, where you eat at 21:00, or which bus bay to stand at. These eleven hand-authored
 * stops are that second half of the job, and each one carries a single sentence saying
 * why a first-year should care.
 *
 * COORDINATE PROVENANCE — read before editing.
 * Anything that is a real, named OSM building resolves its centroid from
 * `generated/buildings.geojson` **at module load** rather than carrying a hardcoded
 * number, so the data can never drift from the geometry we actually draw. Everything
 * else is an explicit literal, and each one is labelled below with how confident we are:
 *
 *   RESOLVED  — centroid taken from the baked OSM polygon, verified against SPEC §3.
 *   DERIVED   — computed from other baked OSM data (see the bus loop).
 *   ESTIMATED — hand-placed. Right neighbourhood, not a surveyed point.
 *
 * Colour note: these render in `--cyan`. Gold is reserved for the student's own class
 * buildings and must never be used here (SPEC §4).
 */

import buildings from './generated/buildings.geojson'

export type POICategory = 'gym' | 'library' | 'food' | 'transit' | 'nature' | 'culture'

export interface POI {
  id: string
  name: string
  /** WGS84 latitude. Always inside the campus bbox 48.4585..48.4700. */
  lat: number
  /** WGS84 longitude. Always inside the campus bbox -123.3200..-123.3020. */
  lon: number
  category: POICategory
  /** One short sentence, sized to read on a 390px phone. */
  why: string
}

/**
 * Centroid of a named building's outer ring as `[lat, lon]`.
 *
 * GeoJSON stores `[lon, lat]`, so the flip happens here. The ring's closing vertex
 * repeats the first one and is dropped so it isn't double-weighted. Returns null when
 * nothing carries that exact `name` — callers fall back rather than throw, because a
 * missing tour stop is a far better failure than a blank app.
 *
 * (`src/map/camera.ts` and `src/core/transitions.ts` each own a copy of this ~15-line
 * helper. Deliberate: the data layer stays dependency-free and imports neither.)
 */
function centroidByName(name: string): [number, number] | null {
  const feature = buildings.features.find((f) => f.properties.name === name)
  const ring = feature?.geometry.coordinates[0]
  if (!ring || ring.length === 0) return null

  const first = ring[0]!
  const last = ring[ring.length - 1]!
  const closed = ring.length > 1 && first[0] === last[0] && first[1] === last[1]
  const count = closed ? ring.length - 1 : ring.length
  if (count < 1) return null

  let lon = 0
  let lat = 0
  for (let i = 0; i < count; i++) {
    const v = ring[i]!
    lon += v[0]
    lat += v[1]
  }
  return [lat / count, lon / count]
}

/**
 * Resolve a building name to `[lat, lon]`, falling back to a literal if the name has
 * vanished from the baked data.
 *
 * `dLat`/`dLon` nudge the result a few metres. Two stops here live *inside* another stop's
 * building (Mystic Market in the SUB, BiblioCafé in the library); without an offset their
 * markers would sit exactly on top of each other and only one would ever be tappable.
 */
function at(
  name: string,
  fallback: readonly [number, number],
  dLat = 0,
  dLon = 0,
): [number, number] {
  const c = centroidByName(name) ?? [fallback[0], fallback[1]]
  return [c[0] + dLat, c[1] + dLon]
}

const CARSA = at('Centre for Athletics, Recreation and Special Abilities', [48.4679, -123.31119])
const LIBRARY = at('Mearns Centre for Learning', [48.46342, -123.30935])
const SUB = at('Student Union Building', [48.46508, -123.30819])
const FPH = at('First Peoples House', [48.46399, -123.3117])
// ~20 m offsets so the in-building stops stay individually tappable on a phone.
const MYSTIC = at('Student Union Building', [48.46508, -123.30819], -0.00018, 0.00012)
const BIBLIO = at('Mearns Centre for Learning', [48.46342, -123.30935], 0.00016, 0.00014)

export const POIS: POI[] = [
  {
    // RESOLVED — polygon centroid 48.46792,-123.31121 vs SPEC §3's 48.46790,-123.31119.
    id: 'carsa',
    name: 'CARSA',
    lat: CARSA[0],
    lon: CARSA[1],
    category: 'gym',
    why: 'Your gym is already paid for by tuition — weights, courts and a climbing wall.',
  },
  {
    // RESOLVED — centroid 48.46346,-123.30928 vs SPEC §3's 48.46342,-123.30935.
    id: 'mcpherson-library',
    name: 'McPherson Library',
    lat: LIBRARY[0],
    lon: LIBRARY[1],
    category: 'library',
    why: 'Five floors of study space, and the upper ones are silent when you mean it.',
  },
  {
    // RESOLVED — centroid 48.46514,-123.30819 vs SPEC §3's 48.46508,-123.30819.
    id: 'student-union',
    name: 'Student Union Building',
    lat: SUB[0],
    lon: SUB[1],
    category: 'culture',
    why: 'Clubs, the pub and the cheap lunch — where afternoons quietly disappear.',
  },
  {
    // RESOLVED (SUB centroid, nudged ~20 m) — Mystic Market is the SUB's food court.
    id: 'mystic-market',
    name: 'Mystic Market',
    lat: MYSTIC[0],
    lon: MYSTIC[1],
    category: 'food',
    why: 'The big food court inside the SUB — busiest lunch on campus, and deservedly.',
  },
  {
    // ESTIMATED — the Cadboro Commons dining hall is not named in OSM. Placed in the
    // east-side residence cluster between Cheko'nien House and Craigdarroch. Within
    // ~100 m, not surveyed.
    id: 'the-cove',
    name: 'The Cove',
    lat: 48.4645,
    lon: -123.3064,
    category: 'food',
    why: 'Residence dining on the east side — all-you-can-eat, and open when nothing else is.',
  },
  {
    // RESOLVED (library centroid, nudged ~20 m) — BiblioCafé is inside McPherson Library.
    id: 'bibliocafe',
    name: 'BiblioCafé',
    lat: BIBLIO[0],
    lon: BIBLIO[1],
    category: 'food',
    why: 'Coffee inside the library, so you never have to give up your table.',
  },
  {
    // DERIVED — mean of every `bus=yes` service way in the baked OSM extract
    // (39 vertices, 48.46560..48.46650 / -123.30944..-123.30789). This is the exchange
    // road itself, just north of the SUB.
    id: 'bus-loop',
    name: 'UVic Transit Exchange',
    lat: 48.46609,
    lon: -123.30865,
    category: 'transit',
    why: 'Every campus bus starts and ends here — this is how you get downtown.',
  },
  {
    // ESTIMATED — the gardens wrap the Interfaith Chapel (OSM centroid
    // 48.46068,-123.31705); placed just off it at the southwest corner of campus.
    id: 'finnerty-gardens',
    name: 'Finnerty Gardens',
    lat: 48.4608,
    lon: -123.3173,
    category: 'nature',
    why: 'Free gardens around the chapel — rhododendrons in spring, quiet all year.',
  },
  {
    // RESOLVED — centroid 48.46396,-123.31170 vs SPEC §3's 48.46399,-123.31170.
    id: 'first-peoples-house',
    name: 'First Peoples House',
    lat: FPH[0],
    lon: FPH[1],
    category: 'culture',
    why: 'The heart of Indigenous student life here, and its carved great hall is open to all.',
  },
  {
    // ESTIMATED — a viewpoint, not a mapped feature. Placed at the north edge of campus,
    // the side that faces Cadboro Bay. Treat as "walk this way", not as a pin.
    id: 'ocean-lookout',
    name: 'Cadboro Bay Lookout',
    lat: 48.4693,
    lon: -123.3045,
    category: 'nature',
    why: 'Head off the north edge of campus and the ocean opens up — best sunset around.',
  },
  {
    // ESTIMATED — rabbits do not hold still for surveyors. Placed on the open lawn inside
    // Ring Road between the SUB and the McKinnon Building, the classic sighting ground.
    id: 'campus-rabbits',
    name: 'The Campus Rabbits',
    lat: 48.4656,
    lon: -123.31,
    category: 'nature',
    why: 'UVic is famous for its bunnies — most were rehomed in 2010, so a sighting counts.',
  },
]
