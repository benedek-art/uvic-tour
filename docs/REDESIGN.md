# Redesign brief — "Warm Paper"

Direction from the owner, verbatim:
> *"Can we fully change the theme, I don't like the colours or the theme. Do a nice beige-ish
> colour, something modern and minimalistic. We also have to make sure that the app is very
> very very easy to use. Simple buttons, good hierarchy, and overall like a 5 year old can use it."*

This supersedes the dark "Night Campus" direction in `docs/SPEC.md` §4. Everything else in
SPEC (the schedule, the features, the data) still stands.

## 1. The look

**Warm paper.** Light, calm, minimal. Think a well-printed field guide, not a sci-fi HUD.
Generous whitespace, few colours, strong type hierarchy, soft shadows instead of glowing borders.

The palette lives in `src/tokens.css` and is LOCKED. **Never write a raw hex value.**
Token names were kept from the old dark theme so nothing breaks — read them semantically:

| Token | Value | Means |
|---|---|---|
| `--void` | `#F4F0E8` | app background, warm paper |
| `--ground` | `#EAE4D8` | map ground |
| `--bldg` / `--bldg-edge` | `#D9D1C3` / `#C7BEAD` | ordinary buildings |
| `--gold` | `#C0562F` | **terracotta — the accent.** The student's own class buildings AND primary buttons. Nothing else. |
| `--cyan` | `#4E7A66` | sage — tour stops / places |
| `--path` | `#D7CFC0` | footpaths |
| `--text` / `--text-dim` | `#23211C` / `#6B655B` | ink |
| `--glass` | `rgba(255,253,249,.90)` | card surfaces |
| `--shadow` / `--shadow-lg` | warm soft shadows | depth |

**Two accents, total.** Terracotta = *yours*. Sage = *places*. Everything else is paper and ink.

Because the background is now light:
- **Delete every glow.** `box-shadow: 0 0 14px rgba(...)` reads as smudge on paper. Depth comes
  from soft *downward* shadows (`--shadow`) and hairline borders (`--glass-border`).
- Re-check every contrast ratio. Light-grey-on-beige is invisible; body text must be `--text`
  or `--text-dim`, never a hairline colour.
- Translucent cards need a light blur over a light map — raise opacity until text is crisp.

## 2. The behaviour — "a 5 year old can use it"

This is the harder half of the ask. Rules:

1. **One primary action per screen, and it is obvious.** Big, filled terracotta, full-width,
   with a plain-language label. Everything else is quiet.
2. **Plain words, not jargon.** "Take me there", not "Route". "My week", not "Scrubber".
3. **Fewer things.** If a control isn't needed to answer *"where is my next class?"*, it does
   not belong in the default view. Move it behind an expansion or delete it.
4. **Nothing floating over the map that can be avoided.** Overlapping panels were the single
   biggest complaint. Prefer one surface.
5. **Every tap does something visible and reversible**, and never surprises the user by exiting.
6. Minimum tap target 44×44 px. Type: nothing important below 15 px.

## 3. Known bugs this redesign must fix

- **The tour kicks the user out.** Tapping the screen currently *cancels* the tour. Users tap
  to advance. Tap must mean **next stop**; only an explicit, visible Done/✕ exits.
- **The tour opens on "a random place."** Stop 1 is the bus loop, whose coordinate is derived,
  not surveyed — it's an unlabelled patch of road. Start somewhere the student recognises.
- Panels have repeatedly overlapped each other. Fewer floating surfaces fixes this by design.

## 4. Non-negotiables (do not regress)

- Terracotta is reserved for the student's three class buildings and primary buttons.
- The app must stay fully offline-capable — no new network requests, no external assets.
- `#sheet` must keep writing `data-detent` (`peek|half|full`); `main.ts` depends on it.
- `#topbar` keeps `pointer-events: none` with `> * { pointer-events: auto }` so map gestures
  pass through empty bar space. An E2E test asserts the tour button is hit-testable.
- Never put a `transition` or `@keyframes` on `transform` for a MapLibre marker element —
  MapLibre owns that property and animating it detaches the marker from the map. See the rule
  at the top of `src/map/map.css`.
- 130 unit tests and 25 E2E tests currently pass. Keep them passing.
