import type { Difficulty } from './types';

export const LEVELS = [
  { speed: 28, spawnMs: 2800, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2800, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2550, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2550, maxTargets: 3, longWordBoost: 0.15 },
  { speed: 32, spawnMs: 2550, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2550, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2250, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2250, maxTargets: 4, longWordBoost: 0.30 },
  { speed: 37, spawnMs: 2250, maxTargets: 5, longWordBoost: 0.30 },
  { speed: 44, spawnMs: 2250, maxTargets: 5, longWordBoost: 0.30 },
  { speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.30 },
  { speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.45 },
] as const;

export const PROJECTILE_MS = 80;

export const levelForActiveMs = (activeMs: number): number =>
  Math.min(12, 1 + Math.floor(Math.max(0, activeMs) / 45_000));

export interface DifficultyTuning {
  scoreMultiplier: number;
  specialProtectionMs: number;
  specialCooldownMs: number;
  freezeMinimumLevel: number;
}

export const difficultyTuning = (difficulty: Difficulty): DifficultyTuning => difficulty === 'hard'
  ? { scoreMultiplier: 1.25, specialProtectionMs: 10_000, specialCooldownMs: 12_000, freezeMinimumLevel: 2 }
  : { scoreMultiplier: 1, specialProtectionMs: 12_000, specialCooldownMs: 14_000, freezeMinimumLevel: 3 };

export const spawnIntervalFor = (difficulty: Difficulty, level: number): number => {
  const base = (LEVELS[Math.min(LEVELS.length, Math.max(1, Math.floor(level))) - 1] ?? LEVELS[0]).spawnMs;
  return difficulty === 'hard' ? Math.max(1_750, Math.round(base * 0.92)) : base;
};

export const msUntilNextLevel = (activeMs: number): number | null => {
  const level = levelForActiveMs(activeMs);
  return level >= LEVELS.length ? null : level * 45_000 - Math.max(0, activeMs);
};

export const scoreForLetter = (difficulty: Difficulty): number => 10 * difficultyTuning(difficulty).scoreMultiplier;

export const scoreForCompletion = (
  length: number,
  level: number,
  comboBefore: number,
  difficulty: Difficulty,
): number => {
  const aceComboMultiplier = difficulty === 'hard'
    ? comboBefore >= 15 ? 1.15 : comboBefore >= 10 ? 1.10 : comboBefore >= 5 ? 1.05 : 1
    : 1;
  return Math.round(
    length
    * 25
    * (1 + (level - 1) * 0.1)
    * (1 + Math.min(comboBefore, 20) * 0.05)
    * aceComboMultiplier
    * difficultyTuning(difficulty).scoreMultiplier,
  );
};
