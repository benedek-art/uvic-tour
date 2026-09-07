declare const buildings: {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: { id: string; name: string | null; height: number; riseDelay: number }
    geometry: { type: 'Polygon'; coordinates: [number, number][][] }
  }[]
}
export default buildings
