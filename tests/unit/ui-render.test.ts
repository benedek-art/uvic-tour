// @vitest-environment jsdom
/**
 * Smoke test for the bottom sheet. Deliberately shallow: it proves the sheet mounts,
 * renders the hero card and all five class rows, and survives the awkward `pre-term`
 * state — the one `NowState` variant with no countdown and no "today". Behavioural
 * depth lives in the E2E suite, which drives a real browser.
 */
import { describe, expect, it } from 'vitest'
import { createStore } from '../../src/ui/store'
import { mountSheet, type AppState } from '../../src/ui/sheet'

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

function mount(now: Date): HTMLElement {
  const root = document.createElement('main')
  root.id = 'sheet'
  root.setAttribute('data-testid', 'bottom-sheet')
  root.hidden = true
  document.body.append(root)

  mountSheet(root, {
    store: createStore(initialState(now)),
    onSelect: () => {},
    onRoute: () => {},
  })
  return root
}

describe('mountSheet', () => {
  it('renders the Now/Next card', () => {
    const root = mount(new Date('2026-09-14T16:00:00-07:00')) // Mon 16:00, in term
    const card = root.querySelector('[data-testid="now-next"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('PSYC 100B')
    expect(root.hidden).toBe(false)
  })

  it('renders exactly five class rows', () => {
    const root = mount(new Date('2026-09-14T16:00:00-07:00'))
    expect(root.querySelectorAll('[data-testid="class-row"]')).toHaveLength(5)
  })

  it('renders the pre-term state without throwing', () => {
    const root = mount(new Date('2026-08-20T12:00:00-07:00')) // before Sep 9
    const card = root.querySelector('[data-testid="now-next"]')
    expect(card?.textContent).toContain('TERM STARTS SEP 9')
    expect(card?.textContent).toContain('BIOL 184') // the first Monday preview
  })

  it('keeps exactly one transition note on the page', () => {
    const root = mount(new Date('2026-09-14T16:00:00-07:00'))
    expect(root.querySelectorAll('[data-testid="transition-note"]')).toHaveLength(1)
  })
})
