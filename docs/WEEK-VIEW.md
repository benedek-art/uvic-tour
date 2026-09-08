# The sheet, rebuilt as a week view

Direction from the owner:
> *"Let's rebuild the popup because it doesn't make sense. Can we make it a week view
> basically with where to go and when. It's essentially the thing we have but improved.
> Can we make the popup have necessities and some cool-to-have features. They should be
> able to open up the app and understand everything in 2 mins."*

## The standard

**A stranger opens this app and in two minutes understands their entire week.** That is the
bar. Not "can find the information if they hunt" — *understands*, by scrolling once.

## Why the current sheet fails

It splits one question across three surfaces: a hero card (next class), a flat list of five
courses in no useful order, and a separate floating "My week" pill holding the timeline.
Nothing shows the *shape* of a week — that Monday starts at 08:30 and has a six-hour hole in
it, that Wednesday is the heavy day, that two Monday classes are in the same room.

## The new structure

**One surface. Three tiers, in this order.**

### Tier 1 — Peek: the answer (unchanged, it works)
Next class, where, when, leave-by, and one big terracotta **"Take me there"**.

### Tier 2 — The week view (this is the rebuild)
Scroll down from the peek and see all five days, in order, without tapping anything.

Per day: a header (day name, class count, and a `Today` marker when it is today), then each
class as a row, with the **gaps between them shown as their own rows** — because the gaps are
half of what "where to go and when" means.

A class row carries, in priority order:
1. **Time** — `08:30`, mono, tabular
2. **Building, in plain words** — `Bob Wright Centre` (never `BWC`)
3. **Room** — `Room B150`
4. Course code + title, quieter
5. A moon marker if it ends after dark

A gap row between two classes says one of:
- `Stay put — same room` (Monday 17:50 → 18:00)
- `4 min walk` (with the real routed number)
- `6h 40m free` for long gaps
It is visually a connector, not a card — the eye should read straight down the day.

**Necessities** (must be present): every class, its time, its building in plain words, its
room, walk time between consecutive classes, and which day is today.

**Cool-to-have** (include what earns its place, cut what clutters): a "now" line on today's
row, free-gap durations, the dark-walk moon, tapping a day header to light that day's
buildings on the map, and a one-line week summary at the top of the tier
(e.g. *"5 classes · 3 buildings · Wednesday is your longest day"*) as an orientation anchor.

### Tier 3 — Class detail (on tap)
Building, room, the hand-written room-finding directions, walk buttons. Already good; keep it.

## What gets deleted

**The floating "My week" pill and its timeline panel go away.** Its job is now the week view's
job. Day focus moves to tapping a day header. This removes the last floating surface that
overlaps the map, which has caused repeated bugs.

## Rules

- **Plain language.** Building names, not codes. "Stay put", not "same-room transition".
- **One primary action on screen** — the terracotta "Take me there". Nothing else is filled.
- Warm Paper palette from `src/tokens.css`. **No raw hex. No glows.** Two accents only:
  terracotta `--gold` = yours/primary, sage `--cyan` = places.
- Minimum tap target 44×44 px; nothing important below 15 px.
- Scanning beats interaction: information visible by scrolling always beats information
  behind a tap.
