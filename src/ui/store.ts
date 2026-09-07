/**
 * Minimal reactive store. Deliberately ~30 lines — this app doesn't need a framework.
 * Subscribers fire on every set(); components re-render themselves from the new state.
 */
export interface Store<T> {
  get(): T
  set(patch: Partial<T>): void
  subscribe(fn: (s: T) => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const subs = new Set<(s: T) => void>()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch }
      for (const fn of subs) fn(state)
    },
    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
  }
}
