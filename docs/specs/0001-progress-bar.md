---
status: ready-for-agent
---

# 0001 — Progress bar in `check-balance` single-window percent display

## Problem Statement

When running `bun check-balance.ts`, a developer sees a percent text like
`minimax (4%: 4h11m)`. The number alone does not communicate severity at a
glance — a reader has to mentally cross-reference `4` with the threshold
scheme to know if the quota window is barely started (low) or about to
overflow (high). For single-window percent providers (e.g., MiniMax) the
output already carries enough metadata (used percent + reset countdown)
but lacks a spatial cue.

A visual progress bar before the percent text makes severity legible
without parsing the number, while keeping the percent text as the
primary read.

## Solution

Add a 10-cell Unicode block bar `[████████░░]` (filled cells + empty
cells) rendered before the percent text in the display of single-window
percent providers. The bar's filled portion is colored by the project's
existing threshold scheme (`<70%` green / `<90%` orange / `≥90%` red); the
empty portion is rendered uncolored (terminal default foreground). The
output becomes, for example:

```
minimax (████████░░ 4%: 4h11m)        ← 4% used, green
minimax (███████▌░░ 75%: 2h0m)        ← 75% used, orange
minimax (█████████▉ 95%: 5m)          ← 95% used, red
```

The percent text remains the numeric source of truth; the bar is a
glanceable spatial cue.

## User Stories

1. As a developer running `bun check-balance.ts`, I want a progress bar
   before the percent for single-window percent providers (MiniMax), so
   that I see severity at a glance without parsing the number.
2. As a developer, I want the bar's filled portion to follow the
   project's existing threshold colors (green / orange / red), so that
   the bar doubles as a severity indicator.
3. As a developer, I want the bar's empty portion to render uncolored,
   so that "filled vs unfilled" is the only spatial variable and color
   focuses on severity.
4. As a developer, I want a 10-cell bar at v1, so that the line stays
   short enough to fit an 80-column terminal without wrapping.
5. As a developer, I want values outside `[0, 100]` (over-quota,
   anomalies) to be clamped to `[0, width]`, so that the bar layout
   never breaks under odd inputs.
6. As a developer, I want the function to round fractions to whole cells
   using `Math.round`, so that the implementation is deterministic and
   tests are a simple table-driven assertion.
7. As a developer, I accept that bar cells won't always align cell-perfect
   with the percent text (a 4.5% used value renders as 0 filled cells
   while the text reads `4.5%`). The 10-cell granularity is a glanceable
   signal, not a measurement.
8. As a developer with `--json`, I want the bar to appear inside the
   JSON `balance` field's string, so that JSON consumers see what the
   user sees and the JSON schema doesn't change.
9. As a maintainer, I want the bar in v1 to apply only to single-window
   percent providers — NOT to multi-window (volcengine) providers or
   standalone provider scripts — so that v1 stays small and the deferred
   scopes are documented in ADR-0001.
10. As a maintainer, I want the new helper to be a single-number pure
    function — `(used: number, width?: number) => string` — so that it
    can be unit-tested in isolation and later extended to multi-tier
    without rewriting its core.
11. As a maintainer, I want unit tests covering round / clamp / width edge
    / ANSI-stitching for the new helper, so that its contract is locked.
12. As a maintainer, I want the existing display-formatter test file to
    extend its single-window percent assertions to include the bar
    prefix, so that the integration is regression-tested without
    inventing a second test seam.

## Implementation Decisions

- A new display-formatting helper module is created. It exports a single
  function `progressBar(used: number, width: number = 10,
  colorize: boolean = true): string`. The third `colorize` parameter is
  required for the `--json` integration: the bar still appears in the
  JSON `balance` field, but stripped of ANSI codes so the JSON value
  matches the existing no-ANSI convention used by the percent text in
  `--json` mode. This three-arg signature is a refinement of the
  two-arg signature originally recorded in the grilling session — the
  omission of the `colorize` flag was caught during implementation.
  This function is otherwise a pure transform suitable for the
  highest-seam unit test.
- `progressBar()` does the following:
  - Clamps `used` to `[0, 100]` first (clamping input, not output, keeps
    the downstream math linear).
  - Computes `filled = Math.round((used / 100) * width)`.
  - Clamps `filled` to `[0, width]` (defends against float edge cases
    such as `used = 100.0000001`).
  - Emits `[threshold-color-open]█...█[RESET]░...░` where the count of
    each glyph matches the computed `filled` and `width - filled` cells.
- The threshold-color function is reused as-is from the project's color
  helpers module (`percentColor(used)`). No new color scheme is
  introduced; thresholds remain `<70 / <90 / ≥90`.
- The default parameter value is `width = 10`. v1 has no flag or
  environment variable to override it.
- The character set is U+2588 (`█`) for filled cells and U+2591 (`░`)
  for empty cells. Both are 1-column-width glyphs on common terminals.
- The empty portion contains no ANSI codes; the "default foreground"
  rendering comes from the `RESET` escape that brackets it, NOT from a
  separate `DIM` SGR or a per-character wrap.
- The single-number signature for `progressBar()` is deliberate. A
  later extension to multi-tier does NOT refactor this function — it
  introduces a wrapper (e.g., `progressBarForTier(t: BalanceTier)`)
  that calls into the same shape, or widens the signature to accept
  `BalanceTier[]` and loops. The seam is preserved.
- The integration point is the project's centralized display formatter
  (the function named `formatBalance`). When its argument has
  `currency === "percent"` and no `tiers` array, `formatBalance` now
  emits the bar before the percent text. The multi-window branch (when
  `tiers` is non-empty) is unchanged in v1.
- Sample output shape (this encodes the ANSI stitching more precisely
  than prose; treat it as a prototype snapshot):

  ```
  // colorize = true, used = 4, no reset_remaining
  // output: `${PERCENT_COLOR}%4${GREEN}`
  // after the change:
  // output: `${PERCENT_COLOR}${'█'.repeat(0)}${RESET}${'░'.repeat(10)} ${GREEN}%4${GREEN}`
  // visible (without ANSI): `░░░░░░░░░░ 4%`
  ```

  When the percent is wrapped in line context, the actual rendered line
  inside the project's parenthesized display is
  `(░░░░░░░░░░ 4%)`, where `░░░░░░░░░░` was preceded by a `RESET` that
  cancels the color passed down from any prior tier.
- Existing modules and types are otherwise unchanged: `BalanceResult`,
  the cache schema (`CacheEntry`), and the existing color helpers are
  not modified.

## Testing Decisions

- **What makes a good test**:
  - For `progressBar()`, lock external behavior: assert the exact output
    string (filled cells, empty cells, ANSI codes in the right places)
    for canonical inputs. Implementation-internal rename or restructuring
    that doesn't change the output should not break tests.
  - For `formatBalance()`, lock the full rendered line. Tests assert
    `formatBalance(result).balance` against an exact string with the
    expected ANSI codes — exactly the way the existing tests do today.
- **Modules tested**:
  - The new helper module `progressBar`: full coverage.
  - The existing display-formatter test file: extend its
    `单窗口 percent（MiniMax）` describe block with three updated
    assertions. The multi-window and CNY describe blocks remain
    unchanged.
- **Coverage targets for `progressBar()`**:
  - `used = 0` → no filled cells; all empty.
  - `used = 100` → all filled; no empty.
  - `used = 50` → exactly 5 filled + 5 empty.
  - `used = 100.5` → clamped: all filled; no empty.
  - `used = -5` → clamped: no filled; all empty.
  - `used = 4.5` → 0 filled (round-down); all empty.
  - `used = 95` (red), `used = 75` (orange), `used = 4` (green) → assert
    each opens with the right threshold color code.
  - `width = 1` and `width = 5` parameter overrides → cell count reflects
    the override.
  - The exact text `RESET` appears between the last filled cell and the
    first empty cell (boundary ANSI stitching).
- **Prior art for tests**:
  - The existing display-formatter test file (named `check-balance.test.ts`
    in the repo root) already covers `formatBalance()` with the same
    shape of assertion: build a `BalanceResult`, call the formatter,
    assert the returned `{ balance }` exactly. New tests follow this
    pattern, adding the bar prefix in the expected string.
  - The provider tests in `lib/providers/volcengine.test.ts` demonstrate
    the project's pure-function unit-test style with `describe / test /
    expect` using `bun test`. The new helper's tests follow the same
    pattern.
  - The `lib/creds.test.ts` file is another pure-function unit test
    reference.

## Out of Scope

- **Multi-window percent providers** (currently: volcengine Coding Plan).
  The bar is NOT added to the `tiers` branch in v1. See
  `docs/adr/0001-progress-bar-scope.md` for the rationale.
- **Standalone provider scripts** (`bun lib/providers/<name>.ts`). Each
  standalone has its own `formatText` closure; duplicating bar rendering
  there historically drifts from the main `formatBalance()`. Out of
  scope for v1.
- **Width configurability** — no flag, no env var, no per-provider
  override. Width is fixed at 10 in v1.
- **Sub-cell precision** (1/8-cell granularity using `▏▎▍▌▋▊`). v1
  rounds to whole cells with `Math.round`; bar and percent text may not
  align cell-perfect. This is known and accepted.
- **Color customization / per-provider color overrides**. The bar uses
  the existing `percentColor()` thresholds without user overrides.
- **Bar in interactive terminal widgets** (e.g., `rich`,
  `terminal-kit`). The project deliberately stays zero-runtime-dep; the
  bar uses raw ANSI escapes via existing color helpers.
- **Cache schema changes** — the bar is purely display-layer; no new
  fields are written to or read from the balance cache.

## Further Notes

- The single-window / multi-window asymmetry is captured in `CONTEXT.md`
  under three new terms: `progress bar`, `single-window percent
  provider`, `multi-window percent provider`.
- The scope restriction (multi-window deferred) is recorded as
  `docs/adr/0001-progress-bar-scope.md` (ADR-0001).
- This spec was produced via the `grill-with-docs` skill. The
  9-decision chain in `CONTEXT.md` and `ADR-0001` is the source of
  truth; if implementation surfaces a contradiction, the spec is wrong.
- **Extension path**: adding the bar to multi-tier is a contained
  refactor — widen or wrap the helper to accept an array of percent
  values (one per tier) and call inside `r.tiers.map(...)`. The seam
  is preserved; no caller churn outside `formatBalance`.
