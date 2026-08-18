# dsh-opencodego-multikey

中文 | [English](README.en.md)

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-1f6feb" alt="DSH plugin">
  <img src="https://img.shields.io/github/v/release/zhuchundashuaige/dsh-opencodego-multikey?sort=semver" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-2da44e" alt="License">
</p>

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 版设计的 **OpenCode Go 多 API Key 网关插件**。

DSH 内置的 `opencode-go` 供应商每个路由只能配置一个 API Key。本插件在本地起一个反向代理，把多个 key 聚合成 **一个 Key 池**：

- **Multikey 系列模型**：载入后自动在模型下拉框为 `opencode-go` 每个模型追加同名 `（Multikey）` 副本（如 `minimax-m3 (Multikey)`），并把供应商 baseURL 指向本地代理；选择这些模型调用即自动对 Key 池做**负载均衡**；
- **多 Key 管理**：在 **设置 → OpenCodeGo 多Key** 页面直接添加 / 删除 / 启停任意数量的 API Key；
- **按用量自动调度**：每个请求自动选择“剩余额度最充足”的 key，额度相同则轮询；快用完 / 失效 / 被限流的 key 自动跳过并隔离，到期自动恢复；
- **用量交给 dsh-usage-stats 展示**：本插件不自绘用量面板，各 `（Multikey）` 模型的池用量由 [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) 按 model 维度展示。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 本地反向代理 | 监听 `127.0.0.1:19781`（可配），原样透传 OpenAI / Anthropic 请求，仅替换 `Authorization`，并按需还原 `（Multikey）` 模型 |
| Multikey 模型注入 | 启动时经 `settings` 服务把 `opencode-go` baseURL 指向代理，并为每个模型追加 `（Multikey）` 变体（可关） |
| 智能选 Key | 剩余额度最高优先（月度 > 周度 > 滚动）；额度未知以中性分参与；同分轮询 |
| 自动隔离 | 401/403 隔离 10 分钟、429 隔离 1 分钟、网络抖动隔离 30 秒（可配），手动可解除 |
| 低额度模型降级（可选） | 如 `qwen3.7-max → qwen3.7-plus`；额度未知时绝不擅自改模型 |
| 入口 | 仅 **设置菜单**（Settings → OpenCodeGo 多Key），无侧边栏入口 |
| 用量展示 | 由 dsh-usage-stats 按 `（Multikey）` / 自定义模型展示（本插件不自绘用量面板） |
| 双语 | 设置页与 README 均中英双语 |
| 持久化 | 状态存于 `<DSH_HOME>/storages/opencodego-multikey.json` |
| 安全 | 代理与管理 API 仅允许回环访问；任何视图只显示打码 key |

---

## 架构

```
                        ┌──────────────────────── DSH Web 进程 ───────────────────────┐
 DSH pi-ai 请求 ────────►│ opencode-go 供应商 baseURL → 本地代理                        │
 (baseURL=               │      │                                                     │
  http://127.0.0.1:19781)     ▼                                                     │
                        │  ┌─────────────────────────────────────────────┐             │
                        │  │ lib/proxy.js 反向代理（仅回环）                │             │
                        │  │  1. 选剩余额度最高的 key                      │             │
                        │  │  2. 可选模型降级（fallbacks）                 │             │
                        │  │  3. 转发到 https://opencode.ai/zen/go        │             │
                        │  │  4. 透传响应 + 用量（交 DSH token meter）      │             │
                        │  └──────────────────┬──────────────────────────┘             │
                        │                     │ 用量/隔离                                │
                        │  ┌──────────────────▼──────────────────────────┐             │
                        │  │ KeyPool（内存 + 状态文件）                      │             │
                        │  └──────────────────┬──────────────────────────┘             │
                        │                     │ 每 60s 拉取各 key 额度                  │
                        │  ┌──────────────────▼──────────────────────────┐             │
                        │  │ lib/quota.js  GET /v1/usage（Bearer）         │             │
                        │  └─────────────────────────────────────────────┘             │
                        │  管理 API（同源、回环）：/api/opencodego-multikey/*              │
                        └──▲───────────────────────────────────────────────────────────┘
                           │
                   浏览器：设置页「OpenCodeGo 多Key」管理 Key 池；
                   用量见侧边栏「用量/余额」(dsh-usage-stats) 按模型维度
```

---

## 安装

```bash
dsh plugin --profile web add github:zhuchundashuaige/dsh-opencodego-multikey
```

或在本仓库目录直接运行安装脚本：

```bash
node scripts/install.mjs
```

安装完成后 **重启一次 `dsh web`**（宿主侧注入 baseURL + `（Multikey）` 模型需加载新代码），再**强制刷新浏览器**（Ctrl+Shift+R）。

### 开发期热更新

将 profile 依赖改为指向本仓库的 **本地 link**，即可热更新客户端面板：

```bash
dsh plugin --profile web remove dsh-opencodego-multikey
dsh plugin --profile web add link:C:\path\to\dsh-opencodego-multikey
```

客户端 bundle 以 `no-cache` 提供并重新哈希：改完 `lib/client.js` 后**强制刷新浏览器**即生效（改宿主端 `lib/*.js` 才需重启 `dsh`）。

> `dsh plugin add` 因包声明 `dsh.bundle` 会自动把插件加入 profile 的 `dsh.profile.bundles`。

---

## 配置 DSH 供应商

载入插件后会自动（经 `settings` 服务，幂等）完成：

- `opencode-go` 供应商 `baseURL = http://127.0.0.1:{listenPort}`（指向本地代理）；
- 为每个已列模型追加 `（Multikey）` 变体（id + ` (Multikey)`，继承 name/contextWindow/maxTokens）。

`apiKeyEnv` 保持不变（其值仅用于通过 DSH 配置校验，代理会忽略入站凭证，改从 Key 池取用）。

若想手动管理，可在插件 `config` 里设 `injectProvider: false`，自行把 `opencode-go` 的 baseURL 改为
`http://127.0.0.1:{listenPort}`，并可手动添加 `（Multikey）` 模型。

---

## 使用

1. 模型下拉框选择带 **`（Multikey）`** 后缀的模型（如 `minimax-m3 (Multikey)`）——调用自动走 Key 池负载均衡。
2. 打开 **设置 → OpenCodeGo 多Key**，粘贴 OpenCode Go API Key（可加备注），点「添加」；插件立即探测该 key 额度，之后每 60 秒自动刷新。每张 key 卡片显示：状态（可用 / 已隔离 / 已停用）与滚动 / 周 / 月额度条（已用 % + 重置时间）。
3. 停用 / 删除某个 key，或解除自动隔离的 key。
4. **查看汇总用量**：用量由 [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) 展示。打开侧边栏「用量/余额」（Usage/Balance），按 `（Multikey）` 模型维度即可看到池用量。

### 调度规则

- 每个请求先从未停用、未隔离、未耗尽的 key 中挑选；
- 按剩余额度排序：`月度 > 周度 > 滚动`；
- 额度未知的 key 以中性分（50）参与竞争；
- 额度 ≤ `exhaustThresholdPct`（默认 2%）视为耗尽并跳过；
- 同分按“最近最少被选”轮询；
- `（Multikey）` 模型 id 会先剥掉后缀再参与降级查找与转发，因此 `fallbacks` 按真实模型名匹配。

### 低额度模型降级（可选）

```yaml
- id: opencodego-multikey
  config:
    fallbackThresholdPct: 10
    fallbacks:
      qwen3.7-max: qwen3.7-plus
      qwen3.7-plus: minimax-m3
```

当选中的 key 剩余额度 ≤ `fallbackThresholdPct`（默认 10%）时，请求模型自动改写为更便宜的模型。额度未知时不会降级（避免在未知状态下静默改模型）。

---

## 配置项

均通过 `opencodego-multikey` 行的 `config` 传入（全部可选，默认值如下）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `listenPort` | `19781` | 代理监听端口（仅回环） |
| `host` | `127.0.0.1` | 代理监听地址 |
| `upstreamBaseURL` | `https://opencode.ai/zen/go` | 上游 OpenCode Go 地址 |
| `refreshMs` | `60000` | 额度刷新周期（毫秒） |
| `exhaustThresholdPct` | `2` | 剩余额度低于该百分比视为耗尽 |
| `fallbackThresholdPct` | `10` | 触发模型降级的剩余额度阈值 |
| `fallbacks` | `{}` | 模型降级映射 |
| `quarantineAuthMs` | `600000` | 401/403 隔离时长（毫秒） |
| `quarantineRateMs` | `60000` | 429 隔离时长 |
| `quarantineNetworkMs` | `30000` | 网络抖动隔离时长 |
| `historyDays` | `90` | 每日明细保留天数 |
| `stateFile` | `<DSH_HOME>/storages/opencodego-multikey.json` | 状态文件路径 |
| `providerRoute` | `opencode-go` | 注入 `（Multikey）` 模型的供应商路由（`llm-pi-ai.providers` 下） |
| `proxyBaseURL` | `http://127.0.0.1:{listenPort}` | 写入供应商 baseURL 的本地代理地址 |
| `injectProvider` | `true` | 启动时自动写入 baseURL + `（Multikey）` 模型到 llm-pi-ai 配置 |
| `multikeySuffix` | `" (Multikey)"` | 注入模型 id 的后缀 |

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

---

## 管理 API（回环，仅供面板）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/opencodego-multikey/overview` | 配置摘要 + 打码 key 列表 + 各 key 用量 + 汇总 |
| POST | `/api/opencodego-multikey/keys` | 添加 key，body `{ key, label?, enabled? }` |
| DELETE | `/api/opencodego-multikey/keys?id=<id>` | 删除 key |
| POST | `/api/opencodego-multikey/keys/toggle` | 启停，body `{ id, enabled }` |
| POST | `/api/opencodego-multikey/keys/clear-quarantine` | 解除隔离，body `{ id }` |
| POST | `/api/opencodego-multikey/refresh` | 立即刷新所有 key 额度 |

所有接口只接受回环请求（`127.0.0.1` / `::1`，含 Host 头校验）。

---

## 用量统计口径

本插件不再自绘用量。代理**原样透传**上游 `usage`，由 DSH 自带的 token meter 计费，[dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) 按 `（Multikey）` 模型展示池用量。为此代理识别流式/非流式的各种用量形状：OpenAI `prompt_tokens / completion_tokens / total_tokens`、OpenAI Responses `input_tokens / output_tokens / input_tokens_details.cached_tokens`、Anthropic `input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`。

- SSE 响应边转发边解析 `data:` 行，按字段取最大值合并；
- `（Multikey）` 模型 id 先还原为真实模型再转发，dsh-usage-stats 以 DSH 实际调用的 `（Multikey）` 模型 id 分组。

---

## 开发

```bash
npm run check   # 全部文件语法检查
npm test        # 单元 + 集成测试（node:test，无需 DSH 环境）
```

覆盖：额度窗口解析与评分、Key 池选择 / 轮询 / 隔离、`（Multikey）` 注入幂等与后缀还原，以及本地起假上游的端到端代理测试。

---

## 双语

设置页共用 locale 命名空间 `opencodegoMultiKey`（`zh`/`en` 字典，经 `ctx.locale` 注册），设置页导航标签与提示随界面语言自动切换。本 README 提供 [中文](README.md) 与 [English](README.en.md) 两份。

---

## 安全

见 [SECURITY.md](./SECURITY.md)。关键点：代理与管理 API 仅绑定回环；key 只存在于内存与状态文件；任何视图只显示打码 key；上游固定走 `upstreamBaseURL` 的协议（默认 HTTPS）。

---

## 许可证

[MIT](./LICENSE)
