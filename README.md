# dsh-opencodego-multikey

> **中文** — 为 DeepSeek Harness (DSH) Web 版设计的 **OpenCode Go 多 API Key 网关插件**。
> **English** — An **OpenCode Go multi-API-key gateway plugin** for the DeepSeek Harness (DSH) Web GUI.

DSH ships an `opencode-go` provider that only allows **one** API key per route. With several keys the user must switch between them by hand, cannot distribute requests by remaining quota, and has no per-key usage view. This plugin runs a local reverse proxy that folds many keys into **one pool** and solves all three problems automatically:

- **中文**
  - **多 Key 管理**：在 Web 侧边栏面板 / 设置页里直接添加、删除、启停任意数量的 OpenCode Go API Key，无需改配置文件；
  - **按用量自动调度**：每个请求自动选择"剩余额度最充足"的 key；额度相同则轮询 (round-robin)；额度快用完 / 失效 / 被限流的 key 自动跳过并隔离，到期自动恢复；
  - **用量统计**：按 key 记录请求数、输入/输出/缓存 token、估算费用、被选中次数与每日明细，并提供**汇总用量**（今日 / 本月 / 累计）。

- **English**
  - **Multi-key management**: add / remove / enable / disable any number of OpenCode Go API keys right from the sidebar panel or the Settings page — no config files to edit;
  - **Quota-aware scheduling**: every request automatically uses the key with the most remaining quota; ties are round-robined; nearly-exhausted / invalid / rate-limited keys are skipped and quarantined, then recover when the quarantine lapses;
  - **Usage tracking**: per-key request counts, input/output/cache tokens, estimated cost, pick counts and daily detail, plus an **aggregate summary** (today / month / all-time).

---

## Features / 特性

| 中文 | English |
| --- | --- |
| 本地反向代理，监听 `127.0.0.1:19781`（可配），原样透传 OpenAI / Anthropic 请求，仅替换 `Authorization` | Local reverse proxy on `127.0.0.1:19781` (configurable); forwards OpenAI / Anthropic requests verbatim, only swapping `Authorization` |
| 智能选 Key：剩余额度最高优先（月度 > 周度 > 滚动）；额度未知以中性分参与；同分轮询 | Smart key selection: highest remaining quota first (monthly > weekly > rolling); unknown quota joins neutrally; ties round-robin |
| 自动隔离：401/403 隔离 10 分钟、429 隔离 1 分钟、网络抖动隔离 30 秒（可配） | Auto-quarantine: 401/403 for 10 min, 429 for 1 min, transient network for 30 s (configurable) |
| 低额度模型降级（可选）如 `qwen3.7-max → qwen3.7-plus` | Optional low-quota model downgrade, e.g. `qwen3.7-max → qwen3.7-plus` |
| 用量统计兼容 OpenAI / Anthropic 的 JSON 与 SSE 用量字段 | Usage capture compatible with OpenAI / Anthropic JSON and SSE usage fields |
| 侧边栏面板 **与 dsh-usage-stats 并排一行**，设置菜单也有入口 | Sidebar panel **side-by-side in the same row as dsh-usage-stats**, plus a Settings-menu entry |
| 面板双语（中 / EN），随界面语言自动切换 | Bilingual panel (zh / en), follows the UI locale automatically |
| 状态持久化到 `<DSH_HOME>/storages/opencodego-multikey.json` | State persisted to `<DSH_HOME>/storages/opencodego-multikey.json` |
| 代理与管理 API 仅允许回环访问；任何视图只显示打码 key | Proxy and management API are loopback-only; every view shows masked keys |

---

## Architecture / 架构

```
                        ┌──────────────────────── DSH Web process ───────────────────────┐
 DSH pi-ai request ────►│ opencode-go provider route baseURL → local proxy              │
 (baseURL =             │      │                                                         │
  http://127.0.0.1:19781)     ▼                                                         │
                        │  ┌───────────────────────────────────────────────┐             │
                        │  │ lib/proxy.js  reverse proxy (loopback only)    │             │
                        │  │  1. pick best key (most remaining quota)        │             │
                        │  │  2. optional model downgrade (fallbacks)        │             │
                        │  │  3. forward to https://opencode.ai/zen/go       │             │
                        │  │  4. stream back, capture token usage            │             │
                        │  └──────────────────┬────────────────────────────┘             │
                        │                     │ usage / quarantine                       │
                        │  ┌──────────────────▼─────────────────────────────┐             │
                        │  │ KeyPool + usage stats (memory + state file)     │             │
                        │  └──────────────────┬─────────────────────────────┘             │
                        │                     │ pull quota every 60 s                     │
                        │  ┌──────────────────▼─────────────────────────────┐             │
                        │  │ lib/quota.js  GET /v1/usage (Bearer)            │             │
                        │  └────────────────────────────────────────────────.┘             │
                        │  management API (same-origin, loopback): /api/opencodego-multikey/* │
                        └──▲──────────────────────────────────────────────────────────────┘
                           │
                   Browser (sidebar "Go 多Key" + Settings page: quota bars, usage summary)
```

---

## Install / 安装

### Recommended / 推荐

```bash
dsh plugin --profile web add github:zhuchundashuaige/dsh-opencodego-multikey
```

or directly from this repository (installer copies files + appends the cordis patch):

```bash
node scripts/install.mjs
```

### Hot reload during development / 开发期热更新

To live-edit the panel without restarting `dsh`, depend on a **local link** to this checkout:

```bash
dsh plugin --profile web remove dsh-opencodego-multikey
dsh plugin --profile web add link:C:\path\to\dsh-opencodego-multikey
```

The client bundle is served with `no-cache` and re-hashed, so after changing
`lib/client.js` you just **hard-refresh the browser** (Ctrl+Shift+R) — no `dsh`
restart needed for panel changes. Host-side (`lib/*.js`) changes do require a
`dsh` restart.

客户端 bundle 以 `no-cache` 方式提供并重新哈希，改完 `lib/client.js` 后只需**强制刷新浏览器**即可看到面板变更（改宿主端 `lib/*.js` 才需重启 `dsh`）。

> The plugin must be in the profile's `dsh.profile.bundles` list; `dsh plugin add`
> adds it automatically because the package declares `dsh.bundle`. / 插件需在 profile 的
> `dsh.profile.bundles` 列表中；`dsh plugin add` 因包声明 `dsh.bundle` 会自动加入。

After installation: **restart `dsh web`** (host side) once, then hard-refresh the browser.

---

## Configure the DSH provider / 配置 DSH 供应商

Point the `opencode-go` provider route's baseURL at the local proxy:

1. Open **Models / Providers** in DSH Web settings.
2. Set `opencode-go` **baseURL = `http://127.0.0.1:19781`** (port matches the plugin `listenPort`).
3. Set `apiKeyEnv` to any existing credential ref (e.g. `OPENCODE_GO_API_KEY`) with any value
   (e.g. `sk-placeholder`) — **the proxy ignores the inbound authorization; the real keys come
   from the Key pool in the panel**. This route's credential only satisfies DSH's config validation.
4. Save. The model list still comes from pi-ai's built-in opencode-go catalog
   (`minimax-m3` / `qwen3.7-max` / `qwen3.7-plus`).

中文：在 DSH Web 设置的 Models/供应商页面把 `opencode-go` 路由 baseURL 改为
`http://127.0.0.1:19781`；`apiKeyEnv` 填任意已有 ref（如 `OPENCODE_GO_API_KEY`）值随意（如
`sk-placeholder`）——代理会忽略入站 Authorization，真正使用的 key 来自面板里配置的 Key 池。

---

## Usage / 使用

1. Click the **「Go 多Key」 / "Go Keys"** button at the sidebar foot (beside usage-stats), **or** open it
   from the **Settings menu** (settings → "OpenCodeGo 多Key" / "OpenCodeGo Multi-Key").
2. In the panel, paste an OpenCode Go API key (optional label) and hit **Add / 添加**. The plugin
   immediately probes the key's quota, then auto-refreshes every 60 s.
3. Repeat for the other keys. Each key card shows: status (active / quarantined / disabled), the
   rolling / weekly / monthly quota bars (used % + reset time), request count, input/output tokens,
   estimated cost and pick count.
4. The top shows **aggregate usage**: today / month / all-time tokens and total estimated cost.
5. Disable or delete a key from its card; un-quarantine a key that was auto-isolated.

### Scheduling rules / 调度规则

- Each request starts by picking from **enabled, non-quarantined, non-exhausted** keys.
- Sorted by remaining quota: `monthly > weekly > rolling` remaining percent.
- Keys with unknown quota (not yet fetched) compete with a neutral score (50).
- Quota ≤ `exhaustThresholdPct` (default 2%) counts as exhausted and is skipped.
- Equal score → least-recently-picked wins (round-robin).

### Model downgrade (optional) / 低额度模型降级（可选）

```yaml
- id: opencodego-multikey
  config:
    fallbackThresholdPct: 10
    fallbacks:
      qwen3.7-max: qwen3.7-plus   # 贵 → 便宜 / expensive → cheap
      qwen3.7-plus: minimax-m3
```

When the selected key's remaining quota ≤ `fallbackThresholdPct` (default 10%) the request model is
rewritten to the cheaper one. Downgrade never happens while the quota is unknown (so a user-chosen
model is never silently changed in an unknown state).

---

## Configuration / 配置项

All passed via the `config` of the `opencodego-multikey` row (all optional; defaults below).

| Key / 键 | Default / 默认 | Description / 说明 |
| --- | --- | --- |
| `listenPort` | `19781` | Proxy listen port (loopback only) / 代理监听端口（仅回环） |
| `host` | `127.0.0.1` | Proxy bind address / 代理监听地址 |
| `upstreamBaseURL` | `https://opencode.ai/zen/go` | Upstream OpenCode Go origin / 上游地址 |
| `refreshMs` | `60000` | Quota refresh period / 额度刷新周期（毫秒） |
| `exhaustThresholdPct` | `2` | Remaining quota below this counts as exhausted / 视为耗尽的剩余额度阈值 |
| `fallbackThresholdPct` | `10` | Quota threshold that triggers model downgrade / 触发模型降级的额度阈值 |
| `fallbacks` | `{}` | Model downgrade map / 模型降级映射 |
| `quarantineAuthMs` | `600000` | 401/403 quarantine duration / 401/403 隔离时长 |
| `quarantineRateMs` | `60000` | 429 quarantine duration / 429 隔离时长 |
| `quarantineNetworkMs` | `30000` | Transient-network quarantine / 网络抖动隔离时长 |
| `historyDays` | `90` | Daily-detail retention days / 每日明细保留天数 |
| `stateFile` | `<DSH_HOME>/storages/opencodego-multikey.json` | State file / 状态文件路径 |

Example / 示例:

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

## Management API / 管理 API（回环，仅供面板）

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/opencodego-multikey/overview` | Config + masked key list + per-key usage + aggregate |
| POST | `/api/opencodego-multikey/keys` | Add key, body `{ key, label?, enabled? }` |
| DELETE | `/api/opencodego-multikey/keys?id=<id>` | Remove key |
| POST | `/api/opencodego-multikey/keys/toggle` | Enable/disable, body `{ id, enabled }` |
| POST | `/api/opencodego-multikey/keys/clear-quarantine` | Clear quarantine, body `{ id }` |
| POST | `/api/opencodego-multikey/refresh` | Force refresh all keys' quota |

All endpoints accept only loopback requests (`127.0.0.1` / `::1`, Host header checked).

---

## Usage accounting / 用量统计口径

- The proxy captures `usage` from each response: OpenAI `prompt_tokens / completion_tokens /
  total_tokens`, OpenAI Responses `input_tokens / output_tokens / input_tokens_details.cached_tokens`,
  Anthropic `input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`.
- SSE responses parse `data:` lines while streaming and merge by per-field maximum (OpenAI returns the
  cumulative total at the end; Anthropic reports input at `message_start` and output at `message_delta`).
- Cost uses the opencode-go catalog rates ($ per 1M tokens): `minimax-m3` 0.3/1.2, `qwen3.7-max`
  2.5/7.5, `qwen3.7-plus` 0.4/1.6 (input/output). Unknown models report no cost.

---

## Development / 开发

```bash
npm run check   # syntax-check every file / 全部文件语法检查
npm test        # unit + integration tests (node:test, no DSH needed) / 单测 + 集成测试
```

Coverage / 覆盖：quota-window parsing and scoring, key-pool selection / round-robin / quarantine,
usage stats and aggregation, plus an end-to-end proxy test against a local fake upstream
（含本地起假上游的端到端代理测试，验证选 Key、转发与用量捕获）。

---

## i18n / 双语

The panel and Settings page read from a single locale namespace (`opencodegoMultiKey`) with `zh` and
`en` dictionaries, registered through `ctx.locale`. The sidebar badge, panel, and the Settings nav
label all follow the active UI language without re-registering.

面板与设置页共用同一 locale 命名空间 `opencodegoMultiKey`（`zh`/`en` 字典，经 `ctx.locale`
注册）；侧边入口、面板与设置页导航标签均随界面语言自动切换。

---

## Security / 安全

See [SECURITY.md](./SECURITY.md). Key points / 关键点：proxy & API loopback-only;
keys live only in memory and the state file; every view shows masked keys; upstream uses the
`upstreamBaseURL` scheme (HTTPS by default).

---

## License / 许可证

[MIT](./LICENSE)
