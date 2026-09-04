import {
  LEVELS,
  difficultyTuning,
  levelForActiveMs,
  msUntilNextLevel,
  scoreForCompletion,
  scoreForLetter,
  spawnIntervalFor,
} from './config';
import { DEFENSE_LINE, findLockCandidate, TargetManager } from './target-manager';
import type { SpawnRequest } from './target-manager';
import type { Difficulty, GameEvent, GamePhase, GameSettings, GameSnapshot, Target, TargetKind } from './types';

const COUNTDOWN_MS = 3_000;
const INITIAL_SHIELD = 100;
const BREACH_DAMAGE = 20;
const SPECIAL_CHANCE = 0.08;

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
  attemptSpawn(): void;
  forceLevelForDebug(level: number): void;
}

export interface GameModelOptions {
  random?: () => number;
  spawnTarget?: (request: SpawnRequest) => Target | null;
  autoSpawn?: boolean;
}

/** Owns all authoritative, deterministic run state and emits immutable effect events. */
export class GameModel implements GameModelTestApi {
  private readonly targetManager: TargetManager;
  private readonly random: () => number;
  private readonly spawnTarget: (request: SpawnRequest) => Target | null;
  private readonly autoSpawn: boolean;
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
  private comboBrokenRemainingMs = 0;
  private specialHint: Exclude<TargetKind, 'normal'> | null = null;
  private specialHintRemainingMs = 0;
  private shownSpecialHints = new Set<Exclude<TargetKind, 'normal'>>();
  private freezeExpiresAtActiveMs = 0;
  private countdownRemainingMs = 0;
  private lastSpecialSpawnActiveMs: number | null = null;
  private spawnElapsedMs = 0;
  private targets: Target[] = [];
  private events: GameEvent[] = [];

  constructor(targetManager: TargetManager = new TargetManager(), options: GameModelOptions = {}) {
    this.targetManager = targetManager;
    this.random = options.random ?? Math.random;
    this.spawnTarget = options.spawnTarget ?? ((request) => this.targetManager.trySpawn(request));
    this.autoSpawn = options.autoSpawn ?? true;
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
    this.activateTutorialTarget();
  }

  handleKey(input: string | KeyInput): void {
    if (input === null || (typeof input !== 'string' && typeof input !== 'object')) return;
    const keyInput = typeof input === 'string' ? { key: input } : input;
    if (typeof keyInput.key !== 'string') return;
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
      const countdownDelta = Math.min(deltaMs, this.countdownRemainingMs);
      this.advanceCountdown(countdownDelta);
      const combatDelta = deltaMs - countdownDelta;
      if (this.countdownRemainingMs > 0 || combatDelta === 0) return;
      this.advancePlaying(combatDelta);
      return;
    }
    if (this.phase !== 'playing') return;

    this.advancePlaying(deltaMs);
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
      nextLevelRemainingMs: msUntilNextLevel(this.activeMs),
      comboBrokenRemainingMs: this.comboBrokenRemainingMs,
      specialHint: this.specialHint,
      specialHintRemainingMs: this.specialHintRemainingMs,
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
    if (this.countdownRemainingMs === 0) {
      this.phase = 'playing';
      this.activateTutorialTarget();
    }
  }

  /** Test/debug-only: attempts one ordinary target-generation opportunity. */
  attemptSpawn(): void {
    if (this.phase !== 'playing' || !this.settings) return;
    if (this.targets.some(({ tutorial }) => tutorial)) return;
    const level = LEVELS[this.level - 1] ?? LEVELS[0];
    if (this.targets.length >= level.maxTargets) return;

    const eligibleSpecials = this.eligibleSpecialKinds();
    const kind = this.canSpawnSpecial(eligibleSpecials) && this.nextRandom() < SPECIAL_CHANCE
      ? eligibleSpecials[Math.floor(this.nextRandom() * eligibleSpecials.length)]!
      : 'normal';
    const spawned = this.spawnTarget({
      difficulty: this.settings.difficulty,
      level: this.level,
      targets: this.targets,
      kind,
    });
    if (!spawned) return;
    this.targets.push(cloneTarget(spawned));
    if (kind !== 'normal') {
      this.lastSpecialSpawnActiveMs = this.activeMs;
      if (!this.shownSpecialHints.has(kind)) {
        this.shownSpecialHints.add(kind);
        this.specialHint = kind;
        this.specialHintRemainingMs = 1_600;
      }
    }
  }

  /** Test/debug-only: advances progression without simulating movement or spawn opportunities. */
  forceLevelForDebug(requestedLevel: number): void {
    if (this.phase !== 'playing' || !Number.isFinite(requestedLevel)) return;
    const targetLevel = Math.min(LEVELS.length, Math.max(this.level, Math.floor(requestedLevel)));
    if (targetLevel === this.level) return;
    for (let crossedLevel = this.level + 1; crossedLevel <= targetLevel; crossedLevel += 1) {
      this.emitLevelEvents(crossedLevel);
    }
    this.level = targetLevel;
    this.activeMs = Math.max(this.activeMs, (targetLevel - 1) * 45_000);
    this.freezeRemainingMs = Math.max(0, this.freezeExpiresAtActiveMs - this.activeMs);
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
    this.comboBrokenRemainingMs = 0;
    this.specialHint = null;
    this.specialHintRemainingMs = 0;
    this.shownSpecialHints = new Set();
    this.freezeExpiresAtActiveMs = 0;
    this.countdownRemainingMs = 0;
    this.lastSpecialSpawnActiveMs = null;
    this.spawnElapsedMs = 0;
    this.targets = [];
    this.events = [];
  }

  private createTutorialTarget(difficulty: Difficulty): Target {
    const word = tutorialWordFor(difficulty);
    return this.targetManager.createTutorialTarget(difficulty, word);
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
    this.score += Math.round(scoreForLetter(this.settings!.difficulty));
    this.events.push({ type: 'shot', targetId: locked.id, progress: locked.typed });
    if (locked.typed === locked.word.length) this.completeTarget(locked);
  }

  private advancePlaying(deltaMs: number): void {
    let remainingMs = deltaMs;
    let deferSpawnCadenceUntilNextUpdate = false;
    while (remainingMs > 0 && this.phase === 'playing') {
      this.processProgressionBoundaries();
      const freezeFactor = this.freezeExpiresAtActiveMs > this.activeMs ? 0.5 : 1;
      const segmentMs = Math.min(
        remainingMs,
        this.msUntilNextLevelBoundary(),
        this.msUntilNextSpawnOpportunity(),
        this.msUntilFreezeExpiry(),
        this.msUntilNextBreach(freezeFactor),
      );
      if (segmentMs === 0) {
        const tutorialActiveBeforeMove = this.targets.some(({ tutorial }) => tutorial);
        this.moveTargets(0, freezeFactor);
        if (tutorialActiveBeforeMove && !this.targets.some(({ tutorial }) => tutorial)) {
          deferSpawnCadenceUntilNextUpdate = true;
        }
        continue;
      }
      const tutorialActiveBeforeMove = this.targets.some(({ tutorial }) => tutorial);
      this.moveTargets(segmentMs, freezeFactor);
      this.activeMs += segmentMs;
      if (deferSpawnCadenceUntilNextUpdate || (tutorialActiveBeforeMove && !this.targets.some(({ tutorial }) => tutorial))) {
        this.spawnElapsedMs = 0;
      }
      else this.spawnElapsedMs += segmentMs;
      this.freezeRemainingMs = Math.max(0, this.freezeExpiresAtActiveMs - this.activeMs);
      this.comboBrokenRemainingMs = Math.max(0, this.comboBrokenRemainingMs - segmentMs);
      this.specialHintRemainingMs = Math.max(0, this.specialHintRemainingMs - segmentMs);
      if (this.specialHintRemainingMs === 0) this.specialHint = null;
      this.reconcileLevel();
      remainingMs -= segmentMs;
    }
    if (this.phase === 'playing') this.processProgressionBoundaries();
  }

  private processProgressionBoundaries(): void {
    this.reconcileLevel();
    this.advanceSpawnSchedule();
  }

  private reconcileLevel(): void {
    const nextLevel = levelForActiveMs(this.activeMs);
    for (let crossedLevel = this.level + 1; crossedLevel <= nextLevel; crossedLevel += 1) {
      this.emitLevelEvents(crossedLevel);
    }
    this.level = nextLevel;
    this.freezeRemainingMs = Math.max(0, this.freezeExpiresAtActiveMs - this.activeMs);
  }

  private msUntilNextLevelBoundary(): number {
    return this.level < LEVELS.length ? this.level * 45_000 - this.activeMs : Number.POSITIVE_INFINITY;
  }

  private msUntilNextSpawnOpportunity(): number {
    if (this.targets.some(({ tutorial }) => tutorial)) return Number.POSITIVE_INFINITY;
    const spawnMs = spawnIntervalFor(this.settings!.difficulty, this.level);
    return Math.max(0, spawnMs - this.spawnElapsedMs);
  }

  private msUntilFreezeExpiry(): number {
    const remainingMs = this.freezeExpiresAtActiveMs - this.activeMs;
    return remainingMs > 0 ? remainingMs : Number.POSITIVE_INFINITY;
  }

  private msUntilNextBreach(freezeFactor: number): number {
    let shortestMs = Number.POSITIVE_INFINITY;
    for (const target of this.targets) {
      const distance = DEFENSE_LINE - (target.y + target.height);
      if (!Number.isFinite(distance)) continue;
      if (distance <= 0) return 0;
      const effectiveSpeed = target.speed * freezeFactor;
      if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) continue;
      shortestMs = Math.min(shortestMs, (distance / effectiveSpeed) * 1_000);
    }
    return shortestMs;
  }

  private moveTargets(deltaMs: number, freezeFactor: number): void {
    const movement = this.targetManager.update(this.targets, deltaMs, freezeFactor);
    this.targets = movement.active;
    for (const breached of movement.breached) this.applyBreach(breached);
  }

  private advanceSpawnSchedule(): void {
    if (this.targets.some(({ tutorial }) => tutorial)) return;
    while (this.phase === 'playing') {
      const spawnMs = spawnIntervalFor(this.settings!.difficulty, this.level);
      if (this.spawnElapsedMs < spawnMs) return;
      this.spawnElapsedMs -= spawnMs;
      if (this.autoSpawn) this.attemptSpawn();
    }
  }

  private eligibleSpecialKinds(): Exclude<TargetKind, 'normal'>[] {
    const eligible: Exclude<TargetKind, 'normal'>[] = [];
    if (this.shield <= 60) eligible.push('repair');
    if (this.targets.filter(({ kind }) => kind === 'normal').length >= 3) eligible.push('pulse');
    if (this.level >= difficultyTuning(this.settings!.difficulty).freezeMinimumLevel && this.targets.length >= 2) eligible.push('freeze');
    return eligible;
  }

  private canSpawnSpecial(eligibleSpecials: readonly Exclude<TargetKind, 'normal'>[]): boolean {
    const tuning = difficultyTuning(this.settings!.difficulty);
    return this.activeMs >= tuning.specialProtectionMs
      && eligibleSpecials.length > 0
      && !this.targets.some(({ kind }) => kind !== 'normal')
      && (this.lastSpecialSpawnActiveMs === null || this.activeMs - this.lastSpecialSpawnActiveMs >= tuning.specialCooldownMs);
  }

  private nextRandom(): number {
    const value = this.random();
    return Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(0, value)) : 0;
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
    if (this.combo > 0) this.comboBrokenRemainingMs = 180;
    this.combo = 0;
    this.wrongKeys += 1;
    this.events.push({ type: 'error' });
  }

  private completeTarget(target: Target): void {
    this.targets = this.targets.filter(({ id }) => id !== target.id);
    if (this.lockedTargetId === target.id) this.lockedTargetId = null;
    this.score += scoreForCompletion(target.word.length, this.level, this.combo, this.settings!.difficulty);
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.completedWords += 1;
    this.events.push({ type: 'destroyed', target: cloneTarget(target) });
    if (target.tutorial) this.spawnElapsedMs = 0;
    if (target.kind !== 'normal') this.resolveSpecial(target);
  }

  private resolveSpecial(target: Target): void {
    if (target.kind === 'repair') {
      this.shield = Math.min(INITIAL_SHIELD, this.shield + BREACH_DAMAGE);
      this.events.push({ type: 'special', kind: 'repair', affectedIds: [] });
      return;
    }
    if (target.kind === 'pulse') {
      const affectedTargets = this.targets
        .filter(({ kind }) => kind === 'normal')
        .sort((a, b) => b.y - a.y || a.id - b.id)
        .slice(0, 4);
      const affectedIds = affectedTargets.map(({ id }) => id);
      this.targets = this.targets.filter((target) => !affectedIds.includes(target.id));
      if (this.lockedTargetId !== null && affectedIds.includes(this.lockedTargetId)) this.lockedTargetId = null;
      this.score += affectedTargets.reduce(
        (total, affected) => total + Math.round(scoreForCompletion(affected.word.length, this.level, 0, this.settings!.difficulty) * 0.2),
        0,
      );
      this.events.push({ type: 'special', kind: 'pulse', affectedIds });
      return;
    }
    if (target.kind === 'freeze') {
      this.freezeExpiresAtActiveMs = this.activeMs + 5_000;
      this.freezeRemainingMs = 5_000;
      this.events.push({ type: 'special', kind: 'freeze', affectedIds: [] });
    }
  }

  private applyBreach(target: Target): void {
    if (this.lockedTargetId === target.id) this.lockedTargetId = null;
    this.shield = Math.max(0, this.shield - BREACH_DAMAGE);
    this.combo = 0;
    this.missedWords += 1;
    this.events.push({ type: 'breach', target: cloneTarget(target) });
    if (target.tutorial) this.spawnElapsedMs = 0;
    if (this.shield === 0) this.phase = 'gameover';
  }

  private activateTutorialTarget(): void {
    this.targets = this.targets.map((target) => target.tutorial ? { ...target, y: 72 } : target);
  }

  private emitLevelEvents(level: number): void {
    this.events.push({ type: 'level-up', level });
    if (level === 3 || level === 6 || level === 9 || level === 12) {
      this.events.push({ type: 'sector-milestone', level });
    }
  }
}
