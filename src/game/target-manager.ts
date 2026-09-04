import { LEVELS } from './config';
import { selectWord } from './words';
import type { Target, TargetKind, Difficulty } from './types';

export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 800;
export const DEFENSE_LINE = 720;
export const HORIZONTAL_MARGIN = 16;
export const LABEL_GAP = 12;
const GEOMETRY_EPSILON = 1e-6;

export interface WordMeasure {
  width: number;
  height: number;
}

export type MeasureWord = (word: string) => WordMeasure;

export interface SpawnRequest {
  difficulty: Difficulty;
  level: number;
  targets: readonly Target[];
  kind?: TargetKind;
  tutorial?: boolean;
  id?: number;
}

export interface MovementResult {
  active: Target[];
  breached: Target[];
}

const defaultMeasure: MeasureWord = (word) => ({ width: word.length * 10, height: 36 });

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Owns deterministic target geometry, spawning, and movement rules. */
export class TargetManager {
  private nextId = 1;

  constructor(
    private readonly random: () => number = Math.random,
    private readonly measureWord: MeasureWord = defaultMeasure,
  ) {}

  isLegalRect(rect: { x: number; y: number; width: number; height: number }, existing: readonly Target[]): boolean {
    if (rect.x < HORIZONTAL_MARGIN || rect.x + rect.width > CANVAS_WIDTH - HORIZONTAL_MARGIN) return false;
    const expanded = { x: rect.x - LABEL_GAP, y: rect.y - LABEL_GAP, width: rect.width + LABEL_GAP * 2, height: rect.height + LABEL_GAP * 2 };
    return existing.every((target) => !overlaps(expanded, target));
  }

  createTutorialTarget(difficulty: Difficulty, word: string, id = 1): Target {
    const size = this.measureWord(word);
    const x = Math.min(
      CANVAS_WIDTH - HORIZONTAL_MARGIN - size.width,
      Math.max(HORIZONTAL_MARGIN, (CANVAS_WIDTH - size.width) / 2),
    );
    this.nextId = Math.max(this.nextId, id + 1);
    return {
      id,
      word,
      typed: 0,
      x,
      y: -size.height,
      width: size.width,
      height: size.height,
      speed: LEVELS[0].speed * 0.7,
      kind: 'normal',
      tutorial: true,
    };
  }

  trySpawn(request: SpawnRequest): Target | null {
    const levelIndex = Math.min(LEVELS.length, Math.max(1, Math.floor(request.level))) - 1;
    const level = LEVELS[levelIndex] ?? LEVELS[0];
    if (request.targets.length >= level.maxTargets) return null;

    const excludedWords = request.targets.map((target) => target.word);
    const excludedInitials = request.targets.map((target) => target.word.charAt(0));
    const word = selectWord(request.difficulty, request.level, excludedWords, excludedInitials, this.random);
    if (!word) return null;
    const size = this.measureWord(word);
    const positions = this.candidatePositions(size.width, size.height);
    const startIndex = Math.floor(this.random() * positions.length);
    for (let offset = 0; offset < positions.length; offset += 1) {
      const position = positions[(startIndex + offset) % positions.length]!;
      if (!this.isLegalRect({ ...position, width: size.width, height: size.height }, request.targets)) continue;
      const id = request.id ?? this.allocateId(request.targets);
      this.nextId = Math.max(this.nextId, id + 1);
      return {
        id,
        word,
        typed: 0,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        speed: request.tutorial ? level.speed * 0.7 : level.speed,
        kind: request.kind ?? 'normal',
        ...(request.tutorial ? { tutorial: true } : {}),
      };
    }
    return null;
  }

  update(targets: readonly Target[], deltaMs: number, freezeFactor: number): MovementResult {
    const elapsed = Number.isFinite(deltaMs) && deltaMs >= 0 ? deltaMs : 0;
    const factor = Number.isFinite(freezeFactor) ? Math.min(1, Math.max(0, freezeFactor)) : 1;
    const proposed = targets.map((target, index) => ({
      index,
      target: { ...target, y: target.y + target.speed * (elapsed / 1000) * factor },
    }));
    const frontToBack = [...proposed].sort((a, b) =>
      targets[b.index]!.y - targets[a.index]!.y || a.target.id - b.target.id);
    const resolved: typeof proposed = [];
    for (const entry of frontToBack) {
      const original = targets[entry.index]!;
      for (const ahead of resolved) {
        const originalAhead = targets[ahead.index]!;
        const horizontallySeparated = entry.target.x + entry.target.width + LABEL_GAP <= ahead.target.x
          || ahead.target.x + ahead.target.width + LABEL_GAP <= entry.target.x;
        const followsAhead = original.y < originalAhead.y - GEOMETRY_EPSILON;
        if (!horizontallySeparated && followsAhead) {
          entry.target.y = Math.min(
            entry.target.y,
            ahead.target.y - entry.target.height - LABEL_GAP - GEOMETRY_EPSILON,
          );
        }
      }
      resolved.push(entry);
    }

    const active: Target[] = [];
    const breached: Target[] = [];
    const originalOrder = proposed
      .sort((a, b) => a.index - b.index)
      .map(({ target }) => target);
    for (const moved of originalOrder) {
      if (moved.y + moved.height >= DEFENSE_LINE) breached.push(moved);
      else active.push(moved);
    }
    return { active, breached };
  }

  private allocateId(existing: readonly Target[]): number {
    const highest = existing.reduce((max, target) => Math.max(max, target.id), 0);
    this.nextId = Math.max(this.nextId, highest + 1);
    return this.nextId++;
  }

  private candidatePositions(width: number, height: number): Array<{ x: number; y: number }> {
    const maxX = Math.max(HORIZONTAL_MARGIN, CANVAS_WIDTH - HORIZONTAL_MARGIN - width);
    return Array.from({ length: 12 }, (_, index) => ({
      x: HORIZONTAL_MARGIN + ((maxX - HORIZONTAL_MARGIN) * index) / 11,
      y: -height,
    }));
  }
}

export const findLockCandidate = (targets: readonly Target[], initial: string): Target | null =>
  targets
    .filter((target) => target.word[0] === initial)
    .sort((a, b) => b.y - a.y || a.id - b.id)[0] ?? null;
