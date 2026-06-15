const API_URL = "https://api.deepseek.com/user/balance";
const TIMEOUT_MS = 10_000;

const json = process.argv.includes("--json");
const apiKey = process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error("错误: 请设置环境变量 DEEPSEEK_API_KEY");
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch(API_URL, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    signal: controller.signal,
  });

  if (res.status === 401) {
    console.error("错误: API Key 无效");
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
  const balance = parseFloat(data.balance_infos?.[0]?.total_balance ?? "0");

  if (json) {
    console.log(JSON.stringify({
      provider: "deepseek",
      balance,
      currency: "CNY",
      raw: data,
    }));
  } else {
    console.log(`剩余: ¥${balance.toFixed(2)}`);
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
