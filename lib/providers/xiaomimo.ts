// lib/providers/xiaomimo.ts
// Xiaomi Mimo — 无公开余额 API，仅占位显示厂商名称

import type { Provider } from "./types.ts";

const provider: Provider = {
  name: "Xiaomi Mimo",
  envKey: "",
  domains: ["token-plan-cn.xiaomimimo.com"],
};

export default provider;
