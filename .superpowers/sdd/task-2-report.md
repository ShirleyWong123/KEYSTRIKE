# Task 2 implementation report

## Scope

Implemented the pressure curve, projectile timing constant, score formula, three curated word banks, weighted word selection, accuracy, and WPM metrics. Easy, normal, and hard banks contain at least 120 unique lowercase alphabetic words in the specified 3–5, 4–8, and 6–12 letter ranges.

## TDD evidence

### RED

Command:

```text
npm test -- src/game/config.test.ts src/game/words.test.ts src/game/metrics.test.ts
```

Result: failed as expected because `./config`, `./words`, and `./metrics` did not exist. Vitest reported three failed suites and zero executed tests.

### GREEN

After the minimal implementations and a small strict-TypeScript indexing fix, the focused command passed:

```text
npm test -- src/game/config.test.ts src/game/words.test.ts src/game/metrics.test.ts
```

Result: 3 test files passed, 9 tests passed.

## Verification

```text
npm run typecheck
```

Result: exited 0.

```text
npm test
```

Result: 4 test files passed, 10 tests passed.

## Files changed

- `src/game/config.ts` and `src/game/config.test.ts`
- `src/game/words.ts` and `src/game/words.test.ts`
- `src/game/metrics.ts` and `src/game/metrics.test.ts`

## Self-review

- Level calculation uses active milliseconds only, increases every 45,000 ms, and caps at 12.
- Score calculation does not read score and caps combo contribution at 20.
- Selection excludes active words, prefers unused initials, returns `null` when exhausted, and applies the configured long-word weighting.
- Metrics return zero for zero/invalid elapsed input and round to one decimal place where needed.
- No external runtime assets or network calls were added.

## Concerns

No known functional concerns. The word lists are intentionally static and local; future content changes should preserve their range, uniqueness, and lowercase-alphabetic invariants.

## Review fix

Addressed the Important review finding by adding deterministic regression assertions for the complete `LEVELS` table, `PROJECTILE_MS`, selection fallback when every legal candidate initial is active, and the exact boosted long-word weighting boundary at level 12.

### Files changed

- `src/game/config.test.ts`
- `src/game/words.test.ts`

### Verification

```text
npm test -- src/game/config.test.ts src/game/words.test.ts
```

Result: 2 test files passed, 9 tests passed.

```text
npm test && npm run typecheck
```

Result: 4 test files passed, 12 tests passed; `tsc -b --pretty false` exited 0.
