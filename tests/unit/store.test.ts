import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../../src/ui/store'

describe('createStore', () => {
  it('exposes the initial state', () => {
    expect(createStore({ a: 1 }).get()).toEqual({ a: 1 })
  })
  it('merges patches', () => {
    const s = createStore({ a: 1, b: 2 })
    s.set({ b: 9 })
    expect(s.get()).toEqual({ a: 1, b: 9 })
  })
  it('notifies subscribers on change', () => {
    const s = createStore({ a: 1 })
    const spy = vi.fn()
    s.subscribe(spy)
    s.set({ a: 2 })
    expect(spy).toHaveBeenCalledWith({ a: 2 })
  })
  it('stops notifying after unsubscribe', () => {
    const s = createStore({ a: 1 })
    const spy = vi.fn()
    s.subscribe(spy)()
    s.set({ a: 3 })
    expect(spy).not.toHaveBeenCalled()
  })
  it('supports multiple independent subscribers', () => {
    const s = createStore({ a: 1 })
    const one = vi.fn(); const two = vi.fn()
    s.subscribe(one); s.subscribe(two)
    s.set({ a: 5 })
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(1)
  })
})
