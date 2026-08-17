import { useState, useCallback } from 'react';

export function useHistory<T>(initialState: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initialState);
  const [future, setFuture] = useState<T[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const undo = useCallback(() => {
    if (!canUndo) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    
    setPast(newPast);
    setFuture([present, ...future]);
    setPresent(previous);
  }, [past, present, future, canUndo]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const next = future[0];
    const newFuture = future.slice(1);
    
    setPast([...past, present]);
    setPresent(next);
    setFuture(newFuture);
  }, [past, present, future, canRedo]);

  const set = useCallback((newState: T | ((current: T) => T)) => {
    const resolvedState = typeof newState === 'function' ? (newState as Function)(present) : newState;
    
    // Only push to history if state actually changed (shallow check is usually enough, but we assume new object)
    setPast(currentPast => [...currentPast, present]);
    setPresent(resolvedState);
    setFuture([]);
  }, [present]);

  // Force reset history (e.g. when loading from draft)
  const reset = useCallback((newState: T) => {
    setPast([]);
    setPresent(newState);
    setFuture([]);
  }, []);

  return { state: present, set, undo, redo, canUndo, canRedo, reset };
}
