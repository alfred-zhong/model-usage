// lib/providers/index.ts
// Provider 注册表 — check-balance.ts 的唯一扩展点

import deepseek from "./deepseek.ts";
import minimax from "./minimax.ts";
import kimi from "./kimi.ts";
import xiaomimo from "./xiaomimo.ts";
import volcengine from "./volcengine.ts";
import type { Provider } from "./types.ts";

export const providers: Provider[] = [deepseek, minimax, kimi, xiaomimo, volcengine];

export type { Provider, BalanceResult, ProviderResponse } from "./types.ts";