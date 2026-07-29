// lib/progressBar.ts
// Single-number pure formatter that turns a percent value into a
// fixed-width Unicode block bar. Used by the single-window percent
// branch of `formatBalance()` (in check-balance.ts) to render the
// glanceable severity indicator that prefixes `%X`.
//
// Spec:    docs/specs/0001-progress-bar.md
// Glossary: CONTEXT.md ("progress bar", "single-window percent provider")
// ADR:     docs/adr/0001-progress-bar-scope.md (scope restriction)

import { RESET, percentColor } from "./colors.ts";

/**
 * Render a percent value as a fixed-width Unicode block bar.
 *
 * The filled portion (`█`) opens with `percentColor(used)` (green /
 * orange / red thresholds) and closes with `RESET`. The empty portion
 * (`░`) is uncolored; the `RESET` that brackets it brings the terminal
 * back to its default foreground, so no `DIM` or per-character wrap is
 * needed.
 *
 * Math:
 * - `used` is clamped to `[0, 100]` BEFORE mapping.
 * - `filled = Math.round((clamped / 100) * width)` — round-half-to-nearest.
 * - `filled` is clamped to `[0, width]` defensively (covers float edges
 *   such as `used = 100.0000001`).
 *
 * Defaults / knobs:
 * - `width = 10` is fixed in v1; no flag / env override (per ADR-0001).
 * - `colorize = true` by default. When `false` (used by `--json`),
 *   the bar emits no ANSI codes — the percent text and reset countdown
 *   remain uncolored, matching the existing convention where JSON's
 *   `balance` field carries no ANSI escapes.
 */
export function progressBar(
  used: number,
  width: number = 10,
  colorize: boolean = true,
): string {
  const clamped = Math.max(0, Math.min(100, used));
  const filled = Math.max(
    0,
    Math.min(width, Math.round((clamped / 100) * width)),
  );
  if (!colorize) {
    return "█".repeat(filled) + "░".repeat(width - filled);
  }
  return (
    percentColor(clamped) +
    "█".repeat(filled) +
    RESET +
    "░".repeat(width - filled)
  );
}
