const API_URL = "https://www.minimaxi.com/v1/token_plan/remains";
const TIMEOUT_MS = 10_000;

const json = process.argv.includes("--json");
const apiKey = process.env.MINIMAX_API_KEY;

if (!apiKey) {
  console.error("错误: 请设置环境变量 MINIMAX_API_KEY");
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch(API_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
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

  if (data.base_resp?.status_code !== 0) {
    console.error(`错误: ${data.base_resp?.status_msg || "未知错误"}`);
    process.exit(1);
  }

  const general = data.model_remains?.find((m: { model_name: string }) => m.model_name === "general");
  const remaining = general?.current_interval_remaining_percent as number;
  const used = 100 - remaining;
  const remainsMs = general?.remains_time as number;
  const remainsH = Math.floor(remainsMs / 3600000);
  const remainsM = Math.floor((remainsMs % 3600000) / 60000);
  const resetStr = remainsH > 0 ? `${remainsH}h${remainsM}m` : `${remainsM}m`;

  if (json) {
    console.log(JSON.stringify({
      provider: "minimax",
      balance: remaining,
      used,
      currency: "percent",
      reset_remaining: resetStr,
      raw: data,
    }));
  } else {
    console.log(`5 小时: %${used}，重置: ${resetStr}`);
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
