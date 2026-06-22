# model-usage

查询 AI 模型服务商账户余额的命令行工具，主要配合 [ccstatusline](https://github.com/anthropics/claude-code-statusline) 使用，在状态栏展示当前模型的余额或用量。

## 支持的服务商

| 服务商 | 环境变量 | 说明 |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | 账户余额 |
| MiniMax | `MINIMAX_API_KEY` | Token 用量及重置时间 |
| Moonshot/Kimi | `MOONSHOT_API_KEY` | 账户余额 |
| Xiaomi Mimo | — | 无余额 API，仅显示厂商名称 |
| 火山引擎 | — | 无余额 API，仅显示厂商名称 |

## 安装

```bash
npm install -g model-usage
```

或直接通过 `bun`/`tsx` 运行：

```bash
bun check-balance.ts
```

## 使用

### 通用入口

根据 `ANTHROPIC_BASE_URL` 环境变量自动识别服务商：

```bash
model-usage
```

### 单独查询

```bash
bun lib/providers/deepseek.ts
bun lib/providers/minimax.ts
bun lib/providers/kimi.ts
```

### 输出格式

```bash
# 默认文本输出
model-usage

# JSON 格式（适合程序调用）
model-usage --json

# 禁用缓存
model-usage --force

# 自定义缓存时间（秒）
model-usage --cache-ttl 30
```

## 配置

### 环境变量

在 `~/.claude/settings.json` 的 `env` 字段中配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com",
    "DEEPSEEK_API_KEY": "sk-xxx"
  }
}
```

或直接设置系统环境变量。

### 域名路由

工具通过 `ANTHROPIC_BASE_URL` 的 hostname 自动匹配服务商：

| 域名 | 服务商 |
| --- | --- |
| `api.deepseek.com` | DeepSeek |
| `www.minimaxi.com` / `api.minimaxi.com` | MiniMax |
| `api.moonshot.cn` | Moonshot/Kimi |
| `token-plan-cn.xiaomimimo.com` | Xiaomi Mimo |
| `ark.cn-beijing.volces.com` | 火山引擎 |

### 缓存

- 默认缓存路径：`~/.cache/model-usage/balance.json`
- 默认 TTL：60 秒
- 可通过 `--cache-ttl N` 或 `BALANCE_CACHE_TTL` 环境变量调整
- 使用 `--force` 跳过缓存

## 集成 ccstatusline

在 ccstatusline 配置中使用：

```json
{
  "statusLine": {
    "command": "model-usage --json"
  }
}
```

工具会输出 JSON 格式的余额信息，ccstatusline 会在状态栏中显示。

## 开发

零运行时依赖，使用 TypeScript 编写，直接由 `bun` 或 `tsx` 解释执行。

```bash
# 安装开发依赖
npm install

# 运行
npm run check          # 通用入口
npm run deepseek       # 单独查询 DeepSeek
npm run minimax        # 单独查询 MiniMax
npm run kimi           # 单独查询 Kimi
```

## License

MIT
