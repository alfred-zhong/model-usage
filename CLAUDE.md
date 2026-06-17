# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

命令行小工具集，用于查询 AI 模型服务商（DeepSeek、MiniMax、Moonshot/Kimi）的账户余额。每个 `.ts` 文件都是独立可运行的 ESM 脚本，没有构建步骤——直接由 `bun` 或 `tsx` 解释执行。

## 运行命令

无 `build` / `test` / `lint` 脚本。直接通过 `bun` 或 `tsx` 运行：

| 命令 | 作用 |
| --- | --- |
| `bun check-balance.ts`（或 `npm run check`） | 通用入口，根据 `ANTHROPIC_BASE_URL` 域名自动选择服务商 |
| `bun deepseek.ts` / `bun kimi.ts` / `bun minimax.ts` | 单独查询某一家 |
| `npm link` | 全局安装后以 `model-usage` 命令调用 |

全局安装（`package.json` 中 `bin: model-usage -> ./check-balance.ts`）后，行为与 `bun check-balance.ts` 一致。

## 架构

### 双层结构

- **顶层 `check-balance.ts`**：通用调度器，包含缓存、域名路由、配置加载。`bin` 入口。
- **底层 `deepseek.ts` / `kimi.ts` / `minimax.ts`**：直白的单文件脚本，无缓存、无路由，直接请求服务商 API。供需要裸调用的场景使用。

两者代码不共享（没有 lib/ 目录），新增逻辑时注意是否需要同时更新两侧。

### Provider 注册表（`check-balance.ts`）

`providers: Provider[]` 数组是唯一的扩展点。每个 Provider 描述：

```
{ name, envKey, domains, fetch(key) }
```

- `domains`：`ANTHROPIC_BASE_URL` 的 hostname（已小写化）命中列表中的任一项即匹配该 Provider。
- `envKey`：对应的 API Key 环境变量名。
- `fetch`：返回 `{ balance, currency, extra? }`，抛错表示查询失败。

**新增服务商**：在数组里追加一项即可，无需改动主流程。

### 域名路由

`process.env.ANTHROPIC_BASE_URL` → `settings.ANTHROPIC_BASE_URL`（来自 `~/.claude/settings.json` 的 `env` 字段），取其 hostname 后在 `providers[].domains` 中做精确匹配。未匹配到任何 provider 时 `--json` 模式输出错误 JSON（附带 `baseUrl` 字段），普通模式通过 `stderr` 输出提示（包含 `baseUrl` 与 `model`）。`ANTHROPIC_MODEL` 仍会被读取，仅用于在 JSON 输出中透出当前模型名，不再参与路由。

注意：domains 匹配的是 LLM 网关的 host（如 `api.minimaxi.com`），与余额接口的 host（可能是 `www.minimaxi.com`）可以不同——一个 provider 可以在 `domains` 里同时配置多个 host。

### 缓存

- **余额缓存**路径：`~/.cache/model-usage/balance.json`
  - 默认 TTL：60 秒
  - 覆盖方式：`--cache-ttl N`（秒）或环境变量 `BALANCE_CACHE_TTL`（秒）；`ttlMs > 0` 才启用缓存
  - 跳过方式：`--force`
  - 写入失败被静默忽略
### Key 查找

`process.env[provider.envKey]` → `settings[provider.envKey]` → `settings.ANTHROPIC_AUTH_TOKEN`

### 输出格式

- 默认：纯文本余额（MiniMax 多一个 `重置: XhYm` 后缀）
- `--json`：结构化 JSON，错误也走 JSON（`{ error, model }` / `{ provider, model, balance, currency, extra?, cached? }`）

底层单独脚本的输出格式略有不同（如带 `剩余:` 前缀），且 `--json` 输出包含 `raw` 原始响应字段。

## 编码约定

- TypeScript 严格模式（`strict: true`），ESM（`"type": "module"`），目标 ES2022。
- 使用 `node:` 前缀的内置模块（`node:fs` / `node:os`）。
- HTTP 请求统一 10 秒超时（`AbortController` + `setTimeout`）。
- 错误处理：`fetch` 失败时打印 `err.message` 或 `查询失败`；单独脚本以 `process.exit(1)` 退出，通用入口则不退出（避免阻塞 Claude 等调用方）。
- 不新增运行时依赖——项目刻意保持零运行时依赖。
