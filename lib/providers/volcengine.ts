// lib/providers/volcengine.ts
// 火山方舟 Coding Plan 用量查询 Provider
//
// 与 Kimi/MiniMax（数据面 Bearer 余额接口）不同，火山用量接口是**控制面 OpenAPI**：
// 统一网关 `open.volcengineapi.com`（**不是**数据面推理域名 `ark.cn-beijing.volces.com`），
// 形如 `POST https://open.volcengineapi.com/?Action=...&Version=2024-01-01&Region=cn-beijing`，
// 强制火山引擎签名 V4（AK/SK）——实测复用推理 Bearer Key 会被网关以
// `400 InvalidAuthorization` 拒绝（格式层拒绝，非权限问题）。因此用户需在用量查询
// 里另填火山账号的 AccessKey ID + Secret（与推理 Key 是两套凭据）。
//
// SigV4 签名 (火山变体) 数据流:
//   now + ak/sk
//     │
//     ▼
//   short_date / x_date / x_content_sha256
//     │
//     ▼
//   canonical_request = "POST\n/\n<query>\n<headers>\n<signed_headers>\n<hash>"
//     │
//     ▼
//   string_to_sign = "HMAC-SHA256\n<x_date>\n<credential_scope>\n<hash>"
//     │
//     ▼
//   k_date = HMAC(sk, date) → k_region → k_service → k_signing
//     │
//     ▼
//   signature = HMAC(k_signing, string_to_sign)
//     │
//     ▼
//   Authorization: HMAC-SHA256 Credential=<ak>/<scope>, ...
//
// 响应处理:
//   POST open.volcengineapi.com/?Action=GetCodingPlanUsage&...
//     │
//     ▼
//   HTTP 200 + { ResponseMetadata: { Error: null|{Code, Message} }, Result: { ... } }
//     │
//     ├── 2xx + Error 信封 → 鉴权错（带 auth code）/ 业务错
//     ├── 4xx + Error 信封 → 同上
//     └── 2xx + Result → parse_coding_tiers() → BalanceTier[]

import { createHmac, createHash } from "node:crypto";
import { manualFetch } from "../manualFetch.ts";
import { runProvider } from "../runProvider.ts";
import type { BalanceTier, Provider } from "./types.ts";

// ── 常量 ────────────────────────────────────────────────────────────

/** 控制面 OpenAPI 统一网关（区别于数据面推理域名 ark.cn-beijing.volces.com）。 */
const VOLCENGINE_OPENAPI_HOST = "open.volcengineapi.com";
const VOLCENGINE_API_VERSION = "2024-01-01";
/** ark 控制面 OpenAPI 的默认 Region（Coding Plan 目前在 cn-beijing）。 */
const VOLCENGINE_DEFAULT_REGION = "cn-beijing";

const VOLCENGINE_SERVICE = "ark";
const VOLCENGINE_CONTENT_TYPE = "application/json; charset=utf-8";
/** 固定顺序，火山 SigV4 特有（**不按字母序**；与 s3.rs 标准 SigV4 不同）。 */
const VOLCENGINE_SIGNED_HEADERS = "host;x-date;x-content-sha256;content-type";

const VOLCENGINE_AKSK_HINT =
  "Check the AccessKey ID / Secret are correct and the account has Ark usage-query (OpenAPI) permission.";

// ── crypto helpers ──────────────────────────────────────────────────

export function volcSha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function volcHmacSha256(key: Buffer | string, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

// ── RFC3986 URI encode ──────────────────────────────────────────────

/** RFC3986 unreserved 之外全部按 `%XX` 编码（用于 canonical query string）。 */
export function volcUriEncode(input: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  let out = "";
  for (const byte of bytes) {
    if (
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || byte === 0x5f || byte === 0x2e || byte === 0x7e // -_.~
    ) {
      out += String.fromCharCode(byte);
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

// ── SigV4 签名 ──────────────────────────────────────────────────────

/**
 * 构造按 key 字母序排序、逐段 URL 编码的 canonical query string。
 * 同一份字符串既用于签名也用于实际请求 URL，保证两者完全一致。
 */
export function volcCanonicalQuery(action: string, region: string): string {
  const pairs: Array<[string, string]> = [
    ["Action", action],
    ["Region", region],
    ["Version", VOLCENGINE_API_VERSION],
  ];
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${volcUriEncode(k)}=${volcUriEncode(v)}`).join("&");
}

/**
 * 生成火山引擎签名 V4 的鉴权头。
 * 算法是 AWS SigV4 的火山变体（两处差异：固定 header 顺序、HMAC-SHA256 无 AWS4 前缀）。
 * `now` 作参数传入便于单测做确定性比对。
 */
export function volcSign(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  canonicalQuery: string,
  body: Buffer | string,
  now: Date,
): { authorization: string; xDate: string; xContentSha256: string } {
  // ISO 8601 → 火山 SigV4 形式：YYYYMMDDTHHMMSSZ
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const xContentSha256 = volcSha256Hex(bodyBuf);

  // 固定顺序 canonical headers（火山特有，**不排序**）。
  const canonicalHeaders =
    `host:${VOLCENGINE_OPENAPI_HOST}\n` +
    `x-date:${xDate}\n` +
    `x-content-sha256:${xContentSha256}\n` +
    `content-type:${VOLCENGINE_CONTENT_TYPE}\n`;
  const canonicalRequest =
    `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${VOLCENGINE_SIGNED_HEADERS}\n${xContentSha256}`;
  const credentialScope = `${shortDate}/${region}/${VOLCENGINE_SERVICE}/request`;
  const stringToSign =
    `HMAC-SHA256\n${xDate}\n${credentialScope}\n${volcSha256Hex(canonicalRequest)}`;

  // 签名密钥派生：kDate=HMAC(SK, date)（SK **不加** AWS4 前缀），终止串 `request`。
  const kDate = volcHmacSha256(secretAccessKey, shortDate);
  const kRegion = volcHmacSha256(kDate, region);
  const kService = volcHmacSha256(kRegion, VOLCENGINE_SERVICE);
  const kSigning = volcHmacSha256(kService, "request");
  const signature = volcHmacSha256(kSigning, stringToSign).toString("hex");

  const authorization =
    `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${VOLCENGINE_SIGNED_HEADERS}, Signature=${signature}`;
  return { authorization, xDate, xContentSha256 };
}

// ── Region 提取 ─────────────────────────────────────────────────────

/**
 * 从数据面 base_url 提取控制面 OpenAPI 所需的 Region
 * （如 `ark.cn-beijing.volces.com` → `cn-beijing`）；无法识别时回落 cn-beijing。
 */
export function volcRegion(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    const part = host.split(".").find((p) => p.startsWith("cn-") || p.startsWith("ap-"));
    if (part) return part;
  } catch {
    // 无效 URL 走 fallback
  }
  return VOLCENGINE_DEFAULT_REGION;
}

// ── 响应错误检测 ────────────────────────────────────────────────────

/** 判断 OpenAPI 错误码是否属于鉴权类（需要硬停并提示换 AK/SK）。 */
export function volcIsAuthErrorCode(code: string): boolean {
  const c = code.toLowerCase();
  return c.includes("auth")
    || c.includes("signature")
    || c.includes("accessdenied")
    || c.includes("denied")
    || c.includes("unauthorized")
    || c.includes("forbidden")
    || c.includes("credential")
    || c.includes("token");
}

/** 提取火山 OpenAPI 响应里的 `ResponseMetadata.Error`（或顶层 `Error`）。 */
export function volcExtractError(body: Record<string, unknown>): { code: string; msg: string } | null {
  const meta = body.ResponseMetadata as { Error?: { Code?: string; Message?: string } } | undefined;
  const err = meta?.Error ?? (body.Error as { Code?: string; Message?: string } | undefined);
  if (!err) return null;
  const code = err.Code ?? "";
  const msg = err.Message ?? "";
  if (!code && !msg) return null;
  return { code, msg };
}

// ── OpenAPI 调用 ────────────────────────────────────────────────────

/** 单次 OpenAPI 调用的归类结果。 */
type VolcCall =
  | { kind: "body"; body: Record<string, unknown> }
  | { kind: "auth"; detail: string }
  | { kind: "soft"; detail: string };

async function volcOpenapiCall(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  action: string,
  now: Date = new Date(),
): Promise<VolcCall> {
  // canonical query 同时用于签名与实际 URL，确保两者逐字一致（否则签名不匹配）。
  const canonicalQuery = volcCanonicalQuery(action, region);
  const url = `https://${VOLCENGINE_OPENAPI_HOST}/?${canonicalQuery}`;
  const body = Buffer.alloc(0);
  const { authorization, xDate, xContentSha256 } = volcSign(
    accessKeyId,
    secretAccessKey,
    region,
    canonicalQuery,
    body,
    now,
  );

  const resp = await manualFetch(url, {
    method: "POST",
    headers: {
      "X-Date": xDate,
      "X-Content-Sha256": xContentSha256,
      "Content-Type": VOLCENGINE_CONTENT_TYPE,
      "Authorization": authorization,
    },
    body,
  });

  const status = resp.status;
  const rawText = await resp.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // 解析失败按 raw text 兜底
    if (status === 401 || status === 403) {
      return {
        kind: "auth",
        detail: `Authentication failed (HTTP ${status}). ${VOLCENGINE_AKSK_HINT}`,
      };
    }
    if (!resp.ok) {
      return { kind: "soft", detail: `API error (HTTP ${status}): ${rawText.slice(0, 200)}` };
    }
    return { kind: "soft", detail: `Failed to parse response: ${rawText.slice(0, 200)}` };
  }

  // 火山 OpenAPI 网关对签名/凭据类错误常返 4xx（多为 HTTP 400）并携带与 200 路径相同的
  // ResponseMetadata.Error 信封，而非 401/403。这里也解析信封，让 Bearer 被拒时仍能
  // 给出 AK/SK 引导并标记凭据失效。
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      detail: volcExtractError(parsed)
        ? `Authentication failed (HTTP ${status}, ${volcExtractError(parsed)!.code}): ${volcExtractError(parsed)!.msg}. ${VOLCENGINE_AKSK_HINT}`
        : `Authentication failed (HTTP ${status}). ${VOLCENGINE_AKSK_HINT}`,
    };
  }
  if (!resp.ok) {
    const err = volcExtractError(parsed);
    if (err && volcIsAuthErrorCode(err.code)) {
      return {
        kind: "auth",
        detail: `Authentication failed (HTTP ${status}, ${err.code}): ${err.msg}. ${VOLCENGINE_AKSK_HINT}`,
      };
    }
    return { kind: "soft", detail: `API error (HTTP ${status}${err ? `, ${err.code}` : ""}): ${err?.msg ?? rawText.slice(0, 200)}` };
  }

  // 业务错误也可能以 200 + ResponseMetadata.Error 返回。
  // **关键**：即使 status=2xx，若错误码含鉴权类子串，仍按 Auth 处理（OV-2 修正）。
  const err = volcExtractError(parsed);
  if (err) {
    if (volcIsAuthErrorCode(err.code)) {
      return {
        kind: "auth",
        detail: `Authentication failed (${err.code}): ${err.msg}. ${VOLCENGINE_AKSK_HINT}`,
      };
    }
    return { kind: "soft", detail: `API error (${err.code}): ${err.msg}` };
  }

  return { kind: "body", body: parsed };
}

// ── Coding Plan 响应解析 ────────────────────────────────────────────

/** 把 `GetCodingPlanUsage` 的 window 标签归一到 tier 名。 */
export function volcCodingWindow(label: string): "session" | "weekly" | "monthly" | null {
  const l = label.toLowerCase();
  if (l === "session" || l === "5h" || l === "fivehour" || l === "five_hour" || l === "rolling_5h") {
    return "session";
  }
  if (l === "weekly" || l === "week" || l === "7d") {
    return "weekly";
  }
  if (l === "monthly" || l === "month") {
    return "monthly";
  }
  return null;
}

/** 从数字或数字字符串解析浮点。 */
export function parseF64(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 从 ResetTime 字段提取剩余秒数；`-1` 等负值视为无重置。
 *
 * API 实际返回的是**绝对 unix 时间戳**（秒级，~1.78e9），不是相对剩余秒数。
 * 旧启发式 `n < 1e12` 阈值太宽，把这种时间戳当剩余秒数，导致 `20632d` 这种输出。
 *
 * 新启发式：
 * - `n >= 1e12`：unix 时间戳（毫秒），先除 1000
 * - `1e9 <= n < 1e12`：unix 时间戳（秒），2001 年之后
 * - `n < 1e9`：相对剩余秒数（最长 ~31 年，足够覆盖所有 quota 窗口）
 *
 * `nowMs` 参数用于单测做确定性比对（避免依赖 Date.now）。
 */
export function parseResetSeconds(v: unknown, nowMs: number = Date.now()): number | null {
  const n = parseF64(v);
  if (n === null) return null;
  if (n <= 0) return null; // 含 -1 sentinel
  if (n >= 1e9) {
    const targetSec = n >= 1e12 ? Math.floor(n / 1000) : n;
    const remaining = targetSec - Math.floor(nowMs / 1000);
    return remaining > 0 ? remaining : null;
  }
  return n;
}

/**
 * 解析 `GetCodingPlanUsage` 的 `Result` 为 tier 列表（防御式）。
 * 官方文档未给出逐字段规格；宽松匹配 `QuotaUsage`/`Usages`/`Details` 数组
 * 及多种字段名，命中即用、未命中跳过。
 */
export function parseCodingTiers(result: Record<string, unknown>): BalanceTier[] {
  const arr =
    (Array.isArray(result.QuotaUsage) && (result.QuotaUsage as unknown[])) ||
    (Array.isArray(result.Usages) && (result.Usages as unknown[])) ||
    (Array.isArray(result.Details) && (result.Details as unknown[])) ||
    [];
  const seen = new Set<string>();
  const tiers: BalanceTier[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const label =
      (typeof item.Level === "string" && item.Level) ||
      (typeof item.Type === "string" && item.Type) ||
      (typeof item.Period === "string" && item.Period) ||
      (typeof item.Label === "string" && item.Label) ||
      (typeof item.Window === "string" && item.Window) ||
      "";
    const window = volcCodingWindow(label);
    if (!window || seen.has(window)) continue;
    seen.add(window);
    const used = Math.round(
      parseF64(item.Percent) ??
      parseF64(item.UsedPercent) ??
      parseF64(item.UsagePercent) ??
      0,
    );
    const resetSeconds = parseResetSeconds(item.ResetTime ?? item.ResetTimestamp);
    const tier: BalanceTier = { used };
    if (resetSeconds !== null) {
      tier.reset_remaining = formatDuration(resetSeconds);
    }
    tiers.push(tier);
  }
  return tiers;
}

/** 把秒数格式化为 "Xh" / "XhYm" / "XdYh"（≥1d 跳分钟，<1d 跳小时）。 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

// ── Provider ────────────────────────────────────────────────────────

const provider: Provider = {
  name: "火山引擎",
  envKeys: ["VOLCENGINE_ACCESS_KEY_ID", "VOLCENGINE_SECRET_ACCESS_KEY"],
  domains: ["ark.cn-beijing.volces.com"],
  fetchRaw: async (creds) => {
    if (typeof creds === "string") {
      throw new Error("火山引擎需要双 Key 鉴权 (AK + SK)");
    }
    const [ak, sk] = creds;
    const baseUrl = process.env.ANTHROPIC_BASE_URL || "";
    const region = volcRegion(baseUrl);

    const call = await volcOpenapiCall(ak, sk, region, "GetCodingPlanUsage");
    if (call.kind === "auth") {
      throw new Error(
        `鉴权失败：${call.detail} 请检查 VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY 是否正确，并确认账号有 Ark Coding Plan 用量查询权限。`,
      );
    }
    if (call.kind === "soft") {
      throw new Error(call.detail);
    }

    // call.body 是原始 OpenAPI 响应 JSON（含 ResponseMetadata + Result）。
    // 大多数响应把数据放在 `Result` 字段里，但官方文档未强约束——防御式 unwrap。
    const result = (call.body.Result as Record<string, unknown> | undefined) ?? call.body;
    const tiers = parseCodingTiers(result);
    if (tiers.length === 0) {
      throw new Error("未找到 Coding Plan 订阅（或响应字段名变化）。请确认账号已开通 Coding Plan。");
    }
    return {
      // balance/currency 是 BalanceResult 的必填字段；tiers 路径下它们是占位。
      // formatBalance() 看到 tiers 存在时优先走 tiers 分支，不会读 balance。
      result: { balance: 0, currency: "percent", tiers },
      raw: call.body,
    };
  },
};

export default provider;

// CLI 自调用块（与 minimax.ts 风格一致）
if (import.meta.url === `file://${process.argv[1]}`) {
  const ak = process.env.VOLCENGINE_ACCESS_KEY_ID;
  const sk = process.env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!ak || !sk) {
    console.error("错误: 请设置 VOLCENGINE_ACCESS_KEY_ID 和 VOLCENGINE_SECRET_ACCESS_KEY");
    process.exit(1);
  }
  await runProvider(provider, {
    formatText: (r) => {
      const pct = r.tiers!.map((t) => `%${t.used}`).join(" ");
      const reset = r.tiers!.map((t) => t.reset_remaining ?? "-").join(" ");
      return `Coding Plan: ${pct} 重置: ${reset}`;
    },
  });
}
