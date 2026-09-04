# KEYSTRIKE Playtest Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every approved P1 and P2 playtest improvement so KEYSTRIKE has clearer onboarding, fairer Ace risk/reward, readable combat feedback, and internally consistent performance results.

**Architecture:** Keep authoritative timing, scoring, spawn gating, statistics, and short-lived HUD state in `GameModel` snapshots so the Canvas renderer and HTML shell remain presentation-only consumers. Put difficulty tuning and pure time/score calculations in `config.ts`; use immutable `GameEvent` values only for Canvas-only transient effects such as level and sector messages. Preserve the fixed-step runtime and route each drained event list to every presentation consumer before rendering the new snapshot.

**Tech Stack:** Vite, TypeScript, Vitest, HTML5 Canvas 2D, CSS, Web Audio API.

## Global Constraints

- Support desktop browser keyboard play only; do not introduce touch controls or mobile-specific gameplay.
- Keep the logical battlefield at 480×800 and preserve fixed-step game simulation.
- Do not add image, font, audio, or runtime package dependencies; Web Audio remains synthesized.
- Preserve the existing `audit/` directory and all unrelated uncommitted user changes; it is playtest evidence, not production source.
- A correct letter always updates model state immediately and emits a non-blocking shot; rendering must never delay input evaluation.
- `Esc` remains the only pause toggle; `P` remains normal gameplay input.
- Reduced motion disables shake, limits particles, and must remain no brighter than the normal-mode visual-flash ceiling.
- Implement all P1 tasks before P2 tasks and keep the existing `npm test`, `npm run typecheck`, and `npm run build` validation gates green.

---

## File Structure and Responsibility Map

- `src/game/types.ts` — immutable game-state/event contracts, including short-lived model-owned HUD state.
- `src/game/config.ts` — pure progression, difficulty tuning, score, cooldown, and level-countdown calculations.
- `src/game/game-model.ts` — countdown tutorial activation, spawn gating, Ace rules, event emission, and run statistics.
- `src/game/config.test.ts` / `src/game/game-model.test.ts` — deterministic rule and chronology coverage.
- `src/render/canvas-renderer.ts` — bounded local effects, ambient-flash cap, danger pulse, and center combat messages.
- `src/render/canvas-renderer.test.ts` — Canvas call-order and time-bound effect coverage using the existing recording context.
- `src/ui/app-shell.ts` — menu copy, HUD timing/feedback, special-target help, and results content.
- `src/ui/app-shell.test.ts` / `src/styles.css` — semantic DOM, accessible presentation state, and results-grid layout coverage.
- `src/main.ts` / `src/smoke.test.ts` — immutable event fan-out from model to Canvas, audio, and UI consumers.

### Task 1: Model contracts and P1 pacing/economy rules

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/config.ts`
- Modify: `src/game/config.test.ts`
- Modify: `src/game/game-model.ts`
- Modify: `src/game/game-model.test.ts`

**Interfaces:**
- Produces `DifficultyTuning`, `difficultyTuning(difficulty)`, `spawnIntervalFor(difficulty, level)`, `scoreForLetter(difficulty)`, `scoreForCompletion(length, level, comboBefore, difficulty)`, and `msUntilNextLevel(activeMs)` from `src/game/config.ts`.
- Produces `GameSnapshot.nextLevelRemainingMs: number | null`, `GameSnapshot.comboBrokenRemainingMs: number`, and `GameSnapshot.specialHint: Exclude<TargetKind, 'normal'> | null` from `src/game/types.ts`.
- Produces event variants `{ type: 'level-up'; level: number }`, `{ type: 'sector-milestone'; level: 3 | 6 | 9 | 12 }`, and existing immutable target events for `CanvasRenderer`.
- Consumes `difficultyTuning`, `spawnIntervalFor`, `scoreForLetter`, and `scoreForCompletion` only inside the model; UI must not duplicate economy math.

- [ ] **Step 1: Write failing configuration tests for the exact difficulty tuning and pure time/score helpers**

  Add assertions to `src/game/config.test.ts` that define the public contract:

  ```ts
  expect(difficultyTuning('easy')).toMatchObject({ scoreMultiplier: 1, specialProtectionMs: 12_000, specialCooldownMs: 14_000, freezeMinimumLevel: 3 });
  expect(difficultyTuning('normal')).toEqual(difficultyTuning('easy'));
  expect(difficultyTuning('hard')).toMatchObject({ scoreMultiplier: 1.25, specialProtectionMs: 10_000, specialCooldownMs: 12_000, freezeMinimumLevel: 2 });
  expect(spawnIntervalFor('hard', 1)).toBe(2576);
  expect(spawnIntervalFor('hard', 12)).toBe(1750);
  expect(msUntilNextLevel(44_999)).toBe(1);
  expect(msUntilNextLevel(45_000)).toBe(45_000);
  expect(msUntilNextLevel(540_000)).toBeNull();
  expect(scoreForLetter('hard')).toBe(12.5);
  expect(scoreForCompletion(6, 1, 5, 'hard')).toBe(246);
  expect(scoreForCompletion(6, 1, 10, 'hard')).toBe(309);
  expect(scoreForCompletion(6, 1, 15, 'hard')).toBe(377);
  ```

- [ ] **Step 2: Run the focused configuration test and verify red**

  Run: `npm test -- src/game/config.test.ts`

  Expected: FAIL because the tuning helpers and four-argument completion scorer do not exist yet.

- [ ] **Step 3: Add pure, difficulty-aware configuration without changing the normal/easy curve**

  In `src/game/config.ts`, define the public tuning and calculation functions. Keep the existing `LEVELS` values unchanged; derive only Ace cadence from them.

  ```ts
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
  ```

  Make `scoreForLetter` and `scoreForCompletion` multiply the existing base scores by `difficultyTuning(difficulty).scoreMultiplier`; apply the Ace completion multiplier to the *pre-combo* bands `5–9 => 1.05`, `10–14 => 1.10`, `15+ => 1.15`, then round once at the end. Import `Difficulty` with `import type`.

- [ ] **Step 4: Run the focused configuration test and verify green**

  Run: `npm test -- src/game/config.test.ts`

  Expected: PASS, including unchanged level-cap and normal curve assertions.

- [ ] **Step 5: Write failing model tests for tutorial activation, tutorial spawn gating, Ace scoring, statistics, and level events**

  Add focused tests in the existing `GameModel lifecycle`, `input and scoring`, `special spawning`, and `progression` suites. Required observable cases:

  ```ts
  model.start(settings('easy'));
  model.advanceCountdown(3_000);
  expect(model.snapshot().targets[0]).toMatchObject({ tutorial: true, y: 72 });

  model.update(20_000);
  expect(model.snapshot().targets).toHaveLength(1); // tutorial still active blocks ordinary spawn
  for (const letter of 'nova') model.handleKey(letter);
  model.update(2_800);
  expect(model.snapshot().targets.some(({ tutorial }) => !tutorial)).toBe(true);

  const ace = combatModel('hard');
  ace.injectTarget(target({ id: 31, word: 'a' }));
  ace.handleKey('a');
  expect(ace.snapshot().score).toBe(13 + scoreForCompletion(1, 1, 0, 'hard'));

  model.handleKey('x');
  expect(model.snapshot()).toMatchObject({ wrongKeys: 1, comboBrokenRemainingMs: 180 });
  model.update(180);
  expect(model.snapshot().comboBrokenRemainingMs).toBe(0);
  ```

  Also prove: a breach increments `missedWords` but not `wrongKeys`; a wrong key increments `wrongKeys` but not `missedWords`; a hard-mode special can appear after 10 seconds and a second only after 12 seconds; freeze is eligible at hard Level 2 but not normal Level 2; and level events include `sector-milestone` exactly at 3, 6, 9, and 12.

- [ ] **Step 6: Run the focused model tests and verify red**

  Run: `npm test -- src/game/game-model.test.ts`

  Expected: FAIL on missing snapshot fields and pre-change tutorial/spawn/score/cooldown behavior.

- [ ] **Step 7: Implement the smallest authoritative model changes**

  Update `src/game/types.ts` and `src/game/game-model.ts` with these invariants:

  ```ts
  // GameSnapshot additions
  nextLevelRemainingMs: number | null;
  comboBrokenRemainingMs: number;
  specialHint: Exclude<TargetKind, 'normal'> | null;
  specialHintRemainingMs: number;
  ```

  - On countdown completion (both `beginCombat()` and chronological `update()`), set the single tutorial target’s `y` to `72`, enter `playing`, and leave `activeMs` at zero.
  - Do not call `attemptSpawn()` while any tutorial target remains. When a tutorial is completed or breached, reset `spawnElapsedMs` to zero so regular pacing begins after that resolution rather than producing a backlog burst.
  - Replace hard-coded special timing and freeze-level constants with `difficultyTuning(this.settings.difficulty)`; use `spawnIntervalFor` in both spawn schedule methods.
  - Award per-letter and completion points via the new difficulty-aware helpers. Preserve integer `score` by adding `Math.round(scoreForLetter(...))` per correct key.
  - Store `comboBrokenRemainingMs = 180` only when an error changes a positive combo to zero; decrement it only while gameplay time advances.
  - Keep `missedWords` as the breach count, never as an accuracy input. Populate `nextLevelRemainingMs` with `msUntilNextLevel(this.activeMs)`.
  - Track `shownSpecialHints: Set<Exclude<TargetKind, 'normal'>>` per run. When a special target is successfully inserted for the first time by kind, set `specialHint` and `specialHintRemainingMs = 1_600`; expire it through active gameplay time and reset the set/state in `resetRun`.
  - When crossing a level, retain the `level-up` event and append `{ type: 'sector-milestone', level }` only for 3, 6, 9, or 12. Never alter movement, shield, or level pressure because of this event.

- [ ] **Step 8: Run all game-rule tests and verify green**

  Run: `npm test -- src/game/config.test.ts src/game/game-model.test.ts src/game/metrics.test.ts src/game/target-manager.test.ts`

  Expected: PASS. Update existing `scoreForCompletion` call sites in the tests to pass `'normal'` where asserting the unchanged normal rules.

- [ ] **Step 9: Commit the model/economy slice**

  ```bash
  git add src/game/types.ts src/game/config.ts src/game/config.test.ts src/game/game-model.ts src/game/game-model.test.ts
  git commit -m "feat: tune pacing and ace rewards"
  ```

### Task 2: Canvas readability, threats, and combat messages

**Files:**
- Modify: `src/render/canvas-renderer.ts`
- Modify: `src/render/canvas-renderer.test.ts`

**Interfaces:**
- Consumes `GameSnapshot.targets`, `GameSnapshot.freezeRemainingMs`, and event variants `destroyed`, `error`, `level-up`, and `sector-milestone`.
- Produces only Canvas pixels; it must not mutate `GameSnapshot`, game scores, targets, or HUD state.

- [ ] **Step 1: Write failing renderer tests for capped ambient flash, danger pulse, and message copy/timing**

  In `src/render/canvas-renderer.test.ts`, use the existing `RecordingContext` to assert:

  ```ts
  renderer.consume(Array.from({ length: 3 }, () => ({ type: 'destroyed' as const, target: target() })));
  renderer.render(snapshot(), 0);
  const flashes = context.calls.filter(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff');
  expect(flashes).toHaveLength(1);
  expect(flashes[0]?.globalAlpha).toBeLessThanOrEqual(0.18);

  renderer.render(snapshot({ targets: [target({ y: 500 }), target({ id: 2, y: 640 })] }), 0);
  expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);

  renderer.consume([{ type: 'level-up', level: 2 }, { type: 'sector-milestone', level: 3 }]);
  renderer.render(snapshot(), 0);
  expect(textCalls(context).map(({ args }) => args[0])).toEqual(expect.arrayContaining([
    'LEVEL 2 // SPEED UP', 'SECTOR 1 STABILIZED',
  ]));
  ```

  Add clock-advance assertions proving level copy expires after 900ms, sector copy after 1200ms, and error border stays visible at 149ms but not 151ms.

- [ ] **Step 2: Run the renderer suite and verify red**

  Run: `npm test -- src/render/canvas-renderer.test.ts`

  Expected: FAIL because the renderer still stacks full-screen flash, lacks sector events/threat pulse, uses `LEVEL n` copy, and expires errors at 120ms.

- [ ] **Step 3: Implement bounded visual layers and non-blocking warnings**

  In `src/render/canvas-renderer.ts`:

  - Change `ERROR_MS` to `150`; retain the existing reduced-motion static-border behavior.
  - Represent ambient completion flash as one timestamp/strength field, not an accumulated value per explosion. In `consume('destroyed')`, always add bounded local explosion data, but only refresh the global flash when no ambient flash is active. Render exactly one white overlay at `Math.min(0.18, ...)` in normal mode and at or below the existing reduced-motion ceiling.
  - Keep rings, shards, and particles attached to each `Explosion`; do not suppress local feedback when ambient flash is unavailable.
  - Select the eligible threat strictly from normal targets whose bottom edge is within 180 logical pixels above `DEFENSE_LINE`, sorting by greatest `y` then lowest `id`. Draw a low-frequency, low-alpha red edge pulse behind/around the battlefield edge only; do not draw over the target label and do not change target ordering.
  - Replace `levelUp`’s draw copy with `LEVEL ${level} // SPEED UP` while keeping `LEVEL_UP_MS = 900`. Add independent `sectorMilestone` presentation state with `SECTOR ${(level / 3)} STABILIZED` and a `1_200ms` expiry. Both are display-only and can overlap without pausing the clock.

- [ ] **Step 4: Run the renderer suite and verify green**

  Run: `npm test -- src/render/canvas-renderer.test.ts`

  Expected: PASS, including existing projectile layering, pause-preserved effect lifetime, and reduced-motion tests.

- [ ] **Step 5: Commit the Canvas feedback slice**

  ```bash
  git add src/render/canvas-renderer.ts src/render/canvas-renderer.test.ts
  git commit -m "feat: improve combat feedback readability"
  ```

### Task 3: Event fan-out and P1/P2 HTML interface

**Files:**
- Modify: `src/main.ts`
- Modify: `src/smoke.test.ts`
- Modify: `src/ui/app-shell.ts`
- Modify: `src/ui/app-shell.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `GameSnapshot.nextLevelRemainingMs`, `comboBrokenRemainingMs`, `specialHint`, and `specialHintRemainingMs`.
- Adds `AppShell.consume(events: readonly GameEvent[]): void`; it must accept the same frozen event list supplied to renderer/audio and may retain only Canvas-independent UI presentation state.
- `RuntimeParts.shell` becomes `Pick<AppShell, 'consume' | 'update'>`; `flushEvents()` calls `shell.consume(events)` before `shell.update(snapshot)`.

- [ ] **Step 1: Write failing runtime test for immutable UI event fan-out**

  Extend the harness in `src/smoke.test.ts` with `shell.consume: vi.fn()`. Add this assertion after a forced level boundary or injected special event:

  ```ts
  expect(shell.consume).toHaveBeenCalledWith(consumedByRenderer[0]);
  expect(consumedByRenderer[0]).toBe(consumedByAudio[0]);
  expect(Object.isFrozen(shell.consume.mock.calls[0]?.[0])).toBe(true);
  ```

  Also assert that the runtime neither duplicates nor changes the event list while sending it to UI.

- [ ] **Step 2: Run the focused runtime test and verify red**

  Run: `npm test -- src/smoke.test.ts`

  Expected: FAIL because `RuntimeParts.shell` and `flushEvents()` do not expose a UI event consumer.

- [ ] **Step 3: Add the runtime event fan-out with no gameplay ownership change**

  In `src/main.ts`, change the shell contract and fan-out order:

  ```ts
  export interface RuntimeParts {
    model: GameModel;
    renderer: Pick<CanvasRenderer, 'consume' | 'render' | 'resize' | 'resetPresentation'>;
    audio: Pick<AudioEngine, 'consume' | 'dispose' | 'pausePresentation' | 'resumeFromGesture' | 'resetPresentation'>;
    shell: Pick<AppShell, 'consume' | 'update'>;
  }

  const flushEvents = (): void => {
    const events = freezeEvents(model.drainEvents());
    renderer.consume(events);
    audio.consume(events);
    shell.consume(events);
  };
  ```

  Do not move audio/renderer reset behavior into `AppShell`; the shell only owns DOM content and focus.

- [ ] **Step 4: Write failing AppShell tests for the approved menu, HUD, special help, and result semantics**

  Add tests in `src/ui/app-shell.test.ts` for all of these externally visible contracts:

  ```ts
  expect(root.textContent).toContain('ENDLESS SURVIVAL');

  shell.render(resultSnapshot({ phase: 'playing', activeMs: 44_000, level: 1 }));
  expect(root.querySelector('[data-hud="next-level"]')?.textContent).toBe('00:01');
  shell.render(resultSnapshot({ phase: 'playing', activeMs: 540_000, level: 12 }));
  expect(root.querySelector('[data-hud="next-level"]')?.textContent).toBe('MAX LEVEL');

  shell.render(resultSnapshot({ phase: 'playing', combo: 0, comboBrokenRemainingMs: 180 }));
  expect(root.querySelector('[data-hud="combo-feedback"]')?.textContent).toBe('COMBO BROKEN');

  shell.render(resultSnapshot({ phase: 'playing', specialHint: 'repair', specialHintRemainingMs: 1_600 }));
  expect(root.querySelector('[data-special-hint]')?.textContent).toContain('REPAIR // +20 SHIELD');

  shell.render(resultSnapshot({ wrongKeys: 10, missedWords: 5 }));
  expect(root.querySelector('[data-result="errors"]')?.textContent).toBe('10');
  expect(root.querySelector('[data-result="breaches"]')?.textContent).toBe('5');
  expect(root.querySelector('[data-result="level"]')?.closest('div')?.classList).toContain('results-grid-wide');
  ```

  Keep the existing `Accuracy` and WPM assertions and update the old “Misses” expectation to “Breaches”. Add a CSS-source assertion that `.results-grid-wide` spans both columns and test that the results grid has no anonymous/empty metric entry.

- [ ] **Step 5: Run shell and runtime tests and verify red**

  Run: `npm test -- src/smoke.test.ts src/ui/app-shell.test.ts`

  Expected: FAIL for missing event consumer, menu copy, HUD elements, special help, result fields, and grid class.

- [ ] **Step 6: Implement interface copy and accessibility-preserving layout**

  In `src/ui/app-shell.ts` and `src/styles.css`:

  - Add `ENDLESS SURVIVAL` adjacent to the menu title/mission identity without changing keyboard controls.
  - Add a compact `data-hud="next-level"` field. Format a non-null remaining duration as `MM:SS` with seconds rounded up so 1ms never reads `00:00`; render `MAX LEVEL` for `null`.
  - Keep the numeric combo value, and add a visually subordinate live `data-hud="combo-feedback"` element that is hidden unless `comboBrokenRemainingMs > 0`; use `aria-live="polite"` without stealing focus.
  - Render a non-interactive `data-special-hint` overlay only when the snapshot provides an active hint. Map exactly: `repair => REPAIR // +20 SHIELD`, `pulse => PULSE // CLEAR 4`, `freeze => FREEZE // HALF SPEED`. It must not obscure the tutorial copy or take pointer/focus events.
  - Replace the `Misses` result row with `Breaches`, add `Typing errors`, preserve `Accuracy` calculation exclusively from correct/wrong keys, and make `Reached level` a `.results-grid-wide` last row. Keep all metrics in explicit `<div><dt>…</dt><dd …>` units so CSS grid cells cannot be blank.
  - Add restrained styles for next-level timing, combo warning, special hint, and a full-width results row while preserving the existing short-height HUD media-query contracts.
  - Implement `consume(_: readonly GameEvent[])` as a deliberately no-op for now, documented as the UI event fan-out boundary. HUD/special feedback is snapshot-owned, so it must not start a second wall-clock timer or duplicate state.

- [ ] **Step 7: Run UI/runtime tests and verify green**

  Run: `npm test -- src/smoke.test.ts src/ui/app-shell.test.ts`

  Expected: PASS, including focus management, storage isolation, fixed-step behavior, and the new immutable event-fan-out expectation.

- [ ] **Step 8: Commit the HUD and results slice**

  ```bash
  git add src/main.ts src/smoke.test.ts src/ui/app-shell.ts src/ui/app-shell.test.ts src/styles.css
  git commit -m "feat: clarify mission HUD and results"
  ```

### Task 4: Integrate behavior and protect regression boundaries

**Files:**
- Modify: `src/game/game-model.test.ts`
- Modify: `src/render/canvas-renderer.test.ts`
- Modify: `src/ui/app-shell.test.ts`
- Modify: `src/smoke.test.ts`
- Modify: `docs/superpowers/specs/2026-09-04-keystrike-game-design.md`

**Interfaces:**
- Consumes the finalized Task 1 snapshot/event types and Task 2/3 presentation contracts.
- Produces only regression tests and a concise verified-status note in the existing design document; no new runtime API.

- [ ] **Step 1: Add cross-boundary failing regression tests for the approved acceptance cases**

  Add one deterministic test per unresolved acceptance boundary, using the existing test/debug API rather than adding production controls:

  ```ts
  // Tutorial can breach; the next regular target waits for its normal cadence.
  model.start(settings());
  model.beginCombat();
  model.injectTarget(target({ id: 1, tutorial: true, y: 700, height: 20, speed: 40 }));
  model.update(1_000);
  expect(model.snapshot().missedWords).toBe(1);
  model.update(2_799);
  expect(model.snapshot().targets).toHaveLength(0);
  model.update(1);
  expect(model.snapshot().targets).toHaveLength(1);

  // Snapshot view state freezes with pause.
  model.handleKey('x');
  model.pause();
  model.update(1_000);
  expect(model.snapshot().comboBrokenRemainingMs).toBe(180);
  ```

  Add complementary renderer and shell assertions proving the danger pulse does not change `lockedTargetId`/target order and that special help never appears after its `specialHintRemainingMs` reaches zero.

- [ ] **Step 2: Run the three targeted suites and verify red if any integration assumption is wrong**

  Run: `npm test -- src/game/game-model.test.ts src/render/canvas-renderer.test.ts src/ui/app-shell.test.ts src/smoke.test.ts`

  Expected: PASS if tasks 1–3 were implemented exactly; otherwise fix the smallest contract mismatch before proceeding. Do not weaken a behavioral assertion merely to accept an implementation drift.

- [ ] **Step 3: Make only contract-alignment fixes required by the integration tests**

  Resolve mismatches by preserving these exact outcomes:

  ```ts
  // No catch-up ordinary target while tutorial is active or immediately after resolution.
  expect(snapshot.targets.filter(({ tutorial }) => !tutorial)).toHaveLength(0);

  // Model timers, including combo feedback and special help, do not age while paused.
  expect(pausedSnapshot.comboBrokenRemainingMs).toBe(beforePause.comboBrokenRemainingMs);
  expect(pausedSnapshot.specialHintRemainingMs).toBe(beforePause.specialHintRemainingMs);
  ```

  If a test needs explicit type narrowing for `specialHint`, use `if (snapshot.specialHint !== null)` rather than casting or making the field optional.

- [ ] **Step 4: Run full automated verification**

  Run: `npm test && npm run typecheck && npm run build`

  Expected: all Vitest suites pass, TypeScript exits 0, and Vite emits `dist/` successfully.

- [ ] **Step 5: Update the implementation-status note without changing approved design rules**

  At the end of section 13 in `docs/superpowers/specs/2026-09-04-keystrike-game-design.md`, append a dated, factual note listing the exact command set in Step 4 and its pass/fail status. Do not alter the approved P1/P2 requirements or claim browser verification from automated tests.

- [ ] **Step 6: Commit the integration and verification slice**

  ```bash
  git add src/game/game-model.test.ts src/render/canvas-renderer.test.ts src/ui/app-shell.test.ts src/smoke.test.ts docs/superpowers/specs/2026-09-04-keystrike-game-design.md
  git commit -m "test: verify playtest improvement integration"
  ```

### Task 5: Browser acceptance for all three desktop difficulty paths

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-keystrike-game-design.md`
- Preserve: `audit/2026-09-04-playtest/`

**Interfaces:**
- Consumes the debug URL `http://127.0.0.1:5175/?debug=1` and the existing `window.__KEYSTRIKE_DEBUG__` API.
- Produces dated browser-verification evidence only; it must not become a production dependency.

- [ ] **Step 1: Start the local production-equivalent development server and open debug mode**

  Run: `npm run dev -- --host 127.0.0.1 --port 5175`

  Expected: Vite reports `http://127.0.0.1:5175/`; open `http://127.0.0.1:5175/?debug=1` in the desktop browser.

- [ ] **Step 2: Verify Cadet and Pilot onboarding/input feedback**

  For each difficulty, start a run, wait through the three-second countdown, and verify all of the following visibly:

  ```text
  tutorial word begins in the readable y=72 region
  no ordinary target appears before tutorial completion/breach
  first-letter locking and orange per-letter projectile feedback work
  one wrong letter gives a 150ms red feedback; a positive combo shows COMBO BROKEN
  menu identifies the mode as ENDLESS SURVIVAL
  HUD shows the time to next level
  ```

  Use a screenshot after the tutorial and after the error feedback; store only in the existing dated `audit/` directory.

- [ ] **Step 3: Verify Ace risk/reward and special cadence through deterministic debug setup**

  Select Ace, complete the tutorial, use the debug API to force Level 2 and inject simple single-letter normal/special targets. Confirm score changes show the 1.25 multiplier, complete enough consecutive words to exercise the 5-combo milestone, and confirm freeze can spawn at Level 2. Confirm the ordinary target speed visually matches normal at the same level while spawn opportunities are more frequent. Do not claim random-live special cadence without observing the 10-second protection and 12-second cooldown.

- [ ] **Step 4: Verify P2 visual contrast and result semantics**

  Use debug injection to place a normal target within 180 logical pixels of the defense line; confirm the low-frequency edge warning leaves the word readable and does not steal the active lock. Trigger multiple destroy events under normal and reduced-motion settings; confirm the normal full-screen flash never washes out the remaining labels and reduced motion stays calmer. Force enough breaches for game over and confirm the results display `Accuracy`, `Typing errors`, `Breaches`, and a full-width `Reached level` row without a blank grid cell.

- [ ] **Step 5: Record browser evidence and update the verification note**

  Add a short dated browser checklist beneath the Task 4 status note in `docs/superpowers/specs/2026-09-04-keystrike-game-design.md`: Cadet, Pilot, Ace, normal motion, reduced motion, and result semantics each marked pass/fail with any observed blocker. Include screenshot filenames, not embedded image data. If Safari/Firefox are unavailable, record them as unverified rather than inferring support from Chrome.

- [ ] **Step 6: Commit browser evidence metadata only**

  ```bash
  git add docs/superpowers/specs/2026-09-04-keystrike-game-design.md
  git commit -m "docs: record keystrike playtest verification"
  ```

  Do not stage `audit/` unless the user explicitly asks to version audit artifacts.

## Final Verification Checklist

- [ ] `npm test` passes with all existing and new tests.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run build` exits 0 and produces `dist/`.
- [ ] Cadet, Pilot, and Ace each complete the tutorial in the browser.
- [ ] Ace reaches at least Level 2 through a no-loss input sequence and demonstrates its score multiplier.
- [ ] Ordinary targets cannot spawn during countdown or while the tutorial target is active.
- [ ] Flash cap, danger warning, special first-seen help, combo-break feedback, level upgrade, and sector milestone are visible but non-blocking.
- [ ] The final results distinguish accuracy, typing errors, and breaches; no results-grid blank cell remains.
