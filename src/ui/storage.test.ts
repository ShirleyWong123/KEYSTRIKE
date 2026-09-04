import { describe, expect, it } from 'vitest';
import { StorageAdapter } from './storage';

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

describe('StorageAdapter settings', () => {
  it('uses sound on and the system motion preference when storage is unavailable', () => {
    expect(new StorageAdapter(null, true).loadSettings()).toEqual({
      soundEnabled: true,
      reducedMotion: true,
    });
    expect(new StorageAdapter(null, false).loadSettings()).toEqual({
      soundEnabled: true,
      reducedMotion: false,
    });
  });

  it('falls back safely for malformed or structurally invalid settings', () => {
    const storage = memoryStorage();
    const adapter = new StorageAdapter(storage, true);

    storage.setItem('keystrike.settings', '{broken');
    expect(adapter.loadSettings()).toEqual({ soundEnabled: true, reducedMotion: true });

    storage.setItem('keystrike.settings', JSON.stringify({ soundEnabled: 'yes', reducedMotion: false }));
    expect(adapter.loadSettings()).toEqual({ soundEnabled: true, reducedMotion: true });
  });

  it('catches throwing reads and writes independently', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked read'); },
      setItem: () => { throw new Error('blocked write'); },
    } as unknown as Storage;
    const adapter = new StorageAdapter(throwing, false);

    expect(adapter.loadSettings()).toEqual({ soundEnabled: true, reducedMotion: false });
    expect(() => adapter.saveSettings({ soundEnabled: false, reducedMotion: true })).not.toThrow();
    expect(adapter.loadHighScore('normal')).toBe(0);
    expect(() => adapter.saveHighScore('normal', 200)).not.toThrow();
  });

  it('round trips valid sound and reduced-motion settings', () => {
    const adapter = new StorageAdapter(memoryStorage(), false);

    adapter.saveSettings({ soundEnabled: false, reducedMotion: true });

    expect(adapter.loadSettings()).toEqual({ soundEnabled: false, reducedMotion: true });
  });
});

describe('StorageAdapter high scores', () => {
  it('uses separate difficulty keys and never decreases a saved score', () => {
    const storage = memoryStorage();
    const adapter = new StorageAdapter(storage, false);

    expect(adapter.saveHighScore('easy', 120)).toBe(120);
    expect(adapter.saveHighScore('normal', 340)).toBe(340);
    expect(adapter.saveHighScore('hard', 560)).toBe(560);
    expect(adapter.saveHighScore('normal', 200)).toBe(340);

    expect(storage.getItem('keystrike.highScore.easy')).toBe('120');
    expect(storage.getItem('keystrike.highScore.normal')).toBe('340');
    expect(storage.getItem('keystrike.highScore.hard')).toBe('560');
  });

  it('treats malformed, negative, and non-finite score values as zero', () => {
    const storage = memoryStorage();
    const adapter = new StorageAdapter(storage, false);

    storage.setItem('keystrike.highScore.easy', 'not-a-score');
    storage.setItem('keystrike.highScore.normal', '-4');
    storage.setItem('keystrike.highScore.hard', 'Infinity');

    expect(adapter.loadHighScore('easy')).toBe(0);
    expect(adapter.loadHighScore('normal')).toBe(0);
    expect(adapter.loadHighScore('hard')).toBe(0);
  });
});
