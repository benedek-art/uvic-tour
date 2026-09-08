// @vitest-environment jsdom
/**
 * The week view is the surface the whole app is judged on: a stranger scrolls it once
 * and understands their week (docs/WEEK-VIEW.md). These tests assert the facts that
 * claim depends on — that all five days are there without tapping, that Monday shows
 * its six-hour hole and its stay-put pair, that every class names a building a human
 * can say out loud and a room they can look for, and that the two callbacks fire.
 */
import { describe, expect, it } from 'vitest'
import { createStore } from '../../src/ui/store'
import { mountWeekView } from '../../src/ui/week-view'
import type { AppState } from '../../src/ui/sheet'
import type { Day } from '../../src/data/schedule'
import type { Session } from '../../src/core/week'

/** Monday 16:00 of a real term week — in term, mid-Monday, so "Today" is live. */
const MONDAY = new Date('2026-09-14T16:00:00-07:00')

function initialState(now: Date): AppState {
  return {
    now,
    selected: null,
    scrubMinutes: null,
    scrubDay: 'Mon',
    layers: { pois: true, paths: true },
    tourPlaying: false,
  }
}

interface Mounted {
  root: HTMLElement
  picked: Session[]
  focused: Day[]
  destroy(): void
}

function mount(now: Date = MONDAY): Mounted {
  const root = document.createElement('div')
  document.body.append(root)
  const picked: Session[] = []
  const focused: Day[] = []
  const view = mountWeekView(root, {
    store: createStore(initialState(now)),
    onSelectSession: (s) => picked.push(s),
    onFocusDay: (d) => focused.push(d),
  })
  return {
    root,
    picked,
    focused,
    destroy() {
      view.destroy()
      root.remove()
    },
  }
}

/** The `<section data-testid="week-day">` for one weekday. */
function daySection(root: HTMLElement, day: Day): HTMLElement {
  const section = root.querySelector<HTMLElement>(`[data-testid="week-day"][data-day="${day}"]`)
  if (!section) throw new Error(`no day section for ${day}`)
  return section
}

const text = (n: Element | null): string => n?.textContent ?? ''

describe('mountWeekView', () => {
  it('renders all five days, in order, without tapping anything', () => {
    const m = mount()
    const days = [...m.root.querySelectorAll('[data-testid="week-day"]')]
    expect(days).toHaveLength(5)
    expect(days.map((d) => (d as HTMLElement).dataset['day'])).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
    ])
    expect(days.map((d) => text(d.querySelector('.wk-dayname')))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ])
    m.destroy()
  })

  it('shows Monday as 3 class rows separated by 2 gap rows', () => {
    const m = mount()
    const mon = daySection(m.root, 'Mon')
    expect(mon.querySelectorAll('[data-testid="week-class-row"]')).toHaveLength(3)
    expect(mon.querySelectorAll('[data-testid="week-gap-row"]')).toHaveLength(2)

    // Read straight down the day: class, gap, class, gap, class.
    const kinds = [...mon.querySelectorAll('.wk-rows > li')].map((li) =>
      li.classList.contains('wk-gap') ? 'gap' : 'class',
    )
    expect(kinds).toEqual(['class', 'gap', 'class', 'gap', 'class'])
    m.destroy()
  })

  it("renders Monday's six-hour hole as free time, not as a walk", () => {
    const m = mount()
    const gaps = [...daySection(m.root, 'Mon').querySelectorAll('[data-testid="week-gap-row"]')]
    const hole = gaps[0]!
    expect(text(hole.querySelector('.wk-gap-head'))).toBe('6h 40m free')
    expect(hole.getAttribute('data-free')).toBe('true')
    m.destroy()
  })

  it('renders the Monday 17:50 -> 18:00 gap as stay-put / same-room', () => {
    const m = mount()
    const gaps = [...daySection(m.root, 'Mon').querySelectorAll('[data-testid="week-gap-row"]')]
    const stayPut = gaps[1]!
    expect(stayPut.getAttribute('data-kind')).toBe('same-room')
    expect(text(stayPut)).toContain('Stay put — same room')
    // A stay-put is not a walk: no walking minutes anywhere on the row.
    expect(text(stayPut)).not.toMatch(/walk/i)
    m.destroy()
  })

  it('names every class by building in full words and by room', () => {
    const m = mount()
    const rows = [...m.root.querySelectorAll('[data-testid="week-class-row"]')]
    // Five courses spread over Mon-Fri: 3 + 2 + 3 + 2 + 2.
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      const building = text(row.querySelector('.wk-bldg'))
      const room = text(row.querySelector('.wk-room'))
      expect(building).toMatch(/Bob Wright Centre|MacLaurin Building|Engineering & Computer/)
      expect(building).not.toMatch(/\bBWC\b|\bMAC\b|\bECS\b/)
      expect(room).toMatch(/^Room \S+$/)
      expect(text(row.querySelector('.wk-start'))).toMatch(/^\d{2}:\d{2}$/)
    }

    const first = daySection(m.root, 'Mon').querySelector('[data-testid="week-class-row"]')!
    expect(text(first.querySelector('.wk-start'))).toBe('08:30')
    expect(text(first.querySelector('.wk-bldg'))).toBe('Bob Wright Centre')
    expect(text(first.querySelector('.wk-room'))).toBe('Room B150')
    m.destroy()
  })

  it('derives a one-line week summary', () => {
    const m = mount()
    const summary = text(m.root.querySelector('[data-testid="week-summary"]'))
    expect(summary).toContain('5 courses')
    expect(summary).toContain('3 buildings')
    expect(summary).toContain('Monday is your longest day')
    m.destroy()
  })

  it('marks today, and only today', () => {
    const m = mount()
    const marked = [...m.root.querySelectorAll('[data-testid="week-day"]')].filter(
      (d) => !d.querySelector<HTMLElement>('.wk-today')!.hidden,
    )
    expect(marked).toHaveLength(1)
    expect((marked[0] as HTMLElement).dataset['day']).toBe('Mon')
    m.destroy()
  })

  it('calls onSelectSession when a class row is tapped', () => {
    const m = mount()
    const row = daySection(m.root, 'Wed').querySelectorAll<HTMLButtonElement>(
      '[data-testid="week-class-row"]',
    )[0]!
    row.click()
    expect(m.picked).toHaveLength(1)
    expect(m.picked[0]!.course.code).toBe('ITAL 100A')
    expect(m.picked[0]!.day).toBe('Wed')
    m.destroy()
  })

  it('calls onFocusDay when a day header is tapped', () => {
    const m = mount()
    const header = daySection(m.root, 'Thu').querySelector<HTMLButtonElement>(
      '[data-testid="day-header"]',
    )!
    header.click()
    expect(m.focused).toEqual(['Thu'])
    m.destroy()
  })

  it('updates in place on a clock tick instead of rebuilding the tree', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const store = createStore(initialState(MONDAY))
    const view = mountWeekView(root, { store, onSelectSession: () => {}, onFocusDay: () => {} })

    const rows = [...root.querySelectorAll('[data-testid="week-class-row"]')]
    store.set({ now: new Date('2026-09-14T17:00:00-07:00') })
    const after = [...root.querySelectorAll('[data-testid="week-class-row"]')]
    expect(after).toHaveLength(rows.length)
    // Same element identities: nothing was thrown away and re-created.
    expect(after.every((node, i) => node === rows[i])).toBe(true)

    view.destroy()
    expect(root.querySelector('[data-testid="week-view"]')).toBeNull()
    root.remove()
  })

  it('survives the pre-term state with no Today marker', () => {
    const m = mount(new Date('2026-08-20T12:00:00-07:00'))
    expect(m.root.querySelectorAll('[data-testid="week-day"]')).toHaveLength(5)
    const marked = [...m.root.querySelectorAll('[data-testid="week-day"]')].filter(
      (d) => !d.querySelector<HTMLElement>('.wk-today')!.hidden,
    )
    expect(marked).toHaveLength(0)
    m.destroy()
  })
})
