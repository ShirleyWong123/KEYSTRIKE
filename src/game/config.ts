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

export const scoreForCompletion = (length: number, level: number, comboBefore: number): number =>
  Math.round(length * 25 * (1 + (level - 1) * 0.1) * (1 + Math.min(comboBefore, 20) * 0.05));
