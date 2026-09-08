/**
 * Map layer toggles — **deliberately no longer rendered.** (docs/REDESIGN.md §2, rule 3.)
 *
 * WHY THIS IS A NO-OP AND NOT A REDESIGN
 * --------------------------------------
 * The control was two glyph-only segments in the top bar: a dot (tour stops) and a dashed
 * rule (footpaths). On a 390px phone it carried no words at all, so the only way to learn
 * what either did was to press it and watch the map change — the exact opposite of "a five
 * year old can use it". Giving them words was the other option, and it fails a cheaper
 * test first: *both layers default to ON, and nothing in the app ever asks the user to turn
 * one off.* A control that is correct at its default for essentially every user, forever,
 * is not a control — it is clutter with a tap target. It also cost the top bar its whole
 * left pole, which is why the bar could never be just "one obvious thing to press".
 *
 * So the top bar now holds exactly one control: the tour button. Both layers stay visible
 * because `src/main.ts` seeds `store.layers = { pois: true, paths: true }` and never calls
 * back in here; nothing has to change for the map to look right.
 *
 * The export stays — `src/main.ts` imports and calls `mountLayerToggles(topbar, cb)`, and a
 * no-op is a far smaller change than editing the orchestrator out from under three parallel
 * agents. `onToggle` is simply never invoked. If the feature is ever wanted back it belongs
 * in a settings surface with real words ("Show tour stops", "Show footpaths"), not in the
 * bar above the map.
 *
 * NOTE: unlike the previous implementation this does **not** call `root.replaceChildren()`.
 * That is intentional — `mountTourButton` appends into the same `#topbar`, and clearing it
 * here would make mount order load-bearing for no reason.
 */

import './layers.css'

export type LayerId = 'pois' | 'paths'

/**
 * Mount the layer toggles. Renders nothing; see the note above.
 *
 * Kept as a stable no-op so `src/main.ts` keeps compiling and the wiring for the feature
 * survives in one obvious place.
 */
export function mountLayerToggles(
  _root: HTMLElement,
  _onToggle: (id: LayerId, on: boolean) => void,
): void {
  /* Intentionally empty. The layers are on by default and stay on. */
}
