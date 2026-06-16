const API_URL = "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage";
const CHROME_COOKIE_DOMAIN = "https://platform.xiaomimimo.com/";
const TIMEOUT_MS = 10_000;

const json = process.argv.includes("--json");

function formatCredits(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

function classifyChromeCookieError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Cannot find module|cannot find the module/i.test(msg)) {
    return "错误: chrome-cookies-secure 包未安装，请运行 `npm install chrome-cookies-secure` 或设置 MIMO_COOKIE 环境变量";
  }
  if (/Keychain|keychain|denied|permission/i.test(msg)) {
    return "错误: Keychain 权限被拒，请到「系统设置 → 隐私与安全 → Keychain」授权，或直接设置 MIMO_COOKIE 环境变量";
  }
  if (/ENOENT|Cannot find|Chrome|not running/i.test(msg)) {
    return "错误: Chrome 未运行或未登录 platform.xiaomimimo.com，请启动 Chrome 并登录后重试";
  }
  return `错误: 从 Chrome 读取 Cookie 失败: ${msg}`;
}

async function loadCookie(): Promise<string | null> {
  if (process.env.MIMO_COOKIE) {
    return process.env.MIMO_COOKIE;
  }

  // chrome-cookies-secure uses NAPI bindings that Bun does not support (uv_async_init).
  // Detect Bun runtime and skip the fallback to avoid a SIGTRAP crash.
  if (process.versions.bun) {
    console.error("提示: Bun runtime 不支持 chrome-cookies-secure（NAPI libuv 不兼容），请设置 MIMO_COOKIE 环境变量或使用 `npx tsx mimo.ts`");
    return null;
  }

  try {
    const chrome = await import("chrome-cookies-secure");
    const header = await chrome.getCookiesPromised(CHROME_COOKIE_DOMAIN, "header");
    return header.replace(/^Cookie:\s*/i, "");
  } catch (err) {
    console.error(classifyChromeCookieError(err));
    return null;
  }
}

const cookie = await loadCookie();
if (!cookie) {
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch(API_URL, {
    headers: {
      "Cookie": cookie,
      "Accept": "application/json",
    },
    signal: controller.signal,
  });

  if (res.status === 401) {
    console.error("错误: 认证失败");
    process.exit(1);
  }
  if (res.status === 429) {
    console.error("错误: 请求过于频繁，请稍后重试");
    process.exit(1);
  }
  if (res.status >= 500) {
    console.error(`错误: 服务商错误 (状态码 ${res.status})`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`错误: HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  if (data.code !== 0) {
    console.error(`错误: ${data.message || "未知错误"}`);
    process.exit(1);
  }

  const item = data.data?.usage?.items?.[0];
  const used = item?.used as number;
  const limit = item?.limit as number;
  const percentUsed = limit > 0 ? (used / limit) * 100 : 0;

  if (json) {
    console.log(JSON.stringify({
      provider: "mimo",
      balance: percentUsed,
      currency: "percent",
      used,
      limit,
      extra: `${formatCredits(used)} / ${formatCredits(limit)} tokens`,
      raw: data,
    }, null, 2));
  } else {
    console.log(`MiMo: ${percentUsed.toFixed(2)}% (${formatCredits(used)} / ${formatCredits(limit)} tokens)`);
  }
} catch (err: unknown) {
  if (err instanceof Error && err.name === "AbortError") {
    console.error("错误: 请求超时 (10 秒)");
  } else {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
  }
  process.exit(1);
} finally {
  clearTimeout(timer);
}

export {};
