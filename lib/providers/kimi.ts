// lib/providers/kimi.ts
// Kimi / Moonshot 余额查询 Provider

import { timeoutFetchJson } from "../timeoutFetch.ts";
import { runProvider } from "../runProvider.ts";
import type { Provider, ProviderResponse } from "./types.ts";

type KimiRaw = {
  status?: number;
  data?: { available_balance?: number };
};

const provider: Provider = {
  name: "Kimi",
  envKey: "MOONSHOT_API_KEY",
  domains: ["api.moonshot.cn"],
  fetchRaw: async (key): Promise<ProviderResponse> => {
    const raw = await timeoutFetchJson<KimiRaw>(
      "https://api.moonshot.cn/v1/users/me/balance",
      {
        headers: { "Authorization": `Bearer ${key}` },
      },
    );
    const balance = raw.data?.available_balance ?? 0;
    return { result: { balance, currency: "CNY" }, raw };
  },
};

export default provider;

if (import.meta.url === `file://${process.argv[1]}`) {
  await runProvider(provider, {
    formatText: (r) => `剩余: ¥${r.balance.toFixed(2)}`,
  });
}
