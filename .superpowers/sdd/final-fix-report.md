# Final review fix report

## Scope

Addressed every Important finding from the final review and the three concrete Minor gaps against baseline `5a1c468`. The browser checklist and its recorded claims were not modified.

## Changes

- Countdown activity now freezes while either the document is hidden or the window is blurred. Visibility and focus are tracked independently, so restoring only one inactivity reason cannot advance the countdown in the background.
- Tutorial labels use the same injected word measurement as spawned labels. Target movement deterministically holds a faster trailing label behind an overlapping slower trajectory, preserving the 16px horizontal margins and 12px label gap over time.
- Every active-time segment reconciles the level after its final elapsed time, including a fatal breach exactly on a 45-second boundary. Spawn processing remains phase-gated, so game-over cannot emit a post-game target.
- Audio presentation hooks cancel active/delayed sources and suspend on pause, resume only through explicit user-gesture paths, and clear scheduled sources on restart/menu. A later Start gesture resumes a reusable context that was suspended before returning to menu.
- Renderer presentation reset clears projectile and all effect pools. Completed projectiles now create a small, 120ms, bounded orange impact flash.
- The initially selected difficulty receives focus after menu mount. Canvas focus is represented by a clipped-safe `focus-within` overlay drawn inside the battlefield frame.
- Active initial exclusions are case-normalized. Shot pitch varies slightly through an injectable random source, and level-up uses a deterministic ascending three-note phrase.

## TDD evidence

### RED

Targeted tests were added before each production change and failed on the reviewed behavior:

- Countdown blur/visibility cases advanced into play instead of remaining frozen.
- The reproduced `0.34` `NOVA`/`quiet` trajectory lost the required gap, and the tutorial retained hand-authored dimensions rather than the measured bounds.
- Fatal exact-boundary runs ended at level 1 (or level 10 at 450 seconds) instead of reconciling the final level.
- Pause/restart/menu lifecycle tests found missing audio/renderer hooks; a later menu Start left the reusable audio context suspended.
- Initial menu focus remained on `body`, and the clipped Canvas had no reliable inset focus treatment.
- Uppercase active initial `C` still selected `cat`; no projectile impact record existed; injected shot randomness was unused; level-up scheduled only one note.

The focused RED runs included:

```text
npm test -- src/smoke.test.ts -t "freezes countdown"
npm test -- src/game/target-manager.test.ts src/game/game-model.test.ts
npm test -- src/audio/audio-engine.test.ts -t "varies shot pitch|distinct synthesized|ascending three-note"
npm test -- src/audio/audio-engine.test.ts -t "later menu start"
npm test -- src/render/canvas-renderer.test.ts -t "impact"
npm test -- src/ui/app-shell.test.ts -t "initially selected|canvas focus indicator"
npm test -- src/game/words.test.ts -t "without regard to input case"
```

### GREEN

Each focused test was rerun after its minimal implementation and passed. The affected module suites also passed in full before the final repository-wide gates.

## Final verification

```text
npm test
```

Result: 10 test files passed; 167 tests passed.

```text
npm run typecheck
```

Result: `tsc -b --pretty false` exited 0.

```text
npm run build
```

Result: TypeScript and Vite production build exited 0; 14 modules transformed.

```text
git diff --check
```

Result: exited 0 with no whitespace errors.

## Residual concern

No known automated-test or build blocker remains. The changed audio timing and visual focus/impact presentation were not manually re-run across Chrome, Safari, and Firefox in this fix pass; existing browser-checklist claims were deliberately left unchanged.
