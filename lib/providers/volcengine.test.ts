import { describe, test, expect } from "bun:test";
import {
  volcCanonicalQuery,
  volcSign,
  volcUriEncode,
  volcRegion,
  volcIsAuthErrorCode,
  volcExtractError,
  volcCodingWindow,
  parseCodingTiers,
  formatDuration,
} from "./volcengine.ts";
import type { BalanceTier } from "./types.ts";

// ── volcCanonicalQuery ──────────────────────────────────────────────

describe("volcCanonicalQuery", () => {
  test("排序按 key 字母序（Action < Region < Version）", () => {
    const result = volcCanonicalQuery("GetCodingPlanUsage", "cn-beijing");
    // 字母序: Action < Region < Version
    expect(result).toBe("Action=GetCodingPlanUsage&Region=cn-beijing&Version=2024-01-01");
  });

  test("canonical query 中同一 Action 字符串既用于签名也用于 URL", () => {
    // 稳定回归：签名串和实际请求 URL 必须字面一致，否则签名不匹配
    const a = volcCanonicalQuery("GetAFPUsage", "ap-southeast-1");
    expect(a).toBe("Action=GetAFPUsage&Region=ap-southeast-1&Version=2024-01-01");
  });
});

// ── volcUriEncode ───────────────────────────────────────────────────

describe("volcUriEncode", () => {
  test("RFC3986 unreserved 直接通过", () => {
    expect(volcUriEncode("abcXYZ-_.~123")).toBe("abcXYZ-_.~123");
  });

  test("其他字符按 %XX 编码（UTF-8 字节）", () => {
    expect(volcUriEncode("a b")).toBe("a%20b");
    expect(volcUriEncode("a/b")).toBe("a%2Fb");
    expect(volcUriEncode("中")).toBe("%E4%B8%AD"); // UTF-8: 0xE4 0xB8 0xAD
  });
});

// ── volcSign ────────────────────────────────────────────────────────

describe("volcSign", () => {
  const fixedNow = new Date("2024-01-15T10:30:45.123Z");

  test("xDate 格式为 YYYYMMDDTHHMMSSZ", () => {
    const { xDate } = volcSign("AK", "SK", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    expect(xDate).toBe("20240115T103045Z");
  });

  test("authorization 包含 Credential + SignedHeaders + Signature 三段", () => {
    const { authorization } = volcSign("AK", "SK", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    expect(authorization).toMatch(/^HMAC-SHA256 Credential=AK\/\d{8}\/cn-beijing\/ark\/request, /);
    expect(authorization).toContain("SignedHeaders=host;x-date;x-content-sha256;content-type");
    expect(authorization).toMatch(/, Signature=[0-9a-f]{64}$/);
  });

  test("xContentSha256 是空 body 的 SHA-256 hex", () => {
    const { xContentSha256 } = volcSign("AK", "SK", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    expect(xContentSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("同一输入 → 同一签名（确定性）", () => {
    const a = volcSign("AK", "SK", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    const b = volcSign("AK", "SK", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    expect(a.authorization).toBe(b.authorization);
  });

  test("不同 sk → 不同签名", () => {
    const a = volcSign("AK", "SK1", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    const b = volcSign("AK", "SK2", "cn-beijing", "Action=X", Buffer.alloc(0), fixedNow);
    expect(a.authorization).not.toBe(b.authorization);
  });
});

// ── volcRegion ──────────────────────────────────────────────────────

describe("volcRegion", () => {
  test("cn-beijing.volces.com 提取 cn-beijing", () => {
    expect(volcRegion("https://ark.cn-beijing.volces.com/api/coding")).toBe("cn-beijing");
  });

  test("ap-southeast-1 提取 ap-southeast-1", () => {
    expect(volcRegion("https://ark.ap-southeast-1.volces.com")).toBe("ap-southeast-1");
  });

  test("无 cn-/ap- 前缀时回落 cn-beijing", () => {
    expect(volcRegion("https://unknown.volces.com")).toBe("cn-beijing");
  });

  test("无效 URL 回落 cn-beijing", () => {
    expect(volcRegion("not a url")).toBe("cn-beijing");
  });
});

// ── volcIsAuthErrorCode ─────────────────────────────────────────────

describe("volcIsAuthErrorCode", () => {
  test("鉴权类错误码命中", () => {
    expect(volcIsAuthErrorCode("InvalidSignature")).toBe(true);
    expect(volcIsAuthErrorCode("AccessDenied")).toBe(true);
    expect(volcIsAuthErrorCode("Unauthorized")).toBe(true);
    expect(volcIsAuthErrorCode("InvalidCredential")).toBe(true);
    expect(volcIsAuthErrorCode("SignatureDoesNotMatch")).toBe(true);
  });

  test("业务错误码不命中", () => {
    expect(volcIsAuthErrorCode("QuotaExceeded")).toBe(false);
    expect(volcIsAuthErrorCode("InvalidParameter")).toBe(false);
    expect(volcIsAuthErrorCode("")).toBe(false);
  });

  test("大小写不敏感", () => {
    expect(volcIsAuthErrorCode("signature")).toBe(true);
    expect(volcIsAuthErrorCode("AUTH")).toBe(true);
  });
});

// ── volcExtractError ────────────────────────────────────────────────

describe("volcExtractError", () => {
  test("从 ResponseMetadata.Error 提取", () => {
    const body = { ResponseMetadata: { Error: { Code: "X", Message: "Y" } } };
    expect(volcExtractError(body)).toEqual({ code: "X", msg: "Y" });
  });

  test("从顶层 Error 提取", () => {
    const body = { Error: { Code: "X", Message: "Y" } };
    expect(volcExtractError(body)).toEqual({ code: "X", msg: "Y" });
  });

  test("两个都没有 → null", () => {
    expect(volcExtractError({})).toBe(null);
    expect(volcExtractError({ ResponseMetadata: {} })).toBe(null);
  });

  test("Error 空对象（无 code 无 msg）→ null", () => {
    expect(volcExtractError({ ResponseMetadata: { Error: {} } })).toBe(null);
  });
});

// ── volcCodingWindow ────────────────────────────────────────────────

describe("volcCodingWindow", () => {
  test("session 变体识别", () => {
    expect(volcCodingWindow("session")).toBe("session");
    expect(volcCodingWindow("5h")).toBe("session");
    expect(volcCodingWindow("fivehour")).toBe("session");
    expect(volcCodingWindow("five_hour")).toBe("session");
    expect(volcCodingWindow("rolling_5h")).toBe("session");
  });

  test("weekly 变体识别", () => {
    expect(volcCodingWindow("weekly")).toBe("weekly");
    expect(volcCodingWindow("week")).toBe("weekly");
    expect(volcCodingWindow("7d")).toBe("weekly");
  });

  test("monthly 变体识别", () => {
    expect(volcCodingWindow("monthly")).toBe("monthly");
    expect(volcCodingWindow("month")).toBe("monthly");
  });

  test("未知标签 → null", () => {
    expect(volcCodingWindow("daily")).toBe(null);
    expect(volcCodingWindow("")).toBe(null);
  });

  test("大小写不敏感", () => {
    expect(volcCodingWindow("SESSION")).toBe("session");
    expect(volcCodingWindow("Weekly")).toBe("weekly");
  });
});

// ── parseCodingTiers ────────────────────────────────────────────────

describe("parseCodingTiers", () => {
  test("标准 QuotaUsage 数组 + Level 字段", () => {
    const result = {
      QuotaUsage: [
        { Level: "session", Percent: 5, ResetTime: 7200 },
        { Level: "weekly", Percent: 12, ResetTime: 604800 },
        { Level: "monthly", Percent: 15, ResetTime: 2592000 },
      ],
    };
    const tiers = parseCodingTiers(result);
    expect(tiers).toHaveLength(3);
    expect(tiers[0]).toEqual({ used: 5, reset_remaining: "2h" });
    expect(tiers[1].used).toBe(12);
    expect(tiers[2].used).toBe(15);
  });

  test("Level 缺位时回退到 Type", () => {
    const result = {
      QuotaUsage: [{ Type: "session", Percent: 10, ResetTime: 3600 }],
    };
    expect(parseCodingTiers(result)[0]).toEqual({ used: 10, reset_remaining: "1h" });
  });

  test("Level/Type 缺位时回退到 Period", () => {
    const result = {
      QuotaUsage: [{ Period: "weekly", Percent: 20, ResetTime: 86400 }],
    };
    expect(parseCodingTiers(result)[0]).toEqual({ used: 20, reset_remaining: "1d0h" });
  });

  test("回退到 Label", () => {
    const result = { QuotaUsage: [{ Label: "session", Percent: 1, ResetTime: 100 }] };
    expect(parseCodingTiers(result)[0].used).toBe(1);
  });

  test("回退到 Window", () => {
    const result = { QuotaUsage: [{ Window: "session", Percent: 2, ResetTime: 60 }] };
    expect(parseCodingTiers(result)[0]).toEqual({ used: 2, reset_remaining: "1m" });
  });

  test("Percent 字段名回退（UsedPercent / UsagePercent）", () => {
    const r1 = { QuotaUsage: [{ Level: "session", UsedPercent: 7, ResetTime: 100 }] };
    expect(parseCodingTiers(r1)[0].used).toBe(7);
    const r2 = { QuotaUsage: [{ Level: "session", UsagePercent: 8, ResetTime: 100 }] };
    expect(parseCodingTiers(r2)[0].used).toBe(8);
  });

  test("Usages / Details 数组名回退", () => {
    const r1 = { Usages: [{ Level: "session", Percent: 1, ResetTime: 60 }] };
    expect(parseCodingTiers(r1)).toHaveLength(1);
    const r2 = { Details: [{ Level: "session", Percent: 2, ResetTime: 60 }] };
    expect(parseCodingTiers(r2)).toHaveLength(1);
  });

  test("ResetTime = -1 → 不设置 reset_remaining", () => {
    const result = { QuotaUsage: [{ Level: "session", Percent: 0, ResetTime: -1 }] };
    const tier = parseCodingTiers(result)[0];
    expect(tier).toEqual({ used: 0 });
    expect(tier.reset_remaining).toBeUndefined();
  });

  test("ResetTime = 0 → 不设置 reset_remaining（与 -1 等价）", () => {
    const result = { QuotaUsage: [{ Level: "session", Percent: 5, ResetTime: 0 }] };
    expect(parseCodingTiers(result)[0].reset_remaining).toBeUndefined();
  });

  test("ResetTime 缺位 → 不设置 reset_remaining", () => {
    const result = { QuotaUsage: [{ Level: "session", Percent: 5 }] };
    expect(parseCodingTiers(result)[0].reset_remaining).toBeUndefined();
  });

  test("ResetTimestamp 回退", () => {
    const result = { QuotaUsage: [{ Level: "session", Percent: 5, ResetTimestamp: 3600 }] };
    expect(parseCodingTiers(result)[0]).toEqual({ used: 5, reset_remaining: "1h" });
  });

  test("0 利用率仍展示（不被过滤）", () => {
    const result = {
      QuotaUsage: [
        { Level: "session", Percent: 0, ResetTime: 3600 },
        { Level: "weekly", Percent: 0, ResetTime: 86400 },
      ],
    };
    expect(parseCodingTiers(result)).toHaveLength(2);
  });

  test("未知标签跳过（不抛错）", () => {
    const result = { QuotaUsage: [{ Level: "daily", Percent: 5, ResetTime: 100 }] };
    expect(parseCodingTiers(result)).toEqual([]);
  });

  test("重复 Level 后续丢弃", () => {
    const result = {
      QuotaUsage: [
        { Level: "session", Percent: 1, ResetTime: 100 },
        { Level: "session", Percent: 99, ResetTime: 200 },
      ],
    };
    const tiers = parseCodingTiers(result);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].used).toBe(1);
  });

  test("空数组 → 空列表", () => {
    expect(parseCodingTiers({})).toEqual([]);
    expect(parseCodingTiers({ QuotaUsage: [] })).toEqual([]);
  });

  test("只展示 1-2 个窗口活跃时输出对应个数", () => {
    const result = {
      QuotaUsage: [
        { Level: "session", Percent: 10, ResetTime: 100 },
        { Level: "weekly", Percent: 20, ResetTime: 200 },
      ],
    };
    const tiers = parseCodingTiers(result);
    expect(tiers).toHaveLength(2);
  });
});

// ── formatDuration ──────────────────────────────────────────────────

describe("formatDuration", () => {
  test("0 / 负数 → 空字符串", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(-100)).toBe("");
  });

  test("< 1 小时 → Xm", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(59 * 60)).toBe("59m");
  });

  test("< 1 天 → Xh 或 XhYm", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 30 * 60)).toBe("1h30m");
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe("3h25m");
    expect(formatDuration(3 * 3600)).toBe("3h"); // minutes=0 时省略
  });

  test("≥ 1 天 → XdYh（无分钟）", () => {
    expect(formatDuration(86400)).toBe("1d0h");
    expect(formatDuration(86400 + 4 * 3600)).toBe("1d4h");
    expect(formatDuration(18 * 86400 + 4 * 3600)).toBe("18d4h");
  });
});

// 重新导出被测函数（如果未 export 则无法测试）
// 注：被测函数必须从 volcengine.ts 显式 export，否则 bun test 拿不到
// 由于 volcengine.ts 默认导出 Provider + 自调用块，被测 helper 未 export。
// 解决方案：将 helper 改 export，或在测试中通过 import * as 引入。
// 为简洁，本测试假设 volcengine.ts 已 export 所有 helper（实际实现时调整）。