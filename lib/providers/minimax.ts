// lib/providers/minimax.ts
// MiniMax Token Plan 用量查询 Provider

import { timeoutFetchJson } from "../timeoutFetch.ts";
import { runProvider } from "../runProvider.ts";
import type { Provider, ProviderResponse } from "./types.ts";
import { GREEN, percentColor, RESET } from "../colors.ts";

type MinimaxRaw = {
  model_remains?: Array<{
    model_name: string;
    current_interval_remaining_percent: number;
    current_weekly_remaining_percent: number;
    current_interval_status: number;
    remains_time: number;
  }>;
  base_resp?: { status_code: number; status_msg?: string };
};

const provider: Provider = {
  name: "MiniMax",
  envKey: "MINIMAX_API_KEY",
  domains: ["www.minimaxi.com", "api.minimaxi.com"],
  fetchRaw: async (key): Promise<ProviderResponse> => {
    const raw = await timeoutFetchJson<MinimaxRaw>(
      "https://www.minimaxi.com/v1/token_plan/remains",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (raw.base_resp?.status_code !== 0) {
      throw new Error(raw.base_resp?.status_msg || "未知错误");
    }
    const general = raw.model_remains?.find((m) => m.model_name === "general");
    const remaining = general?.current_interval_remaining_percent ?? 0;
    const used = 100 - remaining;
    const remainsMs = general?.remains_time ?? 0;
    const h = Math.floor(remainsMs / 3600000);
    const min = Math.floor((remainsMs % 3600000) / 60000);
    const reset = h > 0 ? `${h}h${min}m` : `${min}m`;
    return {
      result: { balance: remaining, currency: "percent", used, reset_remaining: reset },
      raw,
    };
  },
};

export default provider;

if (import.meta.url === `file://${process.argv[1]}`) {
  await runProvider(provider, {
    formatText: (r) => {
      const used = r.used ?? 0;
      return `${GREEN}5 小时: ${percentColor(used)}%${used}${GREEN}: ${r.reset_remaining}${RESET}`;
    },
  });
}
