/**
 * A store with subscriptions instead of a context with a value.
 *
 * React's context is all-or-nothing: when its value changes, every consumer
 * re-renders, whether or not the part they read was the part that moved. In an
 * editor that is exactly wrong — nudging a colour rebuilds every panel, the
 * preview, and every screen that happened to reach for one action off the same
 * context.
 *
 * So state lives outside React, and a component asks for the slice it actually
 * uses. `useSlice` re-renders it only when that slice changes.
 *
 * This is the same shape as the atomic libraries (a store, a selector, a
 * subscription) in about forty lines, which is less than the dependency would
 * have been and does not need to be learned.
 */

import { useEffect, useRef, useState } from "react";

export interface Store<T> {
  /** The current state. */
  get(): T;
  /** Replace the state; listeners are told, and only those whose slice moved re-render. */
  set(next: T | ((cur: T) => T)): void;
  /** Called on every change. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (cur: T) => T)(state) : next;
      if (value === state) return;
      state = value;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Cheap structural equality: one level deep, which is all a slice needs. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Subscribe to one slice of a store.
 *
 * `useSyncExternalStore` is the React-blessed way to read from something that
 * is not React state; the `useState`/`useEffect` pair below is what keeps a
 * returned object from being treated as new every time (the snapshot must be
 * referentially stable, and a selector that builds an object is not).
 */
export function useSlice<T, R>(store: Store<T>, selector: (s: T) => R): R {
  const [value, setValue] = useState(() => selector(store.get()));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  useEffect(
    () =>
      store.subscribe(() => {
        const next = selectorRef.current(store.get());
        setValue((prev) => (shallowEqual(prev, next) ? prev : next));
      }),
    [store],
  );
  // A render can start before the subscription is set up (a store written to
  // during render, or a selector that changed identity), so the value is
  // refreshed here rather than only in the listener.
  const latest = selector(store.get());
  if (!shallowEqual(latest, value)) setValue(latest);
  return value;
}
