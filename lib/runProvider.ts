// lib/runProvider.ts
// 共享 CLI 入口：env 检查 + fetchRaw + 错误 catch + --json 输出。
// 由 lib/providers/<name>.ts 在文件末尾自调用，使 `bun lib/providers/<name>.ts` 独立运行。

import { lookupCreds } from "./creds.ts";
import type { Provider, ProviderCredentials } from "./providers/types.ts";

export type ProviderRunOptions = {
  /** 终端输出文案（默认："剩余: ¥X.XX"）；MiniMax 传 "5 小时: %X，重置: XhYm" */
  formatText: (result: import("./providers/types.ts").BalanceResult) => string;
};

/**
 * 单 provider CLI 主流程。
 * - 缺 env → console.error + exit(1)
 * - 调用 provider.fetchRaw → 拿到 result + raw
 * - 错误 catch：AbortError 已被 manualFetch 转为 "请求超时 (10 秒)"；
 *   这里是兜底（捕获 HttpError、其他网络错误）
 * - --json：输出 { provider, balance, currency, ..., raw }
 * - 默认：formatText(result)
 */
export async function runProvider(
  provider: Provider,
  options: ProviderRunOptions,
): Promise<void> {
  // 单 Key 模式走 ANTHROPIC_AUTH_TOKEN fallback；双 Key 模式由 lookupCreds 内部处理（不 fallback）
  const env: Record<string, string | undefined> = process.env as Record<string, string | undefined>;
  const creds: ProviderCredentials | null = lookupCreds(provider, env, true);
  if (!creds) {
    const missingKey = provider.envKeys
      ? `${provider.envKeys[0]} 和 ${provider.envKeys[1]}`
      : provider.envKey ?? "(未配置)";
    console.error(`错误: 请设置环境变量 ${missingKey}`);
    process.exit(1);
  }

  const json = process.argv.includes("--json");

  try {
    const { result, raw } = await provider.fetchRaw(creds);

    if (json) {
      const out: Record<string, unknown> = {
        provider: provider.name,
        balance: result.balance,
        currency: result.currency,
      };
      if (result.used !== undefined) out.used = result.used;
      if (result.reset_remaining !== undefined) out.reset_remaining = result.reset_remaining;
      if (result.tiers !== undefined) out.tiers = result.tiers;
      out.raw = raw;
      console.log(JSON.stringify(out));
    } else {
      console.log(options.formatText(result));
    }
  } catch (err: unknown) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}