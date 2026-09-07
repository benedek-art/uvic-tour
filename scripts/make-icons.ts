import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

// Mark: three extruded gold blocks on the void — echoes the map's own aesthetic.
// Heights mirror the three class buildings (Bob Wright tallest, then ECS, then MacLaurin).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#05070E"/>
  <g stroke="#FFB627" stroke-linejoin="round" stroke-width="7">
    <!-- left block -->
    <path d="M120 330 L188 292 L188 208 L120 246 Z" fill="#FFB627" fill-opacity=".22"/>
    <path d="M120 330 L188 292 L256 330 L188 368 Z" fill="#FFB627" fill-opacity=".38"/>
    <path d="M188 292 L256 330 L256 246 L188 208 Z" fill="#FFB627" fill-opacity=".62"/>
    <!-- right block, taller -->
    <path d="M256 330 L324 292 L324 168 L256 206 Z" fill="#FFB627" fill-opacity=".22"/>
    <path d="M256 330 L324 292 L392 330 L324 368 Z" fill="#FFB627" fill-opacity=".38"/>
    <path d="M324 292 L392 330 L392 206 L324 168 Z" fill="#FFB627" fill-opacity=".62"/>
  </g>
  <circle cx="256" cy="404" r="15" fill="#4DD8E6"/>
</svg>`

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`)
  console.log(`wrote public/icons/icon-${size}.png`)
}
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png')
console.log('wrote public/icons/apple-touch-icon.png')
