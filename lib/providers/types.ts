// lib/providers/types.ts
// Provider 数据层接口 — 不含 stdout 格式化，不含 raw。

export type BalanceResult = {
  /** 原始数值（不带 ¥/% 前缀）；调用方自行格式化 */
  balance: number;
  currency: "CNY" | "percent";
  /** 已用百分比（仅 MiniMax）；balance 是剩余百分比 */
  used?: number;
  /** 重置倒计时（仅 MiniMax），如 "5h0m" */
  reset_remaining?: string;
};

/**
 * 单个 provider 的 fetch 结果：结构化数据 + 原始 API 响应。
 * Standalone 脚本用 raw 放进 JSON 输出；check-balance.ts 不暴露 raw。
 */
export type ProviderResponse = {
  result: BalanceResult;
  raw: unknown;
};

export type Provider = {
  name: string;
  envKey: string;
  /** ANTHROPIC_BASE_URL hostname 命中列表（已小写化） */
  domains: string[];
  /** Provider 入口：返回结构化数据 + 原始响应 */
  fetchRaw: (apiKey: string) => Promise<ProviderResponse>;
};