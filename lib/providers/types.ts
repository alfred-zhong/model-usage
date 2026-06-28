// lib/providers/types.ts
// Provider 数据层接口 — 不含 stdout 格式化，不含 raw。

/** 多窗口 Provider 的单窗口数据（火山引擎 5h / weekly / monthly 等）。 */
export type BalanceTier = {
  /** 已用百分比（0-100+） */
  used: number;
  /** 重置倒计时，如 "3h", "4h19m", "18d4h" */
  reset_remaining?: string;
};

export type BalanceResult = {
  /** 原始数值（不带 ¥/% 前缀）；调用方自行格式化 */
  balance: number;
  currency: "CNY" | "percent";
  /** 已用百分比（仅 MiniMax 单窗口）；balance 是剩余百分比 */
  used?: number;
  /** 重置倒计时（仅 MiniMax 单窗口），如 "5h0m" */
  reset_remaining?: string;
  /** 多窗口 Provider（如火山引擎）；存在时优先于 balance/used/reset_remaining */
  tiers?: BalanceTier[];
};

/**
 * 单个 provider 的 fetch 结果：结构化数据 + 原始 API 响应。
 * Standalone 脚本用 raw 放进 JSON 输出；check-balance.ts 不暴露 raw。
 */
export type ProviderResponse = {
  result: BalanceResult;
  raw: unknown;
};

/**
 * Provider 凭据：
 * - 单 Key Provider（如 Bearer token）传 string
 * - 双 Key Provider（火山 AK/SK）传 readonly tuple [ak, sk]
 */
export type ProviderCredentials = string | readonly [string, string];

export type Provider = {
  name: string;
  /** 单 Key 鉴权环境变量名。与 envKeys 二选一。noop provider 都不设。 */
  envKey?: string;
  /** 双 Key 鉴权环境变量名 [AK_ENV, SK_ENV]。与 envKey 二选一。 */
  envKeys?: [string, string];
  /** ANTHROPIC_BASE_URL hostname 命中列表（已小写化） */
  domains: string[];
  /** Provider 入口：返回结构化数据 + 原始响应；noop provider 不提供 */
  fetchRaw?: (creds: ProviderCredentials) => Promise<ProviderResponse>;
};