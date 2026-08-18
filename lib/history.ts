import { useCallback, useState } from 'react';

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 50;

export function createHistory<T>(initialState: T): HistoryState<T> {
  return { past: [], present: initialState, future: [] };
}

export function pushHistory<T>(
  history: HistoryState<T>,
  next: T,
  limit = HISTORY_LIMIT,
): HistoryState<T> {
  if (Object.is(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-limit),
    present: next,
    future: [],
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future,
  };
}

export function useHistory<T>(initialState: T) {
  const [history, setHistory] = useState(() => createHistory(initialState));

  const set = useCallback((next: T | ((current: T) => T)) => {
    setHistory((current) => {
      const resolved = typeof next === 'function'
        ? (next as (value: T) => T)(current.present)
        : next;
      return pushHistory(current, resolved);
    });
  }, []);

  const replace = useCallback((next: T | ((current: T) => T)) => {
    setHistory((current) => ({
      ...current,
      present: typeof next === 'function'
        ? (next as (value: T) => T)(current.present)
        : next,
    }));
  }, []);

  const checkpoint = useCallback((previous: T) => {
    setHistory((current) => (
      Object.is(previous, current.present)
        ? current
        : {
            past: [...current.past, previous].slice(-HISTORY_LIMIT),
            present: current.present,
            future: [],
          }
    ));
  }, []);

  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);
  const reset = useCallback((next: T) => setHistory(createHistory(next)), []);

  return {
    state: history.present,
    set,
    replace,
    checkpoint,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    reset,
  };
}
