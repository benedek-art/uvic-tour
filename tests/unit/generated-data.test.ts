// tests/unit/generated-data.test.ts
import { describe, it, expect } from 'vitest'
import buildings from '../../src/data/generated/buildings.geojson'
import graph from '../../src/data/generated/walkgraph.json'

const NAMES = ['MacLaurin Building', 'Bob Wright Centre', 'Engineering/Computer Science Building']

describe('generated campus data', () => {
  it('contains every building used by the schedule', () => {
    const names = new Set(buildings.features.map((f: any) => f.properties.name))
    for (const n of NAMES) expect(names.has(n)).toBe(true)
  })

  it('gives every building a positive height and a 0..1 riseDelay', () => {
    for (const f of buildings.features as any[]) {
      expect(f.properties.height).toBeGreaterThan(0)
      expect(f.properties.riseDelay).toBeGreaterThanOrEqual(0)
      expect(f.properties.riseDelay).toBeLessThanOrEqual(1)
    }
  })

  it('produces a single fully-connected walk graph', () => {
    expect(graph.nodes.length).toBeGreaterThan(3000)
    const seen = new Set<number>([0])
    const stack = [0]
    while (stack.length) {
      const cur = stack.pop()!
      for (const [nb] of graph.adj[cur]!) if (!seen.has(nb!)) { seen.add(nb!); stack.push(nb!) }
    }
    expect(seen.size).toBe(graph.nodes.length) // largest component only => fully connected
  })

  it('has no edge longer than 200m (would indicate a snapping bug)', () => {
    for (const list of graph.adj) for (const [, d] of list) expect(d).toBeLessThan(200)
  })
})
