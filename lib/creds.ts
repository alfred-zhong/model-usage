// lib/creds.ts
// 统一 Provider 凭据查找：envKey（单 Key）或 envKeys（双 Key AK/SK）。
// 与 check-balance.ts / lib/runProvider.ts 共用，避免两处分支重复。

import type { Provider, ProviderCredentials } from "./providers/types.ts";

/**
 * 从 env 字典查找 Provider 凭据。
 * - provider.envKeys → 读 [AK_ENV, SK_ENV]；任一缺失返回 null
 * - provider.envKey → 读单 Key；fallback 是否走 ANTHROPIC_AUTH_TOKEN 由参数控制
 * - 两者皆无（noop provider）→ 返回 null
 *
 * @param provider Provider 对象
 * @param env 环境变量字典（通常由 caller 合并 process.env + settings.json env）
 * @param fallbackToAnthropicAuthToken 单 Key 模式是否回退到 ANTHROPIC_AUTH_TOKEN
 *   （双 Key 模式不复用此字段——AK 与 SK 是控制面 OpenAPI 的两套独立凭据）
 */
export function lookupCreds(
  provider: Provider,
  env: Record<string, string | undefined>,
  fallbackToAnthropicAuthToken = true,
): ProviderCredentials | null {
  if (provider.envKeys) {
    const [akEnv, skEnv] = provider.envKeys;
    const ak = env[akEnv];
    const sk = env[skEnv];
    if (!ak || !sk) return null;
    return [ak, sk] as const;
  }

  if (provider.envKey) {
    const apiKey = env[provider.envKey]
      || (fallbackToAnthropicAuthToken ? env.ANTHROPIC_AUTH_TOKEN : undefined);
    if (!apiKey) return null;
    return apiKey;
  }

  return null;
}