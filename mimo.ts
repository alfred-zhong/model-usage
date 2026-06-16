const API_URL = "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage";
const TIMEOUT_MS = 10_000;

const json = process.argv.includes("--json");
const cookie = process.env.MIMO_COOKIE;

if (!cookie) {
  console.error("错误: 请设置环境变量 MIMO_COOKIE");
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
      raw: data,
    }, null, 2));
  } else {
    console.log(`${percentUsed.toFixed(2)}%`);
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
