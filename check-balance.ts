#!/usr/bin/env bun
// check-balance.ts
// 通用调度器：根据 ANTHROPIC_BASE_URL 域名路由到对应 Provider。
// Provider 数据来自 lib/providers/，本文件负责：缓存、域名路由、Key 查找、输出格式化。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { lookupCreds } from "./lib/creds.ts";
import { providers } from "./lib/providers/index.ts";
import type { BalanceResult } from "./lib/providers/types.ts";

export { };
const CACHE_DIR = `${homedir()}/.cache/model-usage`;
const CACHE_FILE = `${CACHE_DIR}/balance.json`;

/**
 * Cache schema 存原始数值（呼应 1B + OV-1 / OV-3 修正）：
 * - 旧版本 balance 字段存格式化展示串（如 "%4"），cache hit 路径再走 formatBalance
 *   会做 100 - "%4" = NaN。新版本存数值，重加载时重建 BalanceResult 再格式化。
 * - OV-3：单窗口 percent Provider（如 MiniMax）的 used / reset_remaining 也必须存
 *   原始值；否则 cache hit 重建的 BalanceResult 缺失这两个字段，formatBalance 的
 *   percent 分支只输出 `%X`，不再输出 `重置: XhYm`。
 */
type CacheTier = { used: number; reset_remaining?: string };
export type CacheEntry = {
  /** 数值型 Provider 的原始 balance（如 96） */
  balance: number;
  currency: string;
  /** MiniMax 这类单窗口 percent Provider 的已用百分比（来自 provider.fetchRaw） */
  used?: number;
  /** 单窗口 percent Provider 的重置倒计时（格式化串，如 "3h22m"） */
  reset_remaining?: string;
  /** 多窗口 Provider（如火山）的 tiers 原始数据 */
  tiers?: CacheTier[];
  /** 格式化后的展示串缓存（向后兼容旧 cache 文件；不参与格式重建） */
  extra?: string;
  ts: number;
};
type Cache = Record<string, CacheEntry>;

function loadSettings(): Record<string, string> {
  try {
    const raw = readFileSync(`${homedir()}/.claude/settings.json`, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.env ?? {};
  } catch {
    return {};
  }
}

function loadCache(): Cache {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Cache) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch { /* ignore */ }
}

function parseTtl(args: string[], settings: Record<string, string>): number {
  const flagIdx = args.indexOf("--cache-ttl");
  if (flagIdx !== -1 && args[flagIdx + 1]) return parseInt(args[flagIdx + 1], 10) * 1000;
  const envTtl = process.env.BALANCE_CACHE_TTL || settings.BALANCE_CACHE_TTL;
  if (envTtl) return parseInt(envTtl, 10) * 1000;
  return 60_000;
}

/** 把单 tier 格式化为 `%X`（无重置）或 `%X - YhZm`（有重置）。 */
function formatTier(used: number, reset_remaining?: string): string {
  return reset_remaining ? `%${used} - ${reset_remaining}` : `%${used}`;
}

/** 把 BalanceResult（原始数值）格式化成 check-balance 风格的展示字符串。 */
export function formatBalance(r: BalanceResult): { balance: string } {
  // 多窗口 Provider（火山）：tiers 数组用 ', ' join；每个 tier 内联自己的重置时间
  if (r.tiers && r.tiers.length > 0) {
    return {
      balance: r.tiers.map((t) => formatTier(t.used, t.reset_remaining)).join(", "),
    };
  }
  // 单窗口 percent（如 MiniMax）：inline reset
  if (r.currency === "percent") {
    const used = r.used ?? 100 - r.balance;
    return { balance: formatTier(used, r.reset_remaining) };
  }
  // CNY
  return { balance: `¥${r.balance.toFixed(2)}` };
}

async function main() {
  const settings = loadSettings();
  const baseUrl = process.env.ANTHROPIC_BASE_URL || settings.ANTHROPIC_BASE_URL || "";
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // 无效 URL 时 hostname 留空，下面会落到"未匹配到服务商"分支
  }
  const model = process.env.ANTHROPIC_MODEL || settings.ANTHROPIC_MODEL || "";
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const force = args.includes("--force");
  const ttlMs = parseTtl(args, settings);

  const provider = providers.find(p => p.domains.includes(hostname));

  if (!provider) {
    if (json) {
      console.log(JSON.stringify({ error: "未匹配到服务商", model, baseUrl }));
    } else {
      console.error(`未匹配到服务商（baseUrl=${baseUrl || "(空)"}，model=${model || "(空)"}）。可用 baseUrl 域名见 CLAUDE.md，或用 --json 查看详细信息。`);
    }
    return;
  }

  // Noop provider: 无 API，直接输出厂商名称
  if (!provider.fetchRaw) {
    if (json) {
      console.log(JSON.stringify({ provider: provider.name, model, noApi: true }));
    } else {
      console.log(provider.name);
    }
    return;
  }

  // check cache
  if (ttlMs > 0 && !force) {
    const cache = loadCache();
    const entry = cache[provider.name];
    if (entry && Date.now() - entry.ts < ttlMs) {
      // 从 cache entry 重建 BalanceResult，再走同一 formatBalance 路径（避免 %NaN / 丢 reset_remaining）
      const result: BalanceResult = {
        balance: entry.balance,
        currency: entry.currency as "CNY" | "percent",
        ...(entry.used !== undefined ? { used: entry.used } : {}),
        ...(entry.reset_remaining ? { reset_remaining: entry.reset_remaining } : {}),
        ...(entry.tiers ? { tiers: entry.tiers } : {}),
      };
      const formatted = formatBalance(result);
      if (json) {
        console.log(JSON.stringify({
          provider: provider.name,
          model,
          cached: true,
          balance: formatted.balance,
          currency: result.currency,
        }));
      } else {
        console.log(`${provider.name} (${formatted.balance})`);
      }
      return;
    }
  }

  // 凭据查找：双 Key (envKeys) / 单 Key (envKey) / fallback ANTHROPIC_AUTH_TOKEN
  // 双 Key 不对 ANTHROPIC_AUTH_TOKEN fallback —— AK/SK 是控制面 OpenAPI 的两套独立凭据
  const env: Record<string, string | undefined> = {
    ...process.env as Record<string, string | undefined>,
    ...settings,
  };
  const creds = lookupCreds(provider, env, true);
  if (!creds) {
    const missingKey = provider.envKeys
      ? `${provider.envKeys[0]} 或 ${provider.envKeys[1]}`
      : provider.envKey ?? "(未配置)";
    if (json) {
      console.log(JSON.stringify({ error: `缺少 ${missingKey}`, model }));
    } else {
      console.log(`缺少 ${missingKey}`);
    }
    return;
  }

  try {
    const { result } = await provider.fetchRaw(creds);
    const formatted = formatBalance(result);

    if (ttlMs > 0) {
      const cache = loadCache();
      // 写 cache 存原始数值（呼应 1B + OV-3）；旧 cache 文件读端的 `extra` 字段保留以兼容
      cache[provider.name] = {
        balance: result.balance,
        currency: result.currency,
        used: result.used,
        reset_remaining: result.reset_remaining,
        tiers: result.tiers,
        ts: Date.now(),
      };
      saveCache(cache);
    }

    if (json) {
      console.log(JSON.stringify({
        provider: provider.name,
        model,
        balance: formatted.balance,
        currency: result.currency,
      }));
    } else {
      console.log(`${provider.name} (${formatted.balance})`);
    }
  } catch (err: unknown) {
    if (json) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : "未知错误", model }));
    } else {
      console.log(err instanceof Error ? err.message : "查询失败");
    }
  }
}

// ESM 自检测：仅当本文件作为入口脚本运行时执行 main()，被 bun test 导入时不触发。
// 与 lib/providers/<name>.ts 的自调用块风格一致。
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
