/**
 * The layer toggles (SPEC §4 Layout: top-right, above the map).
 *
 * Two switches, deliberately: **Tour stops** turns the cyan POI markers on and off, and
 * **Paths** turns the ambient footpath tracery on and off. That's the whole control — a
 * map this art-directed doesn't need a legend, it needs two switches.
 *
 * They render as ONE segmented control, not two chips: on a 390px phone they share the
 * top bar with "Show me campus", and as full-width text chips the three of them wrapped
 * into a ragged two-row bar. As a fused 88px switchboard they read as what they are —
 * secondary utilities — and leave the bar's primary slot to the tour. Each segment keeps
 * a full 44x44 target; the visible glyph is a miniature of the thing it toggles, and the
 * word returns at >=900px. See src/ui/layers.css.
 *
 * This module is presentation only. It reports state through `onToggle` and never touches
 * the map itself; the caller owns `setPOIsVisible` and the map's `paths` layer visibility.
 * That keeps the control testable and keeps map knowledge in `src/map/`.
 */

import './layers.css'

export type LayerId = 'pois' | 'paths'

interface ToggleSpec {
  id: LayerId
  /** Shown next to the glyph from 900px up, where there is room for words. */
  label: string
  /** The accessible name. Always present, at every width — the glyph alone is not a name. */
  name: string
  /** Both layers start on: the first thing the app should say is "here's everything". */
  initial: boolean
}

const TOGGLES: ToggleSpec[] = [
  { id: 'pois', label: 'Stops', name: 'Tour stops', initial: true },
  { id: 'paths', label: 'Paths', name: 'Paths', initial: true },
]

/**
 * Build the toggle group inside `root` and call `onToggle` whenever one flips.
 *
 * Idempotent: `root` is emptied first, so a re-mount replaces the controls rather than
 * appending a second set.
 *
 * These are `aria-pressed` buttons rather than checkboxes because they're direct
 * manipulation of what's on screen, not a form to submit. Each is a full 44x44
 * (see `.layer-toggle` in `src/ui/layers.css`) — this is a phone app.
 */
export function mountLayerToggles(
  root: HTMLElement,
  onToggle: (id: LayerId, on: boolean) => void,
): void {
  root.replaceChildren()

  const group = document.createElement('div')
  group.className = 'layer-toggles'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', 'Map layers')

  for (const spec of TOGGLES) {
    let on = spec.initial

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'layer-toggle'
    button.dataset['layer'] = spec.id
    button.setAttribute('data-testid', `layer-toggle-${spec.id}`)
    button.setAttribute('aria-pressed', String(on))
    // The name never depends on the label being visible — below 900px it isn't.
    button.setAttribute('aria-label', spec.name)
    button.title = spec.name

    const glyph = document.createElement('span')
    glyph.className = `layer-toggle__glyph layer-toggle__glyph--${spec.id}`
    glyph.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'layer-toggle__label'
    label.setAttribute('aria-hidden', 'true')
    label.textContent = spec.label

    button.append(glyph, label)
    button.addEventListener('click', () => {
      on = !on
      button.setAttribute('aria-pressed', String(on))
      onToggle(spec.id, on)
    })

    group.append(button)
  }

  root.append(group)
}
