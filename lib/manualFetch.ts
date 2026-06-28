// lib/manualFetch.ts
// 共享 HTTP 层（精简版）：fetch + AbortController + 10s 超时，返回原始 Response。
//
// 与 timeoutFetch.ts 的区别：
// - 不自动 res.json()（不假设 2xx 即成功）
// - 不按状态码抛 HttpError（由调用方决定如何处理非 2xx 与 200+错误信封）
// - 仍负责 10s 超时 + 网络错误透传 + AbortError 转中文
//
// 用于需要检查 200 + ResponseMetadata.Error 信封的场景（火山 OpenAPI）。

export const TIMEOUT_MS = 10_000;

/**
 * 带 10 秒超时的 fetch。返回原始 Response，由调用方决定如何处理非 2xx。
 * - 网络层错误（DNS / 连接拒绝 / SSL）：原样透传
 * - AbortError：抛 "请求超时 (10 秒)"
 * - HTTP 状态：原样返回，不抛错
 */
export async function manualFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("请求超时 (10 秒)");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}