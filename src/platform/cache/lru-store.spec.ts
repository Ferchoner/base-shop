import { LruStore } from './lru-store.js';

describe('LruStore (ADR-0129)', () => {
  it('keeps at most its limit, dropping the value used least recently', () => {
    const store = new LruStore(2);
    store.set('a', 1);
    store.set('b', 2);

    expect(store.get('a')).toBe(1);
    store.set('c', 3);

    expect(store.size).toBe(2);
    expect(store.get('b')).toBeUndefined();
    expect(store.get('a')).toBe(1);
    expect(store.get('c')).toBe(3);
  });

  it('counts writing a key again as a use, without taking another place', () => {
    const store = new LruStore(2);
    store.set('a', 1);
    store.set('b', 2);
    store.set('a', 10);
    store.set('c', 3);

    expect(store.get('a')).toBe(10);
    expect(store.get('b')).toBeUndefined();
    expect(store.size).toBe(2);
  });

  it('never counts reading a missing key as a value', () => {
    const store = new LruStore(1);

    expect(store.get('missing')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('keeps a stored falsy value, and moves it like any other', () => {
    const store = new LruStore(2);
    store.set('zero', 0);
    store.set('b', 2);

    expect(store.get('zero')).toBe(0);
    store.set('c', 3);

    expect(store.get('zero')).toBe(0);
    expect(store.get('b')).toBeUndefined();
  });

  it('deletes one key or all of them', () => {
    const store = new LruStore(3);
    store.set('a', 1);
    store.set('b', 2);

    expect(store.delete('a')).toBe(true);
    expect(store.delete('a')).toBe(false);
    store.clear();

    expect(store.size).toBe(0);
    expect(store.get('b')).toBeUndefined();
  });
});
