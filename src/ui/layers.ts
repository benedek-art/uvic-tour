/**
 * The layer toggles (SPEC §4 Layout: top-right, above the map).
 *
 * Two switches, deliberately: **Tour stops** turns the cyan POI markers on and off, and
 * **Paths** turns the ambient footpath tracery on and off. That's the whole control — a
 * map this art-directed doesn't need a legend, it needs two switches.
 *
 * This module is presentation only. It reports state through `onToggle` and never touches
 * the map itself; the caller owns `setPOIsVisible` and the map's `paths` layer visibility.
 * That keeps the control testable and keeps map knowledge in `src/map/`.
 */

import '../map/map.css'

export type LayerId = 'pois' | 'paths'

interface ToggleSpec {
  id: LayerId
  label: string
  /** Both layers start on: the first thing the app should say is "here's everything". */
  initial: boolean
}

const TOGGLES: ToggleSpec[] = [
  { id: 'pois', label: 'Tour stops', initial: true },
  { id: 'paths', label: 'Paths', initial: true },
]

/**
 * Build the toggle group inside `root` and call `onToggle` whenever one flips.
 *
 * Idempotent: `root` is emptied first, so a re-mount replaces the controls rather than
 * appending a second set.
 *
 * These are `aria-pressed` buttons rather than checkboxes because they're direct
 * manipulation of what's on screen, not a form to submit. Each is a full 44px tall
 * (see `.layer-toggle` in `src/map/map.css`) — this is a phone app.
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

    const lamp = document.createElement('span')
    lamp.className = 'layer-toggle__lamp'
    lamp.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'layer-toggle__label'
    label.textContent = spec.label

    button.append(lamp, label)
    button.addEventListener('click', () => {
      on = !on
      button.setAttribute('aria-pressed', String(on))
      onToggle(spec.id, on)
    })

    group.append(button)
  }

  root.append(group)
}
