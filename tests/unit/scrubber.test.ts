// @vitest-environment jsdom
/**
 * Smoke test for the week scrubber (src/ui/scrubber.ts).
 *
 * Deliberately focused: it checks the three things that break silently and would be
 * invisible in a screenshot — the day pills exist, each day renders the right number of
 * class blocks, and the minutes -> pixels math puts an 08:30 class exactly where it
 * belongs on a 07:00-21:00 track. Plus the two interactions that drive the map:
 * pointer-dragging and "back to now".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountScrubber, type ScrubberState } from '../../src/ui/scrubber'
import { createStore } from '../../src/ui/store'
import type { Day } from '../../src/data/schedule'

/** 2026-09-14 is a Monday. 15:30 UTC is 08:30 in America/Vancouver — mid BIOL 184. */
const MONDAY_0830 = new Date('2026-09-14T15:30:00Z')

/** Track width in the fake layout: 840px, so one pixel is exactly one minute. */
const TRACK_LEFT = 0
const TRACK_WIDTH = 840

function setup(state: Partial<ScrubberState> = {}) {
  const root = document.createElement('div')
  root.id = 'scrubber'
  root.hidden = true
  document.body.append(root)

  const store = createStore<ScrubberState>({
    scrubMinutes: null,
    scrubDay: 'Mon',
    now: MONDAY_0830,
    ...state,
  })
  const onScrub = vi.fn<(day: Day, minutes: number | null) => void>()
  mountScrubber(root, { store, onScrub })
  return { root, store, onScrub }
}

/** jsdom does no layout, so give the track a deterministic box to measure against. */
function stubTrack(root: HTMLElement, day: Day): HTMLElement {
  const track = root.querySelector<HTMLElement>(`.scrub__track[data-day="${day}"]`)
  if (!track) throw new Error(`no track for ${day}`)
  track.getBoundingClientRect = () =>
    ({ left: TRACK_LEFT, width: TRACK_WIDTH, top: 0, height: 34, right: TRACK_WIDTH, bottom: 34, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return track
}

beforeEach(() => { document.body.replaceChildren() })
afterEach(() => { vi.restoreAllMocks() })

describe('mountScrubber', () => {
  it('unhides the host element', () => {
    const { root } = setup()
    expect(root.hidden).toBe(false)
  })

  it('renders five day pills, Monday first', () => {
    const { root } = setup()
    const pills = [...root.querySelectorAll('.scrub__pill')]
    expect(pills).toHaveLength(5)
    expect(pills.map((p) => p.textContent)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI'])
  })

  it('renders the real number of class blocks for every day', () => {
    const { root } = setup()
    const count = (day: Day) => root.querySelectorAll(`.scrub__row[data-day="${day}"] .scrub__block`).length
    // The student's actual Fall 2026 registration: Mon 3, Tue 2, Wed 3, Thu 2, Fri 2.
    expect({ Mon: count('Mon'), Tue: count('Tue'), Wed: count('Wed'), Thu: count('Thu'), Fri: count('Fri') })
      .toEqual({ Mon: 3, Tue: 2, Wed: 3, Thu: 2, Fri: 2 })
  })

  it('positions an 08:30 block at (510 - 420) / 840 of the track', () => {
    const { root } = setup()
    const block = root.querySelector<HTMLElement>('.scrub__row[data-day="Mon"] .scrub__block[data-start="510"]')
    expect(block).not.toBeNull()
    // (510 - 420) / (1260 - 420) = 10.714285...%
    expect(block?.style.left).toBe('10.7143%')
    // BIOL 184 runs 08:30-09:50 => 80 minutes of an 840-minute window.
    expect(block?.style.width).toBe('9.5238%')
  })

  it('colours the Monday PSYC -> PSYC handoff as a calm same-room marker', () => {
    const { root } = setup()
    const markers = [...root.querySelectorAll('.scrub__row[data-day="Mon"] .scrub__marker')]
    expect(markers).toHaveLength(2)
    expect(markers[1]?.className).toContain('scrub__marker--same-room')
    expect(markers.some((m) => m.className.includes('impossible'))).toBe(false)
  })

  it('scrubs to the minute under the pointer on pointerdown', () => {
    const { root, onScrub } = setup()
    const track = stubTrack(root, 'Mon')
    // Halfway across a 07:00-21:00 track is 14:00 = 840 minutes from midnight.
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 420, button: 0, bubbles: true }))
    expect(onScrub).toHaveBeenCalledWith('Mon', 840)
  })

  it('snaps to a class start when the block itself is tapped', () => {
    const { root, onScrub } = setup()
    stubTrack(root, 'Mon')
    const block = root.querySelector<HTMLElement>('.scrub__block[data-start="990"]')
    // 16:30 PSYC 100B. The pointer lands at a pixel meaning 07:00, but the tap must win.
    block?.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, button: 0, bubbles: true }))
    expect(onScrub).toHaveBeenCalledWith('Mon', 990)
  })

  it('hides "back to now" while live and offers it once scrubbed', () => {
    const live = setup()
    expect(live.root.querySelector<HTMLElement>('.scrub__back')?.hidden).toBe(true)

    document.body.replaceChildren()
    const scrubbed = setup({ scrubMinutes: 990 })
    const back = scrubbed.root.querySelector<HTMLButtonElement>('.scrub__back')
    expect(back?.hidden).toBe(false)
    back?.click()
    expect(scrubbed.onScrub).toHaveBeenCalledWith('Mon', null)
  })

  it('shows the live clock time when nothing is scrubbed', () => {
    const { root } = setup()
    expect(root.querySelector('.scrub__clock')?.textContent).toBe('08:30')
    expect(root.querySelector('.scrub__status')?.textContent).toBe('LIVE')
  })

  it('re-renders from the store when the orchestrator sets a scrub time', () => {
    const { root, store } = setup()
    store.set({ scrubMinutes: 1080 }) // 18:00 — PSYC 100A, MacLaurin A144
    expect(root.querySelector('.scrub__clock')?.textContent).toBe('18:00')
    const lit = root.querySelectorAll('.scrub__row[data-day="Mon"] .scrub__block.is-lit')
    expect(lit).toHaveLength(1)
    expect((lit[0] as HTMLElement | undefined)?.dataset['start']).toBe('1080')
  })
})
