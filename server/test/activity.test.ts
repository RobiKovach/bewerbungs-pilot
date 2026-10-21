import { describe, it, expect } from 'vitest';
import { Activity } from '../src/runtime/activity.js';

describe('Activity', () => {
  it('lists what is open and forgets it on end', () => {
    const a = new Activity();
    const endSend = a.begin('send');
    const endRestore = a.begin('restore');
    expect(a.active().sort()).toEqual(['restore', 'send']);
    endSend();
    expect(a.active()).toEqual(['restore']);
    endRestore();
    expect(a.active()).toEqual([]);
  });

  it('end is idempotent and never closes another entry with the same name', () => {
    const a = new Activity();
    const first = a.begin('send');
    a.begin('send');
    first();
    first();
    expect(a.active()).toEqual(['send']);
  });
});
