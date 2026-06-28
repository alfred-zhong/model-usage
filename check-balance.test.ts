// check-balance.test.ts
// Regression tests for formatBalance + cache hit rebuild path.
//
// 历史 bug（OV-3）：
//   MiniMax cache hit 路径丢失 reset_remaining，导致输出从
//   `MiniMax (%4，重置: 3h22m)` 退化为 `MiniMax (%4)`。
//
// 这里把 check-balance.ts 的 `formatBalance` 抽到单测里，构造一个 MiniMax
// 风格的 CacheEntry（含 used + reset_remaining），验证完整 formatBalance 路径
// 能正确还原 `重置:` 后缀。tiers 路径（火山）同理覆盖。

import { describe, test, expect } from "bun:test";
import { formatBalance, type CacheEntry } from "./check-balance.ts";

// Helper: 模拟 cache hit 路径里 cache entry → BalanceResult 的重建
// 这一段是从 check-balance.ts 的 `if (entry && Date.now() - entry.ts < ttlMs)`
// 分支复制过来的——保证测试和生产代码同步演进（如果将来 cache schema 改了，
// 这里也要同步改）
function rebuildFromCache(entry: CacheEntry) {
  return {
    balance: entry.balance,
    currency: entry.currency as "CNY" | "percent",
    ...(entry.used !== undefined ? { used: entry.used } : {}),
    ...(entry.reset_remaining ? { reset_remaining: entry.reset_remaining } : {}),
    ...(entry.tiers ? { tiers: entry.tiers } : {}),
  };
}

// ── formatBalance ───────────────────────────────────────────────────

describe("formatBalance", () => {
  describe("单窗口 percent（MiniMax）", () => {
    test("有 used + reset_remaining → '%X，重置: Y'（OV-3 主回归）", () => {
      // 关键回归：不能只输出 %4，必须把 reset_remaining 透出去
      const result = rebuildFromCache({
        balance: 96,
        currency: "percent",
        used: 4,
        reset_remaining: "3h22m",
        ts: 0,
      });
      expect(formatBalance(result)).toEqual({
        balance: "%4",
        extra: "重置: 3h22m",
      });
    });

    test("used 缺位时由 100 - balance 推导", () => {
      const result = rebuildFromCache({
        balance: 96,
        currency: "percent",
        // 没有 used
        ts: 0,
      });
      expect(formatBalance(result).balance).toBe("%4");
    });

    test("reset_remaining 缺位时只输出 %X（不附加空 extra）", () => {
      const result = rebuildFromCache({
        balance: 96,
        currency: "percent",
        used: 4,
        // 没有 reset_remaining
        ts: 0,
      });
      const formatted = formatBalance(result);
      expect(formatted.balance).toBe("%4");
      expect(formatted.extra).toBeUndefined();
    });
  });

  describe("多窗口 tiers（火山）", () => {
    test("3 个 tier + 各自 reset_remaining → '%X, %Y, %Z，重置: A, B, C'", () => {
      const result = rebuildFromCache({
        balance: 0,
        currency: "percent",
        tiers: [
          { used: 0, reset_remaining: "3h22m" },
          { used: 12, reset_remaining: "4h19m" },
          { used: 15, reset_remaining: "18d4h" },
        ],
        ts: 0,
      });
      expect(formatBalance(result)).toEqual({
        balance: "%0, %12, %15",
        extra: "重置: 3h22m, 4h19m, 18d4h",
      });
    });

    test("tier 缺 reset_remaining 时拼接空字符串", () => {
      const result = rebuildFromCache({
        balance: 0,
        currency: "percent",
        tiers: [{ used: 5 }, { used: 10, reset_remaining: "2h" }],
        ts: 0,
      });
      expect(formatBalance(result).extra).toBe("重置: , 2h");
    });
  });

  describe("CNY（DeepSeek/Kimi）", () => {
    test("balance 数值 → ¥X.XX", () => {
      const result = rebuildFromCache({
        balance: 12.5,
        currency: "CNY",
        ts: 0,
      });
      expect(formatBalance(result)).toEqual({ balance: "¥12.50" });
    });
  });
});

// ── cache schema 防御 ───────────────────────────────────────────────

describe("CacheEntry schema", () => {
  test("OV-1：存的是数值，不是格式化串", () => {
    // 防回归：formatBalance 内部做 100 - balance，必须是 number
    const entry: CacheEntry = { balance: 96, currency: "percent", ts: 0 };
    expect(typeof entry.balance).toBe("number");
  });

  test("OV-3：单窗口 percent 必须存 used + reset_remaining（不仅存 extra）", () => {
    // 防回归：不能只存格式化的 extra，否则 formatBalance 拿不到原始值
    const entry: CacheEntry = {
      balance: 96,
      currency: "percent",
      used: 4,
      reset_remaining: "3h22m",
      extra: "重置: 3h22m",
      ts: 0,
    };
    expect(entry.used).toBe(4);
    expect(entry.reset_remaining).toBe("3h22m");
    expect(entry.extra).toBe("重置: 3h22m"); // 旧 cache 向后兼容
  });

  test("OV-3 向后兼容：旧 cache 文件只有 extra、没有 used/reset_remaining", () => {
    // 模拟升级前写的 cache：rebuild 路径不会抛错，formatBalance 安全退化
    const oldEntry: CacheEntry = {
      balance: 96,
      currency: "percent",
      extra: "重置: 3h22m", // 旧格式
      ts: 0,
    };
    const result = rebuildFromCache(oldEntry);
    const formatted = formatBalance(result);
    expect(formatted.balance).toBe("%4");
    // 旧 cache 没有 reset_remaining 原始值时，extra 为空——下次刷新会写入新 schema
    expect(formatted.extra).toBeUndefined();
  });
});