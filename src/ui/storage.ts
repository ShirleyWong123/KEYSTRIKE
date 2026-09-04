import type { Difficulty } from '../game/types';

const SETTINGS_KEY = 'keystrike.settings';
const HIGH_SCORE_PREFIX = 'keystrike.highScore.';

export interface StoredSettings {
  soundEnabled: boolean;
  reducedMotion: boolean;
}

const isStoredSettings = (value: unknown): value is StoredSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredSettings>;
  return typeof candidate.soundEnabled === 'boolean' && typeof candidate.reducedMotion === 'boolean';
};

const validScore = (value: unknown): number => {
  const score = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(score) && score >= 0 ? Math.floor(score) : 0;
};

/** A fail-open browser-storage boundary: persistence failures never block play. */
export class StorageAdapter {
  private readonly highScores = new Map<Difficulty, number>();

  constructor(
    private readonly storage: Storage | null,
    private readonly systemReducedMotion: boolean,
  ) {}

  loadSettings(): StoredSettings {
    const fallback = { soundEnabled: true, reducedMotion: this.systemReducedMotion };
    try {
      const serialized = this.storage?.getItem(SETTINGS_KEY);
      if (!serialized) return fallback;
      const parsed: unknown = JSON.parse(serialized);
      return isStoredSettings(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  saveSettings(settings: StoredSettings): void {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Browsers can deny or exhaust storage; the current in-memory setting still applies.
    }
  }

  loadHighScore(difficulty: Difficulty): number {
    const inMemory = this.highScores.get(difficulty) ?? 0;
    try {
      const persisted = validScore(this.storage?.getItem(this.highScoreKey(difficulty)));
      const highScore = Math.max(inMemory, persisted);
      this.highScores.set(difficulty, highScore);
      return highScore;
    } catch {
      return inMemory;
    }
  }

  saveHighScore(difficulty: Difficulty, score: number): number {
    const previous = this.loadHighScore(difficulty);
    const next = Math.max(previous, validScore(score));
    if (next === previous) return previous;
    this.highScores.set(difficulty, next);
    try {
      this.storage?.setItem(this.highScoreKey(difficulty), String(next));
    } catch {
      // The score remains valid for the current result screen even if persistence is unavailable.
    }
    return next;
  }

  private highScoreKey(difficulty: Difficulty): string {
    return `${HIGH_SCORE_PREFIX}${difficulty}`;
  }
}
