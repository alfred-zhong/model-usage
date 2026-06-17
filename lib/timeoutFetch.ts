// lib/timeoutFetch.ts
// 共享 HTTP 调用层：AbortController + 错误分类 + JSON 解析。
// 由 Provider 模块和 check-balance.ts 调用；不导出 stdout 格式化。

export const TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * 带超时的 fetch + 自动 JSON 解析。
 * - 10 秒超时（AbortController）
 * - 非 2xx 响应：抛 HttpError（带 status 字段）
 * - 2xx 响应：res.json()，解析失败抛"响应解析失败"
 * - 网络层错误（DNS / 连接拒绝 / SSL）：原样透传
 * - AbortError：抛"请求超时 (10 秒)"
 */
export async function timeoutFetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });

    if (!res.ok) {
      // 按 HTTP 状态分类（与原 standalone 脚本风格对齐）
      if (res.status === 401) throw new HttpError("API Key 无效", 401);
      if (res.status === 429) throw new HttpError("请求过于频繁，请稍后重试", 429);
      if (res.status >= 500) throw new HttpError(`服务商错误 (状态码 ${res.status})`, res.status);
      throw new HttpError(`HTTP ${res.status}`, res.status);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new Error("响应解析失败");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("请求超时 (10 秒)");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}