# KEYSTRIKE Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished desktop-browser endless typing shooter in which each correct letter fires a shot, completed words explode, pressure rises on a timed 12-level curve, and the run ends when the shield reaches zero.

**Architecture:** Keep all authoritative rules in a deterministic `GameModel` that consumes injected time and random values. Canvas rendering, Web Audio, DOM screens, local storage, and the animation loop are adapters around that model. Visual events are emitted by the model and consumed without delaying input or state transitions.

**Tech Stack:** Vite, TypeScript, HTML5 Canvas 2D, CSS, Web Audio API, Vitest, jsdom.

## Global Constraints

- Target desktop browsers with a 480×800 logical Canvas; no touch or mobile-input support.
- Use only local code and browser APIs; do not add external image, font, or audio assets.
- The ship is fixed at bottom center; all combat control comes from English-letter input.
- `Esc` is the only combat pause key; `P` must remain a valid word letter.
- Level increases every 45 seconds of active combat, caps at 12, and never reads score.
- Normal and special targets both deal 20 shield damage on breach and reset combo.
- Respect `prefers-reduced-motion` and the saved reduced-motion setting.
- Preserve unrelated user files. The directory is not currently a Git repository, so do not initialize Git or create commits without explicit authorization.

## File Map

- `package.json`: scripts and development dependencies.
- `tsconfig.json`, `vite.config.ts`: strict TypeScript, Vite, and Vitest configuration.
- `index.html`: application mount point and static metadata.
- `src/main.ts`: composition root and fixed-step animation loop.
- `src/styles.css`: responsive desktop shell, overlays, HUD, focus, and reduced-motion styles.
- `src/game/types.ts`: shared domain types and event contracts.
- `src/game/config.ts`: scoring, shield, special-target, and 12-level pressure constants.
- `src/game/words.ts`: three curated word banks and weighted selection.
- `src/game/metrics.ts`: accuracy and WPM calculations.
- `src/game/target-manager.ts`: legal target placement, movement, and breach detection.
- `src/game/game-model.ts`: phase, input, scoring, combo, shield, progression, specials, and snapshot API.
- `src/render/canvas-renderer.ts`: all battlefield drawing and visual-event simulation.
- `src/audio/audio-engine.ts`: synthesized event sounds and mute behavior.
- `src/ui/storage.ts`: safe settings and per-difficulty high-score persistence.
- `src/ui/app-shell.ts`: start, HUD, pause, and result screens with keyboard focus management.
- `src/**/*.test.ts`: focused Vitest coverage beside each pure module.
- `tests/browser-checklist.md`: repeatable Chrome, Safari, and Firefox acceptance procedure.

---

### Task 1: Project Foundation and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/styles.css`
- Create: `src/game/types.ts`
- Create: `src/smoke.test.ts`

**Interfaces:**
- Produces: `Difficulty`, `TargetKind`, `GamePhase`, `Target`, `GameEvent`, `GameSnapshot`, and `GameSettings` domain types.
- Produces: working `npm test`, `npm run typecheck`, `npm run build`, and `npm run dev` commands.

- [ ] **Step 1: Create the package and compiler configuration**

Use this script set and dependency boundary:

```json
{
  "name": "keystrike",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

Configure strict TypeScript with `noUncheckedIndexedAccess`, DOM libraries, ES2022 modules, and Vitest using the jsdom environment.

- [ ] **Step 2: Write the failing smoke test**

```ts
// src/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { APP_NAME } from './main';

describe('application shell', () => {
  it('exposes the KEYSTRIKE product name', () => {
    expect(APP_NAME).toBe('KEYSTRIKE');
  });
});
```

- [ ] **Step 3: Run the smoke test and verify RED**

Run: `npm install && npm test -- src/smoke.test.ts`

Expected: FAIL because `src/main.ts` does not yet export `APP_NAME`.

- [ ] **Step 4: Add the minimum composition root and domain contracts**

```ts
// src/main.ts
import './styles.css';

export const APP_NAME = 'KEYSTRIKE';
```

```ts
// src/game/types.ts
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
```

- [ ] **Step 5: Verify the foundation**

Run: `npm test -- src/smoke.test.ts && npm run typecheck && npm run build`

Expected: 1 test passes; typecheck and production build exit 0.

- [ ] **Step 6: Record the checkpoint**

If the user has initialized Git by execution time, commit only these files with `git commit -m "chore: scaffold keystrike"`. Otherwise record “checkpoint complete; no Git repository” in the execution notes and continue without initializing one.

---

### Task 2: Pressure Curve, Word Banks, and Performance Metrics

**Files:**
- Create: `src/game/config.ts`
- Create: `src/game/config.test.ts`
- Create: `src/game/words.ts`
- Create: `src/game/words.test.ts`
- Create: `src/game/metrics.ts`
- Create: `src/game/metrics.test.ts`

**Interfaces:**
- Produces: `LEVELS`, `PROJECTILE_MS = 80`, `levelForActiveMs(activeMs)`, `scoreForCompletion(wordLength, level, comboBefore)`.
- Produces: `WORD_BANKS`, `selectWord(difficulty, level, excludedWords, excludedInitials, random)`.
- Produces: `accuracy(correct, wrong)` and `wpm(correct, activeMs)`.

- [ ] **Step 1: Write failing configuration tests**

```ts
expect(levelForActiveMs(0)).toBe(1);
expect(levelForActiveMs(44_999)).toBe(1);
expect(levelForActiveMs(45_000)).toBe(2);
expect(levelForActiveMs(999_999)).toBe(12);
expect(LEVELS[11]).toEqual({ speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.45 });
expect(scoreForCompletion(6, 4, 3)).toBe(224);
```

The last score is `round(6 × 25 × 1.3 × 1.15)`.

- [ ] **Step 2: Run configuration tests and verify RED**

Run: `npm test -- src/game/config.test.ts`

Expected: FAIL because the configuration module does not exist.

- [ ] **Step 3: Implement exact constants and formulas**

```ts
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
  { speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.45 }
] as const;

export const PROJECTILE_MS = 80;

export const levelForActiveMs = (activeMs: number): number =>
  Math.min(12, 1 + Math.floor(Math.max(0, activeMs) / 45_000));

export const scoreForCompletion = (length: number, level: number, comboBefore: number): number =>
  Math.round(length * 25 * (1 + (level - 1) * 0.1) * (1 + Math.min(comboBefore, 20) * 0.05));
```

- [ ] **Step 4: Write failing word-bank and metric tests**

Verify every bank has at least 120 unique lowercase alphabetic words in its specified length range. Verify selection excludes active words and tries unused initials first. Verify `accuracy(8, 2) === 80`, `accuracy(0, 0) === 0`, `wpm(250, 60_000) === 50`, and `wpm(0, 0) === 0`.

- [ ] **Step 5: Run the new tests and verify RED**

Run: `npm test -- src/game/words.test.ts src/game/metrics.test.ts`

Expected: FAIL because word selection and metrics are not implemented.

- [ ] **Step 6: Implement selection and metrics**

```ts
export const accuracy = (correct: number, wrong: number): number => {
  const total = correct + wrong;
  return total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
};

export const wpm = (correct: number, activeMs: number): number =>
  activeMs <= 0 ? 0 : Math.round(((correct / 5) / (activeMs / 60_000)) * 10) / 10;
```

Implement word selection in two passes: first candidates whose initial is not active, then any otherwise-valid candidate. Weight words in the upper half of the chosen bank's length range by `1 + longWordBoost`. Return `null` when no legal candidate exists so spawning can be delayed.

- [ ] **Step 7: Verify Task 2**

Run: `npm test -- src/game/config.test.ts src/game/words.test.ts src/game/metrics.test.ts && npm run typecheck`

Expected: all Task 2 tests pass and typecheck exits 0.

- [ ] **Step 8: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: add progression and word systems"`; otherwise record the checkpoint without creating a repository.

---

### Task 3: Legal Target Placement and Movement

**Files:**
- Create: `src/game/target-manager.ts`
- Create: `src/game/target-manager.test.ts`

**Interfaces:**
- Consumes: `Target`, `TargetKind`, `LEVELS`, and `selectWord`.
- Produces: `TargetManager.trySpawn(request): Target | null`, `TargetManager.update(targets, deltaMs, freezeFactor): { active; breached }`, and `findLockCandidate(targets, initial)`.

- [ ] **Step 1: Write failing placement and lock tests**

```ts
it('rejects a candidate that overlaps an existing label', () => {
  const manager = new TargetManager(() => 0.5);
  const existing = [target({ x: 100, y: 80, width: 120, height: 36 })];
  expect(manager.isLegalRect({ x: 110, y: 86, width: 100, height: 36 }, existing)).toBe(false);
});

it('locks the lowest matching target', () => {
  const high = target({ id: 1, word: 'star', y: 100 });
  const low = target({ id: 2, word: 'shield', y: 500 });
  expect(findLockCandidate([high, low], 's')?.id).toBe(2);
});
```

Also test 16px horizontal safety margins, 12px inter-label spacing, active-target caps, 70% tutorial speed, frozen 50% movement, and breach at the defense line.

- [ ] **Step 2: Run Task 3 tests and verify RED**

Run: `npm test -- src/game/target-manager.test.ts`

Expected: FAIL because `TargetManager` and `findLockCandidate` do not exist.

- [ ] **Step 3: Implement deterministic geometry and movement**

Use `measureWord(word): { width; height }` injected by the renderer adapter; tests use a fixed measure function. Try a bounded set of 12 candidate positions. Expand every existing rectangle by 12px for overlap checks. Use a defense line constant of `720` logical pixels. Return `null` instead of placing an overlapping target.

```ts
export const findLockCandidate = (targets: readonly Target[], initial: string): Target | null =>
  targets
    .filter((target) => target.word[0] === initial)
    .sort((a, b) => b.y - a.y || a.id - b.id)[0] ?? null;
```

- [ ] **Step 4: Verify Task 3**

Run: `npm test -- src/game/target-manager.test.ts && npm run typecheck`

Expected: placement, lock, movement, freeze, and breach tests all pass.

- [ ] **Step 5: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: add deterministic target management"`; otherwise record the checkpoint.

---

### Task 4: Core Input, Scoring, Combo, Shield, and Run Lifecycle

**Files:**
- Create: `src/game/game-model.ts`
- Create: `src/game/game-model.test.ts`

**Interfaces:**
- Consumes: Task 2 formulas and Task 3 target operations.
- Produces: class `GameModel` with `start(settings)`, `beginCombat()`, `handleKey(key)`, `update(deltaMs)`, `pause()`, `resume()`, `restart()`, `returnToMenu()`, `drainEvents()`, and `snapshot()`.

- [ ] **Step 1: Write failing lifecycle and input tests**

Cover these exact behaviors with real model state:

```ts
model.start(settings('normal'));
expect(model.snapshot().phase).toBe('countdown');
model.beginCombat();
model.injectTarget(target({ id: 1, word: 'pulse', y: 300 }));

model.handleKey('p');
expect(model.snapshot().phase).toBe('playing');
expect(model.snapshot().lockedTargetId).toBe(1);
expect(model.snapshot().targets[0]?.typed).toBe(1);

model.handleKey('x');
expect(model.snapshot().combo).toBe(0);
expect(model.snapshot().lockedTargetId).toBe(1);
expect(model.snapshot().targets[0]?.typed).toBe(1);
```

Add separate tests for immediate unlock on completion, 10 points per correct letter, completion score, combo growth, breach resetting combo and subtracting 20 shield, game over at zero shield, `Esc` pause/resume, ignored repeat/modifier/non-letter input, restart, and return to menu.

Also verify that `start()` creates the correct fixed tutorial word (`NOVA`, `ORBIT`, or `VECTOR`) for the selected difficulty and that countdown time does not increase `activeMs`.

- [ ] **Step 2: Run Task 4 tests and verify RED**

Run: `npm test -- src/game/game-model.test.ts`

Expected: FAIL because `GameModel` does not exist.

- [ ] **Step 3: Implement the minimal deterministic model**

Represent key input as `{ key: string; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }` so browser filtering is testable. Treat `Esc` before alphabetic filtering. Emit `shot` immediately after a correct letter and `destroyed` after removing a completed target. Never let renderer or audio callbacks mutate the model.

Add `injectTarget` and `advanceCountdown` only to a documented test/debug interface rather than exposing them in the production UI.

- [ ] **Step 4: Verify Task 4**

Run: `npm test -- src/game/game-model.test.ts && npm run typecheck`

Expected: lifecycle, input, score, combo, shield, and pause tests all pass.

- [ ] **Step 5: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: implement keystrike core rules"`; otherwise record the checkpoint.

---

### Task 5: Timed Progression and Special Targets

**Files:**
- Modify: `src/game/game-model.ts`
- Modify: `src/game/game-model.test.ts`

**Interfaces:**
- Consumes: `levelForActiveMs`, `LEVELS`, `TargetKind`.
- Produces: state-aware special eligibility, 12-second protection, 14-second cooldown, repair/pulse/freeze resolution, and level-up events.

- [ ] **Step 1: Write failing progression and special tests**

Use injected logical time and random values to verify:

- Score changes do not change level before 45 seconds.
- Paused time does not advance level, cooldowns, or freeze duration.
- Repair is ineligible above 60 shield and restores exactly 20 at or below 60.
- Pulse is ineligible below 3 normal targets, clears at most the 4 lowest normal targets, awards 20% base completion value, and does not change combo.
- Freeze is ineligible before level 3 or below 2 other targets, slows movement to 50% for 5 seconds, and refreshes rather than stacks.
- Specials cannot appear before 12 seconds, within 14 seconds of the last special spawn, or while another special is active.
- A special breach deals 20 damage and resets combo.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/game/game-model.test.ts -t "progression|special|freeze|pulse|repair"`

Expected: FAIL on the first missing special/progression behavior.

- [ ] **Step 3: Implement one special behavior at a time**

After each failing test, add only the rule needed to pass it, rerun the focused test, then move to the next behavior. Select equally among currently eligible special types. When none is eligible, spawn a normal target. Store freeze expiry in logical active time, not wall-clock time.

- [ ] **Step 4: Verify Task 5**

Run: `npm test -- src/game/game-model.test.ts src/game/target-manager.test.ts && npm run typecheck`

Expected: all model and target tests pass with no warnings.

- [ ] **Step 5: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: add levels and special targets"`; otherwise record the checkpoint.

---

### Task 6: Canvas Battlefield and Non-Blocking Effects

**Files:**
- Create: `src/render/canvas-renderer.ts`
- Create: `src/render/canvas-renderer.test.ts`

**Interfaces:**
- Consumes: `GameSnapshot`, drained `GameEvent[]`, `GameSettings`.
- Produces: `CanvasRenderer.resize()`, `measureWord(word)`, `consume(events)`, and `render(snapshot, interpolation)`.

- [ ] **Step 1: Write failing renderer state tests**

Using a recording Canvas 2D context, verify that:

- The backing store scales with device pixel ratio capped at 2 while logical size remains 480×800.
- Typed and untyped substrings are drawn separately and typed text receives both orange color and underline.
- The locked target is drawn after unlocked targets.
- `shot` creates a projectile without changing the model snapshot.
- `destroyed` creates flash, ring, shard, and particle records.
- `level-up` creates a short central level indicator without pausing the model.
- Reduced motion disables shake, limits particles, and lowers flash opacity.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `npm test -- src/render/canvas-renderer.test.ts`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement the battlefield layers**

Draw in this order: deep-space gradient, star dust, scan lines, perspective grid, defense line, unlocked targets, lock connector, locked target, projectiles, explosions, ship, edge warning. Use Canvas primitives for the abstract ship and signal targets; do not embed external assets. Keep effect objects in bounded pools and drop excess secondary particles before dropping input-linked shots.

- [ ] **Step 4: Implement accessible visual states**

Special targets require color plus a short text tag: `REPAIR`, `PULSE`, or `FREEZE`. Keep white flashes below full-screen opacity and use a single decaying pulse rather than repeated strobing. With reduced motion, replace shake with a static red border.

- [ ] **Step 5: Verify Task 6**

Run: `npm test -- src/render/canvas-renderer.test.ts && npm run typecheck`

Expected: all renderer state tests pass.

- [ ] **Step 6: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: render keystrike battlefield"`; otherwise record the checkpoint.

---

### Task 7: Synthesized Web Audio

**Files:**
- Create: `src/audio/audio-engine.ts`
- Create: `src/audio/audio-engine.test.ts`

**Interfaces:**
- Consumes: `GameEvent[]` and `soundEnabled`.
- Produces: `AudioEngine.unlock()`, `setEnabled(enabled)`, `consume(events)`, and `dispose()`.

- [ ] **Step 1: Write failing audio scheduling tests**

Inject a fake `AudioContext` and verify no nodes are scheduled before `unlock`, no nodes are scheduled while muted, `shot`, `error`, `destroyed`, `level-up`, and `breach` use distinct oscillator/noise envelopes, every shot schedules a quieter hit pulse after the projectile travel delay, and `dispose` closes the context.

- [ ] **Step 2: Run audio tests and verify RED**

Run: `npm test -- src/audio/audio-engine.test.ts`

Expected: FAIL because `AudioEngine` does not exist.

- [ ] **Step 3: Implement short bounded sounds**

Use oscillator and gain nodes for shots, delayed hits, errors, upgrades, and breaches. Build explosion noise from an in-memory buffer. Both renderer and audio use the shared `PROJECTILE_MS = 80` constant, so every shot schedules its impact sound 80ms after launch. Ensure every node has a scheduled stop no later than one second after creation and disconnect it after ending.

- [ ] **Step 4: Verify Task 7**

Run: `npm test -- src/audio/audio-engine.test.ts && npm run typecheck`

Expected: all audio lifecycle and mute tests pass.

- [ ] **Step 5: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: add synthesized game audio"`; otherwise record the checkpoint.

---

### Task 8: Keyboard-Accessible Screens, HUD, Results, and Persistence

**Files:**
- Create: `src/ui/storage.ts`
- Create: `src/ui/storage.test.ts`
- Create: `src/ui/app-shell.ts`
- Create: `src/ui/app-shell.test.ts`
- Modify: `index.html`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `GameModel`, `GameSnapshot`, `accuracy`, `wpm`, `AudioEngine`, `GameSettings`.
- Produces: `AppShell` that renders menu/HUD/pause/results, updates focus, persists settings, and exposes the Canvas element.

- [ ] **Step 1: Write failing safe-storage tests**

Verify malformed JSON and throwing storage APIs fall back to `{ soundEnabled: true, reducedMotion: systemPreference }`; verify scores are saved separately under `keystrike.highScore.easy|normal|hard` and never decrease.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `npm test -- src/ui/storage.test.ts`

Expected: FAIL because the storage adapter does not exist.

- [ ] **Step 3: Implement storage and then verify GREEN**

Catch storage reads and writes independently. Accept a `Storage | null` dependency so failures are testable. Run `npm test -- src/ui/storage.test.ts` and expect all storage tests to pass.

- [ ] **Step 4: Write failing app-shell interaction tests**

With jsdom, verify:

- Difficulty cards show word length and recommended WPM.
- Arrow keys change the selected difficulty and Enter starts countdown.
- Tab reaches sound, reduced-motion, and start controls with visible focus classes.
- Pause moves focus to Continue; resume returns focus to the game surface.
- Results show score, survival time, completed words, accuracy, WPM, max combo, misses, level, and difficulty-specific high score.
- A zero-input result displays `0%` and `0 WPM`.

- [ ] **Step 5: Run app-shell tests and verify RED**

Run: `npm test -- src/ui/app-shell.test.ts`

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 6: Implement semantic HTML screens and CSS**

Use real `<button>`, `<fieldset>`, `<input type="radio">`, and `<input type="checkbox">` elements. Give overlays `role="dialog"` with labelled headings. Use a visually clear `:focus-visible` outline. Keep HUD text outside Canvas. Implement the fixed-ratio center field, dark side ambience, shield bar, and narrow-height desktop reflow.

- [ ] **Step 7: Verify Task 8**

Run: `npm test -- src/ui/storage.test.ts src/ui/app-shell.test.ts && npm run typecheck`

Expected: all persistence, keyboard, focus, and result tests pass.

- [ ] **Step 8: Record the checkpoint**

If Git is available, commit with `git commit -m "feat: add accessible game interface"`; otherwise record the checkpoint.

---

### Task 9: Fixed-Step Integration and Browser Acceptance

**Files:**
- Modify: `src/main.ts`
- Modify: `src/smoke.test.ts`
- Create: `tests/browser-checklist.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: a playable browser game and a repeatable manual acceptance checklist.

- [ ] **Step 1: Write the failing integration test**

Use injected `requestAnimationFrame`, time, random, visibility, and keyboard adapters. Verify a 120Hz render sequence advances the model by the same active time as a 60Hz sequence; cap catch-up work after a long suspension; verify `visibilitychange` pauses an active run.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npm test -- src/smoke.test.ts`

Expected: FAIL because the composition root does not yet create or drive the model.

- [ ] **Step 3: Wire the runtime**

Use a 1000/60ms fixed logic step, an accumulator, and at most 5 catch-up steps per animation frame. After each model step, drain events once and send the same immutable event list to renderer and audio. Resize from CSS bounds, cap DPR at 2, and auto-pause on `document.visibilityState === 'hidden'` or window blur.

- [ ] **Step 4: Verify all automated checks**

Run: `npm test && npm run typecheck && npm run build`

Expected: every test passes, typecheck exits 0, and Vite writes a production build to `dist/`.

- [ ] **Step 5: Write and execute the browser checklist**

The checklist must record PASS/FAIL for Chrome, Safari, and Firefox across:

1. Keyboard-only menu, difficulty choice, settings, and start.
2. Three-second countdown and difficulty-specific tutorial word.
3. Same-initial lowest-target lock and correct handling of `P` words.
4. Immediate typed-letter feedback, projectile, non-blocking explosion, error flash, and combo reset.
5. Non-overlapping labels at maximum target density.
6. Forced repair, pulse, and freeze eligibility and effects through the debug injection interface.
7. Breach damage, shield depletion, game over, results, and difficulty-specific high score.
8. `Esc` pause, focus restoration, blur/hidden-tab pause, resize, mute, and reduced motion.
9. Forced 12-level progression with score-independent timing.
10. A normal live run observed near 60 FPS with no missed key events during effect peaks.

- [ ] **Step 6: Review against the design specification**

Compare every section of `docs/superpowers/specs/2026-09-04-keystrike-game-design.md` with the built behavior. Record any unmet requirement as unverified or failing; do not weaken the spec to make the implementation pass.

- [ ] **Step 7: Record the final checkpoint**

If Git is available, commit verified files with `git commit -m "feat: complete keystrike game"`. Otherwise report that all work remains uncommitted because the directory has no Git repository.
