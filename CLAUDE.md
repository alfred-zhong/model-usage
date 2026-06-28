# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

命令行小工具集，用于查询 AI 模型服务商（DeepSeek、MiniMax、Moonshot/Kimi、火山方舟 Coding Plan）的账户余额或用量。Xiaomi Mimo 为 noop provider（无余额 API，仅占位显示厂商名称）。无构建步骤——直接由 `bun` 或 `tsx` 解释执行。

## 运行命令

无 `build` / `lint` 脚本。直接通过 `bun` 或 `tsx` 运行：

| 命令 | 作用 |
| --- | --- |
| `bun check-balance.ts`（或 `npm run check`） | 通用入口，根据 `ANTHROPIC_BASE_URL` 域名自动选择服务商 |
| `bun lib/providers/deepseek.ts`（或 `npm run deepseek`） | 单独查询 DeepSeek |
| `bun lib/providers/kimi.ts`（或 `npm run kimi`） | 单独查询 Kimi/Moonshot |
| `bun lib/providers/minimax.ts`（或 `npm run minimax`） | 单独查询 MiniMax |
| `bun lib/providers/volcengine.ts`（或 `npm run volcengine`） | 单独查询火山方舟 Coding Plan 用量（需 AK + SK） |
| `bun test`（或 `npm test`） | 跑 bun test 测试套（关键纯函数） |
| `npm link` | 全局安装后以 `model-usage` 命令调用（`bin` → `check-balance.ts`） |

全局安装（`package.json` 中 `bin: model-usage -> ./check-balance.ts`）后，行为与 `bun check-balance.ts` 一致。

## 架构

### 文件结构

```
check-balance.ts        # 通用调度器（缓存 / 域名路由 / 凭据查找 / 输出格式化）
lib/
  timeoutFetch.ts       # 共享 HTTP 层：AbortController + 401/429/5xx 分类 + JSON 解析
  manualFetch.ts        # 精简 HTTP 层：AbortController + 返回原始 Response（不抛 HttpError）
  creds.ts              # 凭据查找 helper：envKey (单) / envKeys (双 AK/SK) → ProviderCredentials
  runProvider.ts        # 共享 CLI 入口：凭据校验 + --json 检测 + 错误 catch
  providers/
    types.ts            # Provider / BalanceResult / BalanceTier / ProviderCredentials 接口
    index.ts            # Provider 注册表（providers: Provider[]）
    deepseek.ts         # DeepSeek Provider（含 CLI 自调用入口）
    kimi.ts             # Kimi/Moonshot Provider
    minimax.ts          # MiniMax Token Plan Provider
    xiaomimo.ts         # Xiaomi Mimo noop Provider（无 API，仅占位）
    volcengine.ts       # 火山方舟 Coding Plan Provider（SigV4 + AK/SK + 多窗口 tiers）
```

- `check-balance.ts` 与 `lib/providers/*.ts` 共用 `provider.fetchRaw()`，单一真相源。
- 根目录不再保留独立 stub — 服务商代码全部下沉到 `lib/providers/<name>.ts`。
- 每个 provider 模块在文件末尾通过 `import.meta.url` 自检测 + `await runProvider(provider, ...)`，使 `bun lib/providers/<name>.ts` 独立运行。

### Provider 注册表（`lib/providers/index.ts`）

`providers: Provider[]` 数组是唯一的扩展点。每个 Provider 描述：

```
{ name, envKey?, envKeys?, domains, fetchRaw?(creds) }
```

- `domains`：`ANTHROPIC_BASE_URL` 的 hostname（已小写化）命中列表中的任一项即匹配该 Provider。
- `envKey`：单 Key 鉴权环境变量名（如 Bearer API key）。与 `envKeys` 二选一。
- `envKeys`：双 Key 鉴权环境变量名 `[AK_ENV, SK_ENV]`（如火山引擎控制面 OpenAPI 的 AccessKey ID + SecretAccessKey）。与 `envKey` 二选一。
- `fetchRaw`：返回 `{ result: BalanceResult, raw: unknown }`。`result` 是结构化数据（`balance: number` 原始数值 + `currency` + 可选 `used` / `reset_remaining` / `tiers`）；`raw` 是 API 原始响应（standalone 脚本的 `--json` 输出带，check-balance 不带）。`creds` 是 `string`（单 Key）或 `readonly [ak, sk]`（双 Key）。**noop provider 不提供此字段**，check-balance.ts 检测到 `!provider.fetchRaw` 时直接输出厂商名称，不发起任何请求。

**新增服务商**：在 `lib/providers/` 下加一个文件导出 Provider 对象，并在 `index.ts` 注册即可。

### 域名路由

`process.env.ANTHROPIC_BASE_URL` → `settings.ANTHROPIC_BASE_URL`（来自 `~/.claude/settings.json` 的 `env` 字段），取其 hostname 后在 `providers[].domains` 中做精确匹配。未匹配到任何 provider 时 `--json` 模式输出错误 JSON（附带 `baseUrl` 字段），普通模式通过 `stderr` 输出提示（包含 `baseUrl` 与 `model`）。`ANTHROPIC_MODEL` 仍会被读取，仅用于在 JSON 输出中透出当前模型名，不再参与路由。

注意：domains 匹配的是 LLM 网关的 host（如 `api.minimaxi.com`），与余额接口的 host（可能是 `www.minimaxi.com`）可以不同——一个 provider 可以在 `domains` 里同时配置多个 host。

当前注册的 Provider 及其域名：

| Provider | domains | 类型 | 鉴权 |
| --- | --- | --- | --- |
| DeepSeek | `api.deepseek.com` | 余额查询 | `DEEPSEEK_API_KEY` |
| MiniMax | `www.minimaxi.com`, `api.minimaxi.com` | Token Plan 用量 | `MINIMAX_API_KEY` |
| Kimi | `api.moonshot.cn` | 余额查询 | `MOONSHOT_API_KEY` |
| Xiaomi Mimo | `token-plan-cn.xiaomimimo.com` | noop（仅占位） | — |
| 火山引擎 | `ark.cn-beijing.volces.com` | Coding Plan 用量 | `VOLCENGINE_ACCESS_KEY_ID` + `VOLCENGINE_SECRET_ACCESS_KEY` |

### 缓存

- **余额缓存**路径：`~/.cache/model-usage/balance.json`
  - 默认 TTL：60 秒
  - 覆盖方式：`--cache-ttl N`（秒）或环境变量 `BALANCE_CACHE_TTL`（秒）；`ttlMs > 0` 才启用缓存
  - 跳过方式：`--force`
  - 写入失败被静默忽略
- **缓存内容**：存 `BalanceResult` 的**原始数值**（`balance` + `currency` + 可选 `tiers`），不存格式化展示串。cache hit 路径重建 `BalanceResult` 后走与 live 路径同一 `formatBalance()` —— 避免 `100 - "%4"` 这类 `%NaN` bug
- **缓存写入时机**：`check-balance.ts` 每次成功调用 `provider.fetchRaw()` 后写入；`raw` 不写入

### Key 查找

通过 `lib/creds.ts` 的 `lookupCreds(provider, env, fallback)` 统一处理：
- `provider.envKeys`（双 Key）→ 读 `[AK_ENV, SK_ENV]`，任一缺失返回 `null`；**不对 ANTHROPIC_AUTH_TOKEN fallback**
- `provider.envKey`（单 Key）→ 读 `envKey`；缺失时若 `fallback=true` 走 `ANTHROPIC_AUTH_TOKEN`
- 两者皆无（noop）→ 返回 `null`

### 输出格式

- `check-balance.ts`：
  - 默认：纯文本余额。多窗口 Provider（火山）输出 `provider (X%, Y%, Z% 重置: A, B, C)`；单窗口 percent Provider（MiniMax）多一个 `重置: XhYm` 后缀
  - `--json`：结构化 JSON，错误也走 JSON（`{ error, model }` / `{ provider, model, balance, currency, extra?, cached? }`），**不含 `raw` 字段**
  - 输出通道：所有输出走 `console.log`（stdout），不退出（避免阻塞 Claude 等调用方）
- `lib/providers/<name>.ts`（standalone）：
  - 默认：带 `剩余:` / `5 小时:` / `Coding Plan:` 前缀
  - `--json`：含 `raw` 原始响应字段
  - 输出通道：数据走 `console.log`（stdout），错误走 `console.error`（stderr）+ `process.exit(1)`

### 共享层（`lib/timeoutFetch.ts` + `lib/manualFetch.ts`）

- `lib/timeoutFetch.ts` 提供 `timeoutFetchJson<T>(url, init)`：10 秒超时 + 非 2xx 抛 `HttpError` + JSON 解析 + AbortError 转 `请求超时 (10 秒)`。Provider 的 `fetchRaw` 默认走它。
- `lib/manualFetch.ts` 提供 `manualFetch(url, init)`：10 秒超时 + 返回**原始 Response**（不抛 HttpError）。用于需要检查 200 + `ResponseMetadata.Error` 信封的场景（火山 OpenAPI）。火山 Provider 用它。

## 编码约定

- TypeScript 严格模式（`strict: true`，`allowImportingTsExtensions: true`，`noEmit: true`），ESM（`"type": "module"`），目标 ES2022。
- 使用 `node:` 前缀的内置模块（`node:fs` / `node:os` / `node:crypto`）。
- HTTP 请求统一 10 秒超时。
  - 默认走 `lib/timeoutFetch.ts`
  - 需要检查 200 + 错误信封时走 `lib/manualFetch.ts`（火山 Provider）
- 错误处理：`fetch` 失败时打印 `err.message` 或 `查询失败`；Provider standalone 脚本以 `process.exit(1)` 退出，check-balance 则不退出（避免阻塞 Claude 等调用方）。
- 不新增运行时依赖——项目刻意保持零运行时依赖（HMAC-SHA256 用 `node:crypto` 手写）。
- ESM 自检测模式：`if (import.meta.url === \`file://\${process.argv[1]}\`) { ... }` — 用于让 Provider 模块既可被导入又可独立运行。
