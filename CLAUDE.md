# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

命令行小工具集，用于查询 AI 模型服务商（DeepSeek、MiniMax、Moonshot/Kimi、小米 MiMo）的账户余额。每个 `.ts` 文件都是独立可运行的 ESM 脚本，没有构建步骤——直接由 `bun` 或 `tsx` 解释执行。

## 运行命令

无 `build` / `test` / `lint` 脚本。直接通过 `bun` 或 `tsx` 运行：

| 命令 | 作用 |
| --- | --- |
| `bun check-balance.ts`（或 `npm run check`） | 通用入口，根据 `ANTHROPIC_MODEL` 自动选择服务商 |
| `bun deepseek.ts` / `bun kimi.ts` / `bun minimax.ts` / `bun mimo.ts` | 单独查询某一家 |
| `npm link` | 全局安装后以 `model-usage` 命令调用 |

全局安装（`package.json` 中 `bin: model-usage -> ./check-balance.ts`）后，行为与 `bun check-balance.ts` 一致。

## 架构

### 双层结构

- **顶层 `check-balance.ts`**：通用调度器，包含缓存、模型路由、配置加载。`bin` 入口。
- **底层 `deepseek.ts` / `kimi.ts` / `minimax.ts` / `mimo.ts`**：直白的单文件脚本，无缓存、无路由，直接请求服务商 API。供需要裸调用的场景使用。

两者代码不共享（没有 lib/ 目录），新增逻辑时注意是否需要同时更新两侧。

### Provider 注册表（`check-balance.ts`）

`providers: Provider[]` 数组是唯一的扩展点。每个 Provider 描述：

```
{ prefix, alias?, name, envKey, cookieProvider?, fetch(key) }
```

- `prefix` / `alias`：用于匹配 `ANTHROPIC_MODEL` 的小写前缀（`startsWith`），二选一即可。
- `envKey`：对应的 API Key 环境变量名。
- `cookieProvider`：标记该 Provider 用 Cookie 而非 Bearer token 认证。影响 Key 查找和 401 重试逻辑。
- `fetch`：返回 `{ balance, currency, extra? }`，抛错表示查询失败。

**新增服务商**：在数组里追加一项即可，无需改动主流程。若用 Cookie 认证，设 `cookieProvider: true` 并参考 MiMo 的 Cookie 加载逻辑。

### 模型路由

`process.env.ANTHROPIC_MODEL` → `settings.ANTHROPIC_MODEL`（来自 `~/.claude/settings.json` 的 `env` 字段）。未匹配到任何 provider 时静默返回（`--json` 模式下输出错误 JSON）。

### 缓存

- **余额缓存**路径：`~/.cache/model-usage/balance.json`
  - 默认 TTL：60 秒
  - 覆盖方式：`--cache-ttl N`（秒）或环境变量 `BALANCE_CACHE_TTL`（秒）；`ttlMs > 0` 才启用缓存
  - 跳过方式：`--force`
  - 写入失败被静默忽略
- **Cookie 缓存**路径：`~/.cache/model-usage/mimo-cookie.json`（仅 MiMo）
  - 默认 TTL：1 小时（`MIMO_COOKIE_TTL` 环境变量可覆盖，单位秒）
  - `--force` 同时跳过余额缓存和 Cookie 缓存

### Key 查找

- **普通 Provider**：`process.env[provider.envKey]` → `settings[provider.envKey]` → `settings.ANTHROPIC_AUTH_TOKEN`
- **Cookie Provider（MiMo）**：`process.env.MIMO_COOKIE` → Cookie 缓存（未过期） → `chrome-cookies-secure` 从 Chrome Keychain 读取并写入缓存。Bun 运行时跳过 Chrome 读取（不支持 NAPI）。

### 401 重试（Cookie Provider 专属）

Cookie Provider 收到 401 时，清除 Cookie 缓存 → 从 Chrome 重新读取 → 若 Cookie 变化则重试一次。仅当未设置 `MIMO_COOKIE` 环境变量且非 `--force` 时触发。

### 输出格式

- 默认：纯文本余额（MiniMax 多一个 `重置: XhYm` 后缀）
- `--json`：结构化 JSON，错误也走 JSON（`{ error, model }` / `{ provider, model, balance, currency, extra?, cached? }`）

底层单独脚本的输出格式略有不同（如带 `剩余:` 前缀），且 `--json` 输出包含 `raw` 原始响应字段。

## 编码约定

- TypeScript 严格模式（`strict: true`），ESM（`"type": "module"`），目标 ES2022。
- 使用 `node:` 前缀的内置模块（`node:fs` / `node:os`）。
- HTTP 请求统一 10 秒超时（`AbortController` + `setTimeout`）。
- 错误处理：`fetch` 失败时打印 `err.message` 或 `查询失败`；单独脚本以 `process.exit(1)` 退出，通用入口则不退出（避免阻塞 Claude 等调用方）。
- 不新增运行时依赖——项目刻意保持最小依赖（`chrome-cookies-secure` 是唯一的非类型依赖，用于 MiMo Cookie 读取）。
- `chrome-cookies-secure` 仅通过 dynamic import 引入，Bun 环境下跳过（不支持 NAPI `uv_async_init`）。
