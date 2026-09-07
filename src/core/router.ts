/**
 * Walking router over the baked OSM footpath graph.
 *
 * Runs entirely in the browser with zero network calls: the graph is inlined at
 * build time from src/data/generated/walkgraph.json.
 *
 * Coordinate conventions (the easiest thing in this file to get wrong):
 *   - graph nodes, haversine() args, and route() inputs are [lat, lon]
 *   - Route.coords are [lon, lat] (GeoJSON order), ready for a MapLibre LineString
 */
import graph from '../data/generated/walkgraph.json'

/** Average walking pace in metres per second. */
export const WALK_MPS = 1.35

const NODES = graph.nodes as [number, number][]
const ADJ = graph.adj as [number, number][][]

const R_EARTH = 6371000
const RAD = Math.PI / 180

/** Great-circle distance in metres between two `[lat, lon]` points. */
export function haversine(a: [number, number], b: [number, number]): number {
  const lat1 = a[0] * RAD
  const lat2 = b[0] * RAD
  const dLat = lat2 - lat1
  const dLon = (b[1] - a[1]) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Index of the graph node closest to `[lat, lon]`.
 *
 * A linear scan over ~5.7k nodes costs ~0.3 ms — a spatial index would be
 * unjustified complexity at this size.
 */
export function nearestNode(lat: number, lon: number): number {
  const here: [number, number] = [lat, lon]
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < NODES.length; i++) {
    const d = haversine(here, NODES[i]!)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export interface Route {
  /** `[lon, lat]` pairs in GeoJSON order. */
  coords: [number, number][]
  metres: number
  minutes: number
}

/** Min-heap over node indices, keyed by an external f-score array. */
class Heap {
  private items: number[] = []
  constructor(private readonly key: Float64Array) {}

  get size(): number {
    return this.items.length
  }

  push(node: number): void {
    const a = this.items
    a.push(node)
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.key[a[parent]!]! <= this.key[a[i]!]!) break
      const tmp = a[parent]!
      a[parent] = a[i]!
      a[i] = tmp
      i = parent
    }
  }

  pop(): number {
    const a = this.items
    const top = a[0]!
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let small = i
        if (l < a.length && this.key[a[l]!]! < this.key[a[small]!]!) small = l
        if (r < a.length && this.key[a[r]!]! < this.key[a[small]!]!) small = r
        if (small === i) break
        const tmp = a[small]!
        a[small] = a[i]!
        a[i] = tmp
        i = small
      }
    }
    return top
  }
}

/**
 * Shortest walking route between two `[lat, lon]` points.
 *
 * A* with a haversine heuristic — admissible on a metric graph (a straight line
 * is never longer than the walkable path), so the result is optimal.
 * Returns null only if either endpoint cannot be snapped or no path exists;
 * the baked graph is a single connected component, so that should not happen.
 */
export function route(from: [number, number], to: [number, number]): Route | null {
  const start = nearestNode(from[0], from[1])
  const goal = nearestNode(to[0], to[1])
  if (start < 0 || goal < 0) return null

  const n = NODES.length
  const g = new Float64Array(n).fill(Infinity)
  const f = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)

  const goalNode = NODES[goal]!
  const h = (i: number): number => haversine(NODES[i]!, goalNode)

  const open = new Heap(f)
  g[start] = 0
  f[start] = h(start)
  open.push(start)

  let found = false
  while (open.size > 0) {
    const cur = open.pop()
    if (closed[cur]) continue
    if (cur === goal) {
      found = true
      break
    }
    closed[cur] = 1
    for (const edge of ADJ[cur]!) {
      const next = edge[0]
      if (closed[next]) continue
      const tentative = g[cur]! + edge[1]
      if (tentative < g[next]!) {
        g[next] = tentative
        f[next] = tentative + h(next)
        cameFrom[next] = cur
        open.push(next)
      }
    }
  }
  if (!found) return null

  // Walk the parent chain back from the goal, emitting [lon, lat].
  const path: [number, number][] = []
  for (let i: number = goal; i !== -1; i = cameFrom[i]!) {
    const node = NODES[i]!
    path.push([node[1], node[0]])
  }
  path.reverse()

  // Include the true endpoints so the drawn line reaches the buildings, and
  // charge the snap legs to the distance.
  const startNode = NODES[start]!
  const snapIn = haversine(from, startNode)
  const snapOut = haversine(to, goalNode)
  const coords: [number, number][] = [[from[1], from[0]], ...path, [to[1], to[0]]]

  const metres = g[goal]! + snapIn + snapOut
  return { coords, metres, minutes: Math.ceil(metres / WALK_MPS / 60) }
}
