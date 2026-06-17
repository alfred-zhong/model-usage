#!/usr/bin/env bun
// check-balance.ts
// 通用调度器：根据 ANTHROPIC_BASE_URL 域名路由到对应 Provider。
// Provider 数据来自 lib/providers/，本文件负责：缓存、域名路由、Key 查找、输出格式化。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { providers } from "./lib/providers/index.ts";
import type { BalanceResult } from "./lib/providers/types.ts";

export {};
const CACHE_DIR = `${homedir()}/.cache/model-usage`;
const CACHE_FILE = `${CACHE_DIR}/balance.json`;
type CacheEntry = { balance: string; currency: string; extra?: string; ts: number };
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

/** 把 BalanceResult（原始数值）格式化成 check-balance 风格的展示字符串。 */
function formatBalance(r: BalanceResult): { balance: string; extra?: string } {
  if (r.currency === "percent") {
    // MiniMax：balance 是 remaining（剩余 %），按 used 展示
    const used = r.used ?? 100 - r.balance;
    const base = `%${used}`;
    if (r.reset_remaining) return { balance: base, extra: `重置: ${r.reset_remaining}` };
    return { balance: base };
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
      const result = { balance: entry.balance, currency: entry.currency, extra: entry.extra };
      if (json) {
        console.log(JSON.stringify({ provider: provider.name, model, cached: true, ...result }));
      } else {
        console.log(result.extra ? `${provider.name} (${result.balance}，${result.extra})` : `${provider.name} (${result.balance})`);
      }
      return;
    }
  }

  const apiKey = process.env[provider.envKey] || settings[provider.envKey] || settings.ANTHROPIC_AUTH_TOKEN || null;
  if (!apiKey) {
    if (json) {
      console.log(JSON.stringify({ error: `缺少 ${provider.envKey}`, model }));
    } else {
      console.log(`缺少 ${provider.envKey}`);
    }
    return;
  }

  try {
    const { result } = await provider.fetchRaw(apiKey);
    const formatted = formatBalance(result);

    if (ttlMs > 0) {
      const cache = loadCache();
      cache[provider.name] = {
        balance: formatted.balance,
        currency: result.currency,
        extra: formatted.extra,
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
        ...(formatted.extra ? { extra: formatted.extra } : {}),
      }));
    } else {
      console.log(formatted.extra ? `${provider.name} (${formatted.balance}，${formatted.extra})` : `${provider.name} (${formatted.balance})`);
    }
  } catch (err: unknown) {
    if (json) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : "未知错误", model }));
    } else {
      console.log(err instanceof Error ? err.message : "查询失败");
    }
  }
}

main();