export type Difficulty = 'easy' | 'normal' | 'hard';
export type TargetKind = 'normal' | 'repair' | 'pulse' | 'freeze';
export type GamePhase = 'menu' | 'countdown' | 'playing' | 'paused' | 'gameover';

export interface Target {
  id: number;
  word: string;
  typed: number;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  kind: TargetKind;
  tutorial?: boolean;
}

export type GameEvent =
  | { type: 'shot'; targetId: number; progress: number }
  | { type: 'error' }
  | { type: 'destroyed'; target: Target }
  | { type: 'breach'; target: Target }
  | { type: 'level-up'; level: number }
  | { type: 'special'; kind: Exclude<TargetKind, 'normal'>; affectedIds: number[] };

export interface GameSettings {
  difficulty: Difficulty;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

export interface GameSnapshot {
  phase: GamePhase;
  score: number;
  combo: number;
  maxCombo: number;
  shield: number;
  level: number;
  activeMs: number;
  correctKeys: number;
  wrongKeys: number;
  completedWords: number;
  missedWords: number;
  lockedTargetId: number | null;
  freezeRemainingMs: number;
  targets: readonly Target[];
}
