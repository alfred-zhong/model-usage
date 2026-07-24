// lib/providers/deepseek.ts
// DeepSeek 余额查询 Provider

import { timeoutFetchJson } from "../timeoutFetch.ts";
import { runProvider } from "../runProvider.ts";
import type { Provider, ProviderResponse } from "./types.ts";
import { GREEN, cnyColor, RESET } from "../colors.ts";

type DeepseekRaw = {
  is_available?: boolean;
  balance_infos?: Array<{ currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }>;
};

const provider: Provider = {
  name: "DeepSeek",
  envKey: "DEEPSEEK_API_KEY",
  domains: ["api.deepseek.com"],
  fetchRaw: async (key): Promise<ProviderResponse> => {
    const raw = await timeoutFetchJson<DeepseekRaw>(
      "https://api.deepseek.com/user/balance",
      {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${key}`,
        },
      },
    );
    const balance = parseFloat(raw.balance_infos?.[0]?.total_balance ?? "0");
    return { result: { balance, currency: "CNY" }, raw };
  },
};

export default provider;

// CLI 入口（ESM 自检测）：仅当本文件被直接执行时运行
if (import.meta.url === `file://${process.argv[1]}`) {
  await runProvider(provider, {
    formatText: (r) => {
      const color = cnyColor(r.balance);
      return `${GREEN}剩余: ${color}¥${r.balance.toFixed(2)}${RESET}`;
    },
  });
}
