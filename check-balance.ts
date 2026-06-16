#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

export {};
const TIMEOUT_MS = 10_000;
const CACHE_DIR = `${homedir()}/.cache/model-usage`;
const CACHE_FILE = `${CACHE_DIR}/balance.json`;

type CacheEntry = { balance: string; currency: string; extra?: string; ts: number };
type Cache = Record<string, CacheEntry>;

type Provider = {
  prefix: string;
  alias?: string;
  name: string;
  envKey: string;
  fetch: (key: string) => Promise<{ balance: string; currency: string; extra?: string }>;
};

const providers: Provider[] = [
  {
    prefix: "deepseek",
    name: "deepseek",
    envKey: "DEEPSEEK_API_KEY",
    fetch: async (key) => {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { "Accept": "application/json", "Authorization": `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const balance = parseFloat(data.balance_infos?.[0]?.total_balance ?? "0");
      return { balance: `¥${balance.toFixed(2)}`, currency: "CNY" };
    },
  },
  {
    prefix: "minimax",
    name: "minimax",
    envKey: "MINIMAX_API_KEY",
    fetch: async (key) => {
      const res = await fetch("https://www.minimaxi.com/v1/token_plan/remains", {
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.base_resp?.status_code !== 0) throw new Error(data.base_resp?.status_msg || "未知错误");
      const general = data.model_remains?.find((m: { model_name: string }) => m.model_name === "general");
      const remaining = general?.current_interval_remaining_percent as number;
      const used = 100 - remaining;
      const remainsMs = general?.remains_time as number;
      const h = Math.floor(remainsMs / 3600000);
      const min = Math.floor((remainsMs % 3600000) / 60000);
      const reset = h > 0 ? `${h}h${min}m` : `${min}m`;
      return { balance: `%${used}`, currency: "percent", extra: `重置: ${reset}` };
    },
  },
  {
    prefix: "moonshot",
    alias: "kimi",
    name: "kimi",
    envKey: "MOONSHOT_API_KEY",
    fetch: async (key) => {
      const res = await fetch("https://api.moonshot.cn/v1/users/me/balance", {
        headers: { "Authorization": `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const balance = data.data?.available_balance as number;
      return { balance: `¥${balance.toFixed(2)}`, currency: "CNY" };
    },
  },
];

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

async function main() {
  const settings = loadSettings();
  const model = process.env.ANTHROPIC_MODEL || settings.ANTHROPIC_MODEL || "";
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const force = args.includes("--force");
  const ttlMs = parseTtl(args, settings);

  const provider = providers.find(p => {
    const m = model.toLowerCase();
    return m.startsWith(p.prefix) || (p.alias && m.startsWith(p.alias));
  });

  if (!provider) {
    if (json) console.log(JSON.stringify({ error: "未匹配到服务商", model }));
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
        console.log(result.extra ? `${result.balance}，${result.extra}` : result.balance);
      }
      return;
    }
  }

  const apiKey = process.env[provider.envKey] || settings[provider.envKey] || settings.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    if (json) {
      console.log(JSON.stringify({ error: `缺少 ${provider.envKey}`, model }));
    } else {
      console.log(`缺少 ${provider.envKey}`);
    }
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await provider.fetch(apiKey);

    // update cache
    if (ttlMs > 0) {
      const cache = loadCache();
      cache[provider.name] = { balance: result.balance, currency: result.currency, extra: result.extra, ts: Date.now() };
      saveCache(cache);
    }

    if (json) {
      console.log(JSON.stringify({ provider: provider.name, model, ...result }));
    } else {
      console.log(result.extra ? `${result.balance}，${result.extra}` : result.balance);
    }
  } catch (err: unknown) {
    if (json) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : "未知错误", model }));
    } else {
      console.log(err instanceof Error ? err.message : "查询失败");
    }
  } finally {
    clearTimeout(timer);
  }
}

main();
