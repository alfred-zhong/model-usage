// lib/colors.ts
// ANSI 颜色常量和阈值判断函数，供 check-balance 和各 standalone provider 复用。

/** 深绿色（#4e9a06，ANSI 256 色号 70）。 */
export const GREEN = "\x1b[38;5;70m";
/** 橙色（256 色）。 */
export const ORANGE = "\x1b[38;5;214m";
/** 红色。 */
export const RED = "\x1b[31m";
/** 重置所有 SGR 属性。 */
export const RESET = "\x1b[0m";

export function green(s: string): string {
  return `${GREEN}${s}${RESET}`;
}
export function orange(s: string): string {
  return `${ORANGE}${s}${RESET}`;
}
export function red(s: string): string {
  return `${RED}${s}${RESET}`;
}

/**
 * 根据用量百分比返回对应颜色码：
 * - `<70%`：绿色
 * - `70% ≤ used < 90%`：橙色
 * - `≥90%`：红色
 */
export function percentColor(used: number): string {
  if (used < 70) return GREEN;
  if (used < 90) return ORANGE;
  return RED;
}

/**
 * 根据 CNY 余额返回对应颜色码：
 * - `≥20`：绿色
 * - `≥10`：橙色
 * - `<10`：红色
 */
export function cnyColor(balance: number): string {
  if (balance >= 20) return GREEN;
  if (balance >= 10) return ORANGE;
  return RED;
}
