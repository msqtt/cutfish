import { describe, expect, it } from 'vitest';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';

describe('history transitions', () => {
  it('undoes and redoes a pushed value', () => {
    const pushed = pushHistory(createHistory(1), 2);
    expect(undoHistory(pushed)).toEqual({ past: [], present: 1, future: [2] });
    expect(redoHistory(undoHistory(pushed))).toEqual(pushed);
  });

  it('clears the future when a new value is pushed', () => {
    const undone = undoHistory(pushHistory(pushHistory(createHistory(1), 2), 3));
    expect(pushHistory(undone, 4)).toEqual({ past: [1, 2], present: 4, future: [] });
  });

  it('caps retained snapshots', () => {
    let history = createHistory(0);
    for (let value = 1; value <= 60; value += 1) history = pushHistory(history, value, 10);
    expect(history.past).toHaveLength(10);
    expect(history.past[0]).toBe(50);
  });
});
