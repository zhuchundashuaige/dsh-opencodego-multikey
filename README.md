# dsh-opencodego-multikey

为 DeepSeek Harness（DSH）Web 版设计的 **OpenCode Go 多 API Key 网关插件**。

DSH 内置的 `opencode-go` 供应商每个路由只能配置一个 API Key：有多个 key 时要手动切换、无法按额度合理分配请求、按 key 查用量非常麻烦。本插件在本地起一个反向代理，把 **多个 key 聚合成一个"池"**，并自动解决这三件事：

- **多 Key 管理**：在 Web 侧边栏面板里直接添加 / 删除 / 启停任意数量的 OpenCode Go API Key，无需改配置文件；
- **按用量自动调度**：每个请求自动选择"剩余额度最充足"的 key 去调用换取，额度相同则轮询（round-robin），额度快用完 / 失效 / 被限流的 key 自动跳过并隔离，失效 key 到期自动恢复；
- **用量统计**：按 key 记录请求数、输入/输出/缓存 token、估算费用、被选中次数与每日明细，并提供**汇总用量**（今日 / 本月 / 累计），全部在 Web 面板上一目了然。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 本地反向代理 | 监听 `127.0.0.1:19781`（可配），OpenAI 与 Anthropic 风格的请求原样透传，仅在转发时替换 `Authorization` |
| 智能选 Key | 剩余额度最高优先；月度 > 周度 > 滚动窗口；额度未知的 key 以中性分参与竞争；同分轮询 |
| 自动隔离 | 401/403 隔离 10 分钟、429 隔离 1 分钟、网络抖动隔离 30 秒（时长可配），手动可解除 |
| 低额度降级（可选） | 选中的 key 剩余额度低于阈值时，可把昂贵模型自动换成便宜模型（如 `qwen3.7-max → qwen3.7-plus`） |
| 用量统计 | 兼容 OpenAI chat completions / responses 与 Anthropic Messages 的 JSON 与 SSE 用量字段 |
| 汇总面板 | 每个 key 的额度条（滚动/周/月窗口 + 重置时间）、token 用量、费用、选中次数；顶部今日/本月/累计汇总 |
| 持久化 | 状态（key、统计、隔离）存于 `<DSH_HOME>/storages/opencodego-multikey.json`，重启不丢 |
| 安全 | 代理与管理 API 均只允许回环访问；任何对外视图都只显示打码的 key |

## 架构

```
                        ┌────────────────────────── DSH Web 进程 ──────────────────────────┐
 DSH pi-ai 请求 ──────► │  opencode-go 供应商路由 baseURL 指向本地代理                        │
 (baseURL =            │      │                                                            │
  http://127.0.0.1:19781)   ▼                                                            │
                        │  ┌──────────────────────────────────────────┐                    │
                        │  │ lib/proxy.js  反向代理（仅 127.0.0.1）     │                    │
                        │  │  1. 从 KeyPool 选剩余额度最高的 key         │                    │
                        │  │  2. 可选模型降级（fallbacks）               │                    │
                        │  │  3. 转发到 https://opencode.ai/zen/go      │                    │
                        │  │  4. 透传响应并捕获 token 用量               │                    │
                        │  └──────────────────┬───────────────────────┘                    │
                        │                     │ 记录用量 / 隔离                            │
                        │  ┌──────────────────▼───────────────────────┐                    │
                        │  │ KeyPool + 用量统计（内存 + 状态文件持久化）   │                    │
                        │  └──────────────────┬───────────────────────┘                    │
                        │                     │ 每 60s 拉取各 key 额度                      │
                        │  ┌──────────────────▼───────────────────────┐                    │
                        │  │ lib/quota.js  GET /v1/usage（Bearer）      │                    │
                        │  └──────────────────────────────────────────┘                    │
                        │                                                                    │
                        │  管理 API（同源、回环）：/api/opencodego-multikey/*                 │
                        │  ▲                                                                 │
                        └──┴────────────────────────────────────────────────────────────────┘
                           │
                        浏览器（Web 面板"Go 多Key"：添加/删除 key、额度条、用量汇总）
```

## 安装

### 方式一：`dsh plugin`（推荐）

```bash
dsh plugin --profile web add github:<你的仓库路径>/dsh-opencodego-multikey
```

### 方式二：直接使用仓库里的安装脚本

```bash
# 在本仓库目录下
node scripts/install.mjs            # 安装文件 + 写入 cordis.patch.yml
node scripts/install.mjs --dry-run  # 只打印将要做什么
node scripts/install.mjs --check    # 校验已安装状态
```

脚本会把包复制到 `<DSH_HOME>/profiles/web/node_modules/dsh-opencodego-multikey`，
并在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 追加一行挂载补丁（幂等）。

安装完成后 **重启 `dsh web`，并强制刷新浏览器**（Ctrl+Shift+R）。

### 依赖的 DSH 客户端注入

`package.json` 中的 `dsh.client.inject` 声明了客户端运行时依赖
（`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-runtime`、
`@deepseek-ai/dsh-client-ui-primitives`），与同生态插件一致。

## 配置 DSH 供应商（关键步骤）

让 DSH 的 `opencode-go` 供应商路由指向本插件代理：

1. 打开 DSH Web 设置的 **Models / 供应商** 页面；
2. 找到 `opencode-go`（或新建同名路由），把 **baseURL 改为**
   `http://127.0.0.1:19781`（端口与插件 `listenPort` 配置一致）；
3. `apiKeyEnv` 随便填一个已存在的凭证 ref（如 `OPENCODE_GO_API_KEY`），
   值随便填（例如 `sk-placeholder`）——**代理会忽略入站 Authorization，
   真正使用的 key 来自面板里配置的 Key 池**（此路由的凭证仅用于通过
   DSH 的配置校验）；
4. 保存。模型列表仍使用 pi-ai 内置的 opencode-go 目录
   （`minimax-m3` / `qwen3.7-max` / `qwen3.7-plus` 等）。

> 也可以手写配置：在 `llm-pi-ai` 设置命名空间下
> `providers.opencode-go.baseURL = http://127.0.0.1:19781`。

## 使用

1. 在 DSH Web 侧边栏底部找到 **「Go 多Key」** 按钮，点击打开面板；
2. 在面板底部粘贴一个 OpenCode Go API Key（可加备注名），点「添加」；
   添加后插件会立即探测该 key 的额度，并每 60 秒自动刷新；
3. 重复添加其余 key。面板会显示每个 key 的：状态（可用/已隔离/已停用）、
   滚动/周/月额度条（已用 % 与重置时间）、请求数、输入/输出 token、
   估算费用、被选中次数；
4. 顶部显示**汇总用量**：今日 / 本月 / 累计 token 与总估算费用；
5. 需要停用或删除某个 key：卡片上的「停用」「删除」按钮；
   被自动隔离的 key 可点「解除隔离」。

### 自动切换策略

- 每个请求开始时，从**未停用、未隔离、未耗尽**的 key 中挑选；
- 按剩余额度排序：`月度窗口 > 周度窗口 > 滚动窗口` 的剩余百分比；
- 额度未知（暂未拉到统计）的 key 以中性分（50）参与竞争；
- 额度剩余 ≤ `exhaustThresholdPct`（默认 2%）视为耗尽，自动跳过；
- 同分 key 按"最近最少被选"轮询，避免单个 key 过热。

### 低额度模型降级（可选）

在插件配置里设置 `fallbacks`，当选中的 key 剩余额度 ≤
`fallbackThresholdPct`（默认 10%）时，请求会被自动改写为更便宜的模型：

```yaml
- id: opencodego-multikey
  config:
    fallbackThresholdPct: 10
    fallbacks:
      qwen3.7-max: qwen3.7-plus   # 贵 → 便宜
      qwen3.7-plus: minimax-m3
```

额度未知时**不会**擅自改模型（避免未知状态下把用户指定的模型静默换掉）。

## 插件配置项

均通过 `cordis.patch.yml` 中该行的 `config` 传入（非必填，默认值如下）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `listenPort` | `19781` | 代理监听端口（仅 127.0.0.1） |
| `host` | `127.0.0.1` | 代理监听地址 |
| `upstreamBaseURL` | `https://opencode.ai/zen/go` | 上游 OpenCode Go 地址 |
| `refreshMs` | `60000` | 额度刷新周期（毫秒） |
| `exhaustThresholdPct` | `2` | 剩余额度低于该百分比视为耗尽 |
| `fallbackThresholdPct` | `10` | 触发模型降级的剩余额度阈值 |
| `fallbacks` | `{}` | 模型降级映射（见上） |
| `quarantineAuthMs` | `600000` | 401/403 隔离时长（毫秒） |
| `quarantineRateMs` | `60000` | 429 隔离时长 |
| `quarantineNetworkMs` | `30000` | 网络抖动隔离时长 |
| `historyDays` | `90` | 每日明细保留天数 |
| `stateFile` | `<DSH_HOME>/storages/opencodego-multikey.json` | 状态文件路径 |

示例：

```yaml
# <DSH_HOME>/profiles/web/cordis.patch.yml
- id: opencodego-multikey
  config:
    listenPort: 19781
    upstreamBaseURL: https://opencode.ai/zen/go
    fallbackThresholdPct: 15
    fallbacks:
      qwen3.7-max: qwen3.7-plus
```

## 管理 API（回环，仅供面板使用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/opencodego-multikey/overview` | 配置摘要 + key 列表（打码）+ 每个 key 用量 + 汇总 |
| POST | `/api/opencodego-multikey/keys` | 添加 key，body `{ key, label?, enabled? }` |
| DELETE | `/api/opencodego-multikey/keys?id=<id>` | 删除 key |
| POST | `/api/opencodego-multikey/keys/toggle` | 启停，body `{ id, enabled }` |
| POST | `/api/opencodego-multikey/keys/clear-quarantine` | 解除隔离，body `{ id }` |
| POST | `/api/opencodego-multikey/refresh` | 立即刷新所有 key 的额度 |

所有接口只允许来自回环地址的请求（`127.0.0.1` / `::1`，含 Host 头校验）。

## 用量统计口径

- 代理从每次响应中捕获 `usage`：兼容
  OpenAI `prompt_tokens / completion_tokens / total_tokens`、
  OpenAI Responses `input_tokens / output_tokens / input_tokens_details.cached_tokens`、
  Anthropic `input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`；
- 流式（SSE）响应在转发的同时旁路解析 `data:` 行，按字段取最大值合并
  （OpenAI 在末尾回传累计值，Anthropic 在开头/结尾分别回传输入/输出）；
- 费用为按 opencode-go 目录模型单价估算（每百万 token 单价）：
  `minimax-m3` 0.3/1.2、`qwen3.7-max` 2.5/7.5、`qwen3.7-plus` 0.4/1.6（$/1M，输入/输出），
  未知模型不计费用；

## 开发

```bash
npm run check   # 全部文件语法检查
npm test        # 单元 + 集成测试（node:test，无需 DSH 环境）
```

测试覆盖：额度窗口解析与评分、key 池选择/轮询/隔离、用量统计与汇总、
代理转发与用量捕获的端到端链路（本地起假上游验证）。

## 安全说明

见 [SECURITY.md](./SECURITY.md)。关键点：代理与 API 只绑定回环；
key 只存在于内存与状态文件；任何视图只显示打码 key；
上游固定走 `upstreamBaseURL` 的协议（默认 HTTPS）。

## License

[MIT](./LICENSE)