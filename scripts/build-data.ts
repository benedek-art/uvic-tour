/**
 * Bake UVic campus geometry from OpenStreetMap into static JSON.
 *
 * One-shot build step. Everything the app renders or routes over is produced here
 * and committed to `src/data/generated/`, so the running app makes ZERO network
 * calls and works offline.
 *
 * Run: `npm run data`
 *
 * Outputs (contracts consumed by src/map/* and src/core/router.ts):
 *   buildings.geojson  FeatureCollection<Polygon>  props { id, name, height, riseDelay }
 *   paths.geojson      FeatureCollection<LineString>
 *   walkgraph.json     { nodes: [lat, lon][], adj: [nodeIndex, metres][][] }
 *   meta.json          { center: [lon, lat], bbox: [w, s, e, n], generatedAt }
 *
 * NOTE ON COORDINATE ORDER: GeoJSON is [lon, lat]. The walk graph is [lat, lon].
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = resolve(ROOT, 'src/data/generated')
const CACHE_FILE = resolve(ROOT, '.cache/osm.json')

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** south, west, north, east — Overpass bbox order. Verified 2026-09-07. */
const BBOX = { s: 48.4585, w: -123.32, n: 48.47, e: -123.302 } as const

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

const HIGHWAY_RE =
  '^(footway|path|pedestrian|steps|cycleway|service|living_street|residential|unclassified|tertiary)$'

const QUERY = `[out:json][timeout:180];
(
  way["building"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["highway"~"${HIGHWAY_RE}"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
);
out geom;`

/**
 * Authored heights, in metres, for the buildings that carry the story.
 * OSM has `building:levels` for only 13 polygons here, so the derived
 * heuristic is the baseline and this table is the art direction on top.
 */
const HEIGHT_OVERRIDES: Record<string, number> = {
  'MacLaurin Building': 20,
  'Bob Wright Centre': 24,
  'Engineering/Computer Science Building': 22,
  'Centre for Athletics, Recreation and Special Abilities': 20,
  'Mearns Centre for Learning': 22,
  'Student Union Building': 16,
}

/** Vertex snapping precision. 6 dp ~= 0.11 m — enough to merge shared way endpoints. */
const SNAP_DP = 6

/** If paths.geojson exceeds this, run Douglas–Peucker. */
const PATHS_SIZE_BUDGET = 600 * 1024
const SIMPLIFY_TOLERANCE_M = 1

/** Long straight OSM segments get subdivided so no graph edge exceeds this. */
const MAX_EDGE_M = 150

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OsmNode {
  lat: number
  lon: number
}

interface OsmWay {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: (OsmNode | null)[]
}

interface OverpassResponse {
  elements: OsmWay[]
}

type Position = [number, number]

interface BuildingProps {
  id: string
  name: string | null
  height: number
  riseDelay: number
}

interface Feature<G, P> {
  type: 'Feature'
  properties: P
  geometry: G
}

interface FeatureCollection<G, P> {
  type: 'FeatureCollection'
  features: Feature<G, P>[]
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const R_EARTH = 6371008.8

function toRad(d: number): number {
  return (d * Math.PI) / 180
}

/** Great-circle distance in metres between two [lat, lon] points. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Local equirectangular projection to metres, good enough over a 2 km campus. */
function projector(refLat: number): (lat: number, lon: number) => Position {
  const mPerDegLat = (Math.PI / 180) * R_EARTH
  const mPerDegLon = mPerDegLat * Math.cos(toRad(refLat))
  return (lat, lon) => [lon * mPerDegLon, lat * mPerDegLat]
}

/** Planar shoelace area in m² of a projected ring. */
function ringArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// ---------------------------------------------------------------------------
// Fetch (cached)
// ---------------------------------------------------------------------------

async function fetchOsm(): Promise<OverpassResponse> {
  if (existsSync(CACHE_FILE)) {
    console.log(`· using cached Overpass response (${CACHE_FILE})`)
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as OverpassResponse
  }
  console.log('· querying Overpass …')
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      // Overpass answers 406 to Node's default undici User-Agent. A real one is required.
      'User-Agent': 'uvic-tour-build/1.0 (static campus map build step)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ data: QUERY }).toString(),
  })
  if (!res.ok) throw new Error(`Overpass returned ${res.status} ${res.statusText}`)
  const text = await res.text()
  const json = JSON.parse(text) as OverpassResponse
  if (!Array.isArray(json.elements)) throw new Error('Overpass response has no elements array')
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, text)
  console.log(`· cached raw response → ${CACHE_FILE}`)
  return json
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function cleanGeometry(way: OsmWay): OsmNode[] {
  return (way.geometry ?? []).filter((n): n is OsmNode => n != null)
}

function deriveHeight(name: string | null, levels: string | undefined, areaM2: number): number {
  const override = name != null ? HEIGHT_OVERRIDES[name] : undefined
  if (override !== undefined) return override
  if (levels !== undefined) {
    const n = Number.parseFloat(levels)
    if (Number.isFinite(n) && n > 0) return round(n * 3.5, 2)
  }
  if (areaM2 > 4000) return 18
  if (areaM2 > 1500) return 12
  return 8
}

function buildBuildings(
  ways: OsmWay[],
): { fc: FeatureCollection<{ type: 'Polygon'; coordinates: Position[][] }, BuildingProps>; center: Position } {
  const project = projector((BBOX.s + BBOX.n) / 2)

  const raw = ways
    .filter((w) => w.tags?.['building'] !== undefined)
    .map((w) => {
      const geom = cleanGeometry(w)
      return { way: w, geom }
    })
    .filter(({ geom }) => geom.length >= 4)

  // Ring vertices, closed. Deduplicate the OSM closing vertex before measuring.
  const prepared = raw.map(({ way, geom }) => {
    const open =
      geom.length > 1 &&
      geom[0]!.lat === geom[geom.length - 1]!.lat &&
      geom[0]!.lon === geom[geom.length - 1]!.lon
        ? geom.slice(0, -1)
        : geom
    const projected = open.map((p) => project(p.lat, p.lon))
    const areaM2 = ringArea(projected)
    let cLat = 0
    let cLon = 0
    for (const p of open) {
      cLat += p.lat
      cLon += p.lon
    }
    cLat /= open.length
    cLon /= open.length
    const name = way.tags?.['name'] ?? null
    const height = deriveHeight(name, way.tags?.['building:levels'], areaM2)
    return { way, open, areaM2, cLat, cLon, name, height }
  })

  // Campus centroid = mean of building centres.
  let sumLat = 0
  let sumLon = 0
  for (const b of prepared) {
    sumLat += b.cLat
    sumLon += b.cLon
  }
  const centroidLat = sumLat / prepared.length
  const centroidLon = sumLon / prepared.length

  const dists = prepared.map((b) => haversine(centroidLat, centroidLon, b.cLat, b.cLon))
  const maxDist = Math.max(...dists, 1)

  const features = prepared.map((b, i) => {
    const ring: Position[] = b.open.map((p) => [round(p.lon, SNAP_DP), round(p.lat, SNAP_DP)])
    ring.push([ring[0]![0], ring[0]![1]])
    const riseDelay = round(Math.min(1, Math.max(0, dists[i]! / maxDist)), 3)
    return {
      type: 'Feature' as const,
      properties: {
        id: `w${b.way.id}`,
        name: b.name,
        height: b.height,
        riseDelay,
      },
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    }
  })

  return {
    fc: { type: 'FeatureCollection', features },
    center: [round(centroidLon, 6), round(centroidLat, 6)],
  }
}

// ---------------------------------------------------------------------------
// Paths + walk graph
// ---------------------------------------------------------------------------

const HIGHWAY_OK = new Set([
  'footway',
  'path',
  'pedestrian',
  'steps',
  'cycleway',
  'service',
  'living_street',
  'residential',
  'unclassified',
  'tertiary',
])

function walkways(ways: OsmWay[]): OsmNode[][] {
  const out: OsmNode[][] = []
  for (const w of ways) {
    const hw = w.tags?.['highway']
    if (hw === undefined || !HIGHWAY_OK.has(hw)) continue
    const geom = cleanGeometry(w)
    if (geom.length >= 2) out.push(geom)
  }
  return out
}

/** Perpendicular distance from p to segment ab, in projected metres. */
function perpDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function buildPaths(
  lines: OsmNode[][],
  simplify: boolean,
): FeatureCollection<{ type: 'LineString'; coordinates: Position[] }, Record<string, never>> {
  const project = projector((BBOX.s + BBOX.n) / 2)
  const features = lines.map((line) => {
    let coords: Position[] = line.map((p) => [round(p.lon, SNAP_DP), round(p.lat, SNAP_DP)])
    if (simplify && coords.length > 2) {
      // Simplify in projected metres, then map back through the same index order.
      const projected = line.map((p) => project(p.lat, p.lon))
      const keep = new Set<number>()
      const withIndex = projected.map((p, i) => ({ p, i }))
      markKept(withIndex, SIMPLIFY_TOLERANCE_M, keep)
      const filtered = coords.filter((_, i) => keep.has(i))
      if (filtered.length >= 2) coords = filtered
    }
    return {
      type: 'Feature' as const,
      properties: {} as Record<string, never>,
      geometry: { type: 'LineString' as const, coordinates: coords },
    }
  })
  return { type: 'FeatureCollection', features }
}

/** Index-preserving Douglas–Peucker so the lon/lat array stays in sync. */
function markKept(
  pts: { p: Position; i: number }[],
  tolerance: number,
  keep: Set<number>,
): void {
  if (pts.length === 0) return
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  keep.add(first.i)
  keep.add(last.i)
  if (pts.length <= 2) return
  let maxD = 0
  let idx = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i]!.p, first.p, last.p)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= tolerance || idx < 0) return
  markKept(pts.slice(0, idx + 1), tolerance, keep)
  markKept(pts.slice(idx), tolerance, keep)
}

interface Graph {
  nodes: Position[] // [lat, lon]
  adj: [number, number][][]
}

function buildWalkGraph(lines: OsmNode[][]): { graph: Graph; stats: Record<string, number> } {
  const index = new Map<string, number>()
  const nodes: Position[] = []

  const idOf = (lat: number, lon: number): number => {
    const sLat = round(lat, SNAP_DP)
    const sLon = round(lon, SNAP_DP)
    const key = `${sLat.toFixed(SNAP_DP)},${sLon.toFixed(SNAP_DP)}`
    const hit = index.get(key)
    if (hit !== undefined) return hit
    const id = nodes.length
    nodes.push([sLat, sLon])
    index.set(key, id)
    return id
  }

  const edges = new Map<string, number>() // "a|b" (a<b) -> metres
  const addEdge = (a: number, b: number, m: number): void => {
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const prev = edges.get(key)
    if (prev === undefined || m < prev) edges.set(key, m)
  }

  let rawEdges = 0
  let subdivided = 0

  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!
      const b = line[i + 1]!
      const d = haversine(a.lat, a.lon, b.lat, b.lon)
      rawEdges++
      if (d <= MAX_EDGE_M) {
        addEdge(idOf(a.lat, a.lon), idOf(b.lat, b.lon), round(d, 2))
        continue
      }
      // A long straight OSM segment (typically a service road drawn with two
      // nodes). Subdivide so the router has somewhere to snap and so no edge
      // weight is implausibly large.
      subdivided++
      const steps = Math.ceil(d / MAX_EDGE_M)
      let prev = idOf(a.lat, a.lon)
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const lat = a.lat + (b.lat - a.lat) * t
        const lon = a.lon + (b.lon - a.lon) * t
        const cur = idOf(lat, lon)
        addEdge(prev, cur, round(d / steps, 2))
        prev = cur
      }
    }
  }

  // Adjacency over all nodes.
  const adjAll: [number, number][][] = nodes.map(() => [])
  for (const [key, m] of edges) {
    const [aStr, bStr] = key.split('|')
    const a = Number(aStr)
    const b = Number(bStr)
    adjAll[a]!.push([b, m])
    adjAll[b]!.push([a, m])
  }

  // Union-find → keep only the largest connected component.
  const parent = new Int32Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) parent[i] = i
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]!
    let c = x
    while (parent[c] !== c) {
      const next = parent[c]!
      parent[c] = r
      c = next
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (const key of edges.keys()) {
    const [aStr, bStr] = key.split('|')
    union(Number(aStr), Number(bStr))
  }

  const counts = new Map<number, number>()
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i)
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  let bestRoot = -1
  let bestCount = 0
  for (const [root, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestRoot = root
    }
  }

  // Dense re-index of the largest component only.
  const remap = new Int32Array(nodes.length).fill(-1)
  const outNodes: Position[] = []
  for (let i = 0; i < nodes.length; i++) {
    if (find(i) !== bestRoot) continue
    remap[i] = outNodes.length
    outNodes.push(nodes[i]!)
  }
  const outAdj: [number, number][][] = outNodes.map(() => [])
  for (let i = 0; i < nodes.length; i++) {
    const ni = remap[i]!
    if (ni < 0) continue
    for (const [nb, m] of adjAll[i]!) {
      const nj = remap[nb]!
      if (nj < 0) continue
      outAdj[ni]!.push([nj, m])
    }
  }

  let maxEdge = 0
  let edgeCount = 0
  for (const list of outAdj) {
    edgeCount += list.length
    for (const [, m] of list) if (m > maxEdge) maxEdge = m
  }

  return {
    graph: { nodes: outNodes, adj: outAdj },
    stats: {
      rawNodes: nodes.length,
      rawEdges,
      subdividedSegments: subdivided,
      keptNodes: outNodes.length,
      keptEdges: edgeCount / 2,
      componentShare: round((outNodes.length / nodes.length) * 100, 1),
      maxEdgeM: round(maxEdge, 2),
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function writeJson(name: string, value: unknown): number {
  const path = resolve(OUT_DIR, name)
  writeFileSync(path, JSON.stringify(value))
  const bytes = statSync(path).size
  console.log(`  ${name.padEnd(20)} ${(bytes / 1024).toFixed(1)} KB`)
  return bytes
}

async function main(): Promise<void> {
  const osm = await fetchOsm()
  mkdirSync(OUT_DIR, { recursive: true })

  const ways = osm.elements.filter((e) => e.type === 'way')
  console.log(`· ${ways.length} ways in response`)

  const { fc: buildings, center } = buildBuildings(ways)
  const lines = walkways(ways)
  console.log(`· ${buildings.features.length} buildings, ${lines.length} walkways`)

  const { graph, stats } = buildWalkGraph(lines)
  console.log(
    `· graph: ${stats['keptNodes']} nodes / ${stats['keptEdges']} edges ` +
      `(${stats['componentShare']}% of ${stats['rawNodes']} raw, ` +
      `${stats['subdividedSegments']} long segments subdivided, ` +
      `max edge ${stats['maxEdgeM']} m)`,
  )

  console.log('· writing …')
  writeJson('buildings.geojson', buildings)

  let paths = buildPaths(lines, false)
  let pathBytes = writeJson('paths.geojson', paths)
  if (pathBytes > PATHS_SIZE_BUDGET) {
    console.log(`  paths.geojson over budget — simplifying at ${SIMPLIFY_TOLERANCE_M} m …`)
    paths = buildPaths(lines, true)
    pathBytes = writeJson('paths.geojson', paths)
  }

  writeJson('walkgraph.json', graph)
  writeJson('meta.json', {
    center,
    bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n],
    generatedAt: new Date().toISOString(),
  })

  console.log('· done')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
