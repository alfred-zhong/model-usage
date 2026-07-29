// lib/progressBar.test.ts
// Pure-function unit tests for progressBar().
// Spec: docs/specs/0001-progress-bar.md

import { describe, test, expect } from "bun:test";
import { progressBar } from "./progressBar.ts";
import { GREEN, ORANGE, RED, RESET } from "./colors.ts";

const G = GREEN; // shorthand for readability, matches check-balance.test.ts
const O = ORANGE;
const R = RED;

describe("progressBar", () => {
  // ── math: round-half-to-nearest + clamp ─────────────────────────────

  describe("math: round-half-to-nearest + clamp", () => {
    test("used = 0 → all empty cells", () => {
      expect(progressBar(0, 10, false)).toBe("░".repeat(10));
    });

    test("used = 100 → all filled cells", () => {
      expect(progressBar(100, 10, false)).toBe("█".repeat(10));
    });

    test("used = 50 → exactly 5 filled + 5 empty", () => {
      expect(progressBar(50, 10, false)).toBe("█".repeat(5) + "░".repeat(5));
    });

    test("used = 100.5 → clamped to [0,100]: all filled", () => {
      expect(progressBar(100.5, 10, false)).toBe("█".repeat(10));
    });

    test("used = -5 → clamped to [0,100]: all empty", () => {
      expect(progressBar(-5, 10, false)).toBe("░".repeat(10));
    });

    test("used = 4.5 → round-half-to-nearest: 0 filled cells (text-bar drift accepted)", () => {
      // Math.round(4.5/100 * 10) = Math.round(0.45) = 0
      expect(progressBar(4.5, 10, false)).toBe("░".repeat(10));
    });

    test("used = 5.5 → round-half-to-nearest: 1 filled cell", () => {
      // Math.round(5.5/100 * 10) = Math.round(0.55) = 1
      expect(progressBar(5.5, 10, false)).toBe("█" + "░".repeat(9));
    });

    test("used = 50, width = 1 → 1 filled cell", () => {
      // Math.round(50/100 * 1) = 1
      expect(progressBar(50, 1, false)).toBe("█");
    });

    test("used = 50, width = 5 → 3 filled (Math.round(2.5) = 3 in JS)", () => {
      // JS Math.round rounds half toward +∞.
      expect(progressBar(50, 5, false)).toBe("█".repeat(3) + "░".repeat(2));
    });

    test("fractional near 100% does not exceed width (clamp)", () => {
      // used = 99.99 → Math.round(9.999) = 10. Clamp to [0, 10] = 10.
      expect(progressBar(99.99, 10, false)).toBe("█".repeat(10));
    });
  });

  // ── ANSI stitching (colorize = true) ────────────────────────────────

  describe("ANSI stitching (colorize = true)", () => {
    test("used = 4 (green threshold) → opens GREEN, then RESET, then 10 empty", () => {
      expect(progressBar(4)).toBe(G + RESET + "░".repeat(10));
    });

    test("used = 75 (orange threshold) → opens ORANGE, 8 filled + 2 empty", () => {
      // Math.round(7.5) = 8 in JS (round-half toward +∞).
      expect(progressBar(75)).toBe(
        O + "█".repeat(8) + RESET + "░".repeat(2),
      );
    });

    test("used = 95 (red threshold) → opens RED, 10 filled + 0 empty", () => {
      // Math.round(9.5) = 10 in JS (round-half toward +∞).
      expect(progressBar(95)).toBe(R + "█".repeat(10) + RESET);
    });

    test("boundary: RESET sits exactly between last filled cell and first empty cell", () => {
      // For used = 50: GREEN + 5×█ + RESET + 5×░
      const out = progressBar(50);
      expect(out).toBe(G + "█".repeat(5) + RESET + "░".repeat(5));
      // Sanity: RESET position is immediately after the 5th filled char.
      const resetIdx = out.indexOf(RESET);
      expect(out.slice(0, resetIdx)).toBe(G + "█".repeat(5));
      expect(out.slice(resetIdx + RESET.length)).toBe("░".repeat(5));
    });

    test("all empty (used = 0): opens GREEN then immediately closes RESET", () => {
      // Even with 0 filled cells, the spec still emits the boundary so
      // the GREEN open is closed deterministically.
      expect(progressBar(0)).toBe(G + RESET + "░".repeat(10));
    });

    test("all filled (used = 100): opens RED and emits RESET, no empty cells", () => {
      expect(progressBar(100)).toBe(R + "█".repeat(10) + RESET);
    });

    test("colorize = false produces no ANSI codes (used = 50)", () => {
      const out = progressBar(50, 10, false);
      expect(out).toBe("█".repeat(5) + "░".repeat(5));
      expect(out.includes("\x1b")).toBe(false);
    });

    test("colorize = false produces no ANSI codes (used = 95)", () => {
      const out = progressBar(95, 10, false);
      expect(out).toBe("█".repeat(10));
      expect(out.includes("\x1b")).toBe(false);
    });
  });

  // ── default params ──────────────────────────────────────────────────

  describe("default params", () => {
    test("width defaults to 10 when omitted", () => {
      expect(progressBar(50)).toBe(progressBar(50, 10));
    });

    test("colorize defaults to true when omitted", () => {
      // With colorize, the output includes ANSI (regardless of fill).
      expect(progressBar(50).includes("\x1b[")).toBe(true);
    });
  });
});
