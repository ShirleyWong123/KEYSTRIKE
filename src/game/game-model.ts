import { LEVELS, scoreForCompletion } from './config';
import { findLockCandidate, TargetManager } from './target-manager';
import type { Difficulty, GameEvent, GamePhase, GameSettings, GameSnapshot, Target } from './types';

const COUNTDOWN_MS = 3_000;
const INITIAL_SHIELD = 100;
const BREACH_DAMAGE = 20;
const LETTER_SCORE = 10;

const tutorialWordFor = (difficulty: Difficulty): string => ({
  easy: 'NOVA',
  normal: 'ORBIT',
  hard: 'VECTOR',
})[difficulty];

const isValidDelta = (deltaMs: number): boolean => Number.isFinite(deltaMs) && deltaMs >= 0;

const cloneTarget = (target: Target): Target => ({ ...target });

const cloneEvent = (event: GameEvent): GameEvent =>
  event.type === 'destroyed' || event.type === 'breach'
    ? { ...event, target: cloneTarget(event.target) }
    : event.type === 'special'
      ? { ...event, affectedIds: [...event.affectedIds] }
      : { ...event };

export interface KeyInput {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Test/debug-only controls. They exist so deterministic tests and manual debug
 * tools can set up combat state without exposing controls in the production UI.
 */
export interface GameModelTestApi {
  injectTarget(target: Target): void;
  advanceCountdown(deltaMs: number): void;
}

/** Owns all authoritative, deterministic run state and emits immutable effect events. */
export class GameModel implements GameModelTestApi {
  private readonly targetManager: TargetManager;
  private settings: GameSettings | null = null;
  private phase: GamePhase = 'menu';
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private shield = INITIAL_SHIELD;
  private level = 1;
  private activeMs = 0;
  private correctKeys = 0;
  private wrongKeys = 0;
  private completedWords = 0;
  private missedWords = 0;
  private lockedTargetId: number | null = null;
  private freezeRemainingMs = 0;
  private countdownRemainingMs = 0;
  private targets: Target[] = [];
  private events: GameEvent[] = [];

  constructor(targetManager: TargetManager = new TargetManager()) {
    this.targetManager = targetManager;
  }

  start(settings: GameSettings): void {
    this.settings = { ...settings };
    this.resetRun('countdown');
    this.countdownRemainingMs = COUNTDOWN_MS;
    this.targets = [this.createTutorialTarget(settings.difficulty)];
  }

  beginCombat(): void {
    if (this.phase !== 'countdown') return;
    this.countdownRemainingMs = 0;
    this.phase = 'playing';
  }

  handleKey(input: string | KeyInput): void {
    const keyInput = typeof input === 'string' ? { key: input } : input;
    if (keyInput.repeat || keyInput.altKey || keyInput.ctrlKey || keyInput.metaKey) return;

    if (keyInput.key === 'Escape' || keyInput.key === 'Esc') {
      if (this.phase === 'playing') this.pause();
      else if (this.phase === 'paused') this.resume();
      return;
    }

    if (this.phase !== 'playing' || !/^[a-zA-Z]$/.test(keyInput.key)) return;
    this.handleLetter(keyInput.key.toLowerCase());
  }

  update(deltaMs: number): void {
    if (!isValidDelta(deltaMs)) return;
    if (this.phase === 'countdown') {
      this.advanceCountdown(deltaMs);
      return;
    }
    if (this.phase !== 'playing') return;

    this.activeMs += deltaMs;
    const movement = this.targetManager.update(this.targets, deltaMs, 1);
    this.targets = movement.active;
    for (const breached of movement.breached) this.applyBreach(breached);
  }

  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  restart(): void {
    if (this.settings) this.start(this.settings);
  }

  returnToMenu(): void {
    this.settings = null;
    this.resetRun('menu');
  }

  drainEvents(): GameEvent[] {
    const drained = this.events.map(cloneEvent);
    this.events = [];
    return drained;
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      shield: this.shield,
      level: this.level,
      activeMs: this.activeMs,
      correctKeys: this.correctKeys,
      wrongKeys: this.wrongKeys,
      completedWords: this.completedWords,
      missedWords: this.missedWords,
      lockedTargetId: this.lockedTargetId,
      freezeRemainingMs: this.freezeRemainingMs,
      targets: this.targets.map(cloneTarget),
    };
  }

  /** Test/debug-only: inserts a fully specified target; production UI does not call this. */
  injectTarget(target: Target): void {
    const copied = cloneTarget(target);
    const existingIndex = this.targets.findIndex(({ id }) => id === copied.id);
    if (existingIndex === -1) this.targets.push(copied);
    else this.targets[existingIndex] = copied;
  }

  /** Test/debug-only: advances only countdown state and never active combat time. */
  advanceCountdown(deltaMs: number): void {
    if (this.phase !== 'countdown' || !isValidDelta(deltaMs)) return;
    this.countdownRemainingMs = Math.max(0, this.countdownRemainingMs - deltaMs);
    if (this.countdownRemainingMs === 0) this.phase = 'playing';
  }

  private resetRun(phase: GamePhase): void {
    this.phase = phase;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.shield = INITIAL_SHIELD;
    this.level = 1;
    this.activeMs = 0;
    this.correctKeys = 0;
    this.wrongKeys = 0;
    this.completedWords = 0;
    this.missedWords = 0;
    this.lockedTargetId = null;
    this.freezeRemainingMs = 0;
    this.countdownRemainingMs = 0;
    this.targets = [];
    this.events = [];
  }

  private createTutorialTarget(difficulty: Difficulty): Target {
    const word = tutorialWordFor(difficulty);
    return {
      id: 1,
      word,
      typed: 0,
      x: 240 - (word.length * 10) / 2,
      y: -36,
      width: word.length * 10,
      height: 36,
      speed: LEVELS[0].speed * 0.7,
      kind: 'normal',
      tutorial: true,
    };
  }

  private handleLetter(letter: string): void {
    const locked = this.lockedTargetId === null
      ? this.findAndLock(letter)
      : this.targets.find(({ id }) => id === this.lockedTargetId) ?? null;

    if (!locked || locked.word[locked.typed]?.toLowerCase() !== letter) {
      this.registerWrongLetter();
      return;
    }

    locked.typed += 1;
    this.correctKeys += 1;
    this.score += LETTER_SCORE;
    this.events.push({ type: 'shot', targetId: locked.id, progress: locked.typed });
    if (locked.typed === locked.word.length) this.completeTarget(locked);
  }

  private findAndLock(letter: string): Target | null {
    const normalizedTargets = this.targets.map((target) => ({ ...target, word: target.word.toLowerCase() }));
    const candidate = findLockCandidate(normalizedTargets, letter);
    if (!candidate) return null;
    const target = this.targets.find(({ id }) => id === candidate.id) ?? null;
    if (target) this.lockedTargetId = target.id;
    return target;
  }

  private registerWrongLetter(): void {
    this.combo = 0;
    this.wrongKeys += 1;
    this.events.push({ type: 'error' });
  }

  private completeTarget(target: Target): void {
    this.targets = this.targets.filter(({ id }) => id !== target.id);
    if (this.lockedTargetId === target.id) this.lockedTargetId = null;
    this.score += scoreForCompletion(target.word.length, this.level, this.combo);
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.completedWords += 1;
    this.events.push({ type: 'destroyed', target: cloneTarget(target) });
  }

  private applyBreach(target: Target): void {
    if (this.lockedTargetId === target.id) this.lockedTargetId = null;
    this.shield = Math.max(0, this.shield - BREACH_DAMAGE);
    this.combo = 0;
    this.missedWords += 1;
    this.events.push({ type: 'breach', target: cloneTarget(target) });
    if (this.shield === 0) this.phase = 'gameover';
  }
}
