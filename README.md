# dsh-opencodego-multikey

> **中文** — 为 DeepSeek Harness (DSH) Web 版设计的 **OpenCode Go 多 API Key 网关插件**。
> **English** — An **OpenCode Go multi-API-key gateway plugin** for the DeepSeek Harness (DSH) Web GUI.

DSH ships an `opencode-go` provider that only allows **one** API key per route. With several keys the user must switch between them by hand, cannot distribute requests by remaining quota, and has no pooled usage view. This plugin runs a local reverse proxy that folds many keys into **one pool** and solves the problem automatically:

- **中文**
  - **Multikey 系列模型**：载入插件后，自动在 Model 下拉框为 `opencode-go` 每个模型追加同名 `（Multikey）` 副本（如 `minimax-m3 (Multikey)`），并把供应商 baseURL 指向本地代理；选择这些模型即自动对 API Key 池做负载均衡；
  - **多 Key 管理**：在 Web 侧边栏入口 / 设置页里直接添加、删除、启停任意数量的 OpenCode Go API Key，无需改配置文件；
  - **按用量自动调度**：每个请求自动选择"剩余额度最充足"的 key；额度相同则轮询 (round-robin)；额度快用完 / 失效 / 被限流的 key 自动跳过并隔离，到期自动恢复；
  - **用量交给 dsh-usage-stats 展示**：本插件不再自绘用量面板，各 `（Multikey）` 模型的池用量由 dsh-usage-stats 按 model 维度展示。

- **English**
  - **"Multikey" models**: on load the plugin adds a `（Multikey）` variant of every `opencode-go` model (e.g. `minimax-m3 (Multikey)`) to the Model dropdown and points the provider baseURL at the local proxy; picking one routes the request through the pool for load-balancing;
  - **Multi-key management**: add / remove / enable / disable any number of OpenCode Go API keys from the sidebar entry or the Settings page — no config files to edit;
  - **Quota-aware scheduling**: every request automatically uses the key with the most remaining quota; ties are round-robined; nearly-exhausted / invalid / rate-limited keys are skipped and quarantined, then recover when the quarantine lapses;
  - **Usage shown by dsh-usage-stats**: the plugin no longer draws its own usage panel; per-"Multikey"-model pool usage is displayed by dsh-usage-stats. 


---

## Features / 特性

| 中文 | English |
| --- | --- |
| 本地反向代理，监听 `127.0.0.1:19781`（可配），原样透传 OpenAI / Anthropic 请求，仅替换 `Authorization` 并按需还原 `（Multikey）` 模型 | Local reverse proxy on `127.0.0.1:19781` (configurable); forwards OpenAI / Anthropic requests verbatim, only swapping `Authorization` and stripping the `（Multikey）` suffix |
| 智能选 Key：剩余额度最高优先（月度 > 周度 > 滚动）；额度未知以中性分参与；同分轮询 | Smart key selection: highest remaining quota first (monthly > weekly > rolling); unknown quota joins neutrally; ties round-robin |
| 自动隔离：401/403 隔离 10 分钟、429 隔离 1 分钟、网络抖动隔离 30 秒（可配） | Auto-quarantine: 401/403 for 10 min, 429 for 1 min, transient network for 30 s (configurable) |
| 低额度模型降级（可选）如 `qwen3.7-max → qwen3.7-plus` | Optional low-quota model downgrade, e.g. `qwen3.7-max → qwen3.7-plus` |
| **Multikey 模型自动注入**：为每个 opencode-go 模型生成 `（Multikey）` 变体并固定 baseURL 到代理 | **Multikey model injection**: adds a `（Multikey）` variant of each opencode-go model and pins baseURL to the proxy |
| 侧边栏入口位于 usage-stats **上方**，设置菜单也有入口 | Sidebar entry sits **above** usage-stats; a Settings-menu entry is also registered |
| 面板双语（中 / EN），随界面语言自动切换 | Bilingual panel (zh / en), follows the UI locale automatically |
| **用量由 dsh-usage-stats 按 model 展示**（本插件不自绘用量面板） | **Usage shown by dsh-usage-stats per model** (the plugin draws no usage panel) |
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

On activation the plugin **automatically** writes, through the harness `settings`
service:

- `opencode-go` provider `baseURL = http://127.0.0.1:{listenPort}` (the local proxy);
- a `（Multikey）` variant of every listed opencode-go model (id + ` (Multikey)`).
The `apiKeyEnv` is left as-is; its value only satisfies DSH's config validation —
the proxy ignores the inbound credential and uses the Key pool instead.

> **中文**：载入插件后会自动经 `settings` 服务把 `opencode-go` 的 baseURL 指向本地代理，
> 并为每个模型追加 `（Multikey）` 变体。无需手动改配置。若你的 `opencode-go` 供应商尚未配置其他
> 凭证，请保证仍有 `apiKeyEnv`（如 `OPENCODE_GO_API_KEY`）以便通过 DSH 配置校验。

If you prefer to manage the provider by hand, set `injectProvider: false` in the
plugin's `config` and set the `opencode-go` baseURL to `http://127.0.0.1:{listenPort}`
yourself (e.g. in the Models UI). The "（Multikey）" models can then be added manually.

---

## Usage / 使用

1. After load, open the Model dropdown and pick a **`（Multikey）`** model
   (e.g. `minimax-m3 (Multikey)`). It is served by the proxy, which load-balances the Key pool.
2. Add your OpenCode Go API keys: click the **「Go 多Key」 / "Go Keys"** entry at the sidebar
   foot (**above** usage-stats), or open the **Settings** page → "OpenCodeGo 多Key" / "OpenCodeGo Multi-Key".
3. In the panel, paste a key (optional label) and hit **Add / 添加**; the plugin probes its quota
   immediately and refreshes every 60 s. Each key card shows status (active / quarantined / disabled)
   and the rolling / weekly / monthly quota bars (used % + reset time).
4. Disable / delete a key from its card; un-quarantine a key that was auto-isolated.
5. **View usage with dsh-usage-stats**: open the "用量/余额" / "Usage & Balance" panel — each
   `（Multikey）` model's pooled token usage appears there by model. The plugin draws no usage panel itself.

> **中文**：载入后，在模型下拉框选择带 `（Multikey）` 后缀的模型即可走 Key 池负载均衡；在侧边栏
> 「Go 多Key」（usage-stats 上方）或设置页「OpenCodeGo 多Key」管理 Key；用量请在 dsh-usage-stats
> 的「用量/余额」面板按（Multikey）模型维度查看。

### Scheduling rules / 调度规则

- Each request starts by picking from **enabled, non-quarantined, non-exhausted** keys.
- Sorted by remaining quota: `monthly > weekly > rolling` remaining percent.
- Keys with unknown quota (not yet fetched) compete with a neutral score (50).
- Quota ≤ `exhaustThresholdPct` (default 2%) counts as exhausted and is skipped.
- Equal score → least-recently-picked wins (round-robin).
- A `（Multikey）` model id is normalized (suffix stripped) before fallback lookup and forwarding,
  so `fallbacks` match the underlying model name.

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
| `providerRoute` | `opencode-go` | Provider route (under `llm-pi-ai.providers`) to inject Multikey models into / 注入 Multikey 模型的供应商路由 |
| `proxyBaseURL` | `http://127.0.0.1:{listenPort}` | Proxy base URL pinned onto the route / 写入供应商 baseURL 的本地代理地址 |
| `injectProvider` | `true` | Auto-write baseURL + Multikey models into llm-pi-ai settings on load / 启动时自动写入供应商配置 |
| `multikeySuffix` | `" (Multikey)"` | Suffix appended to injected model ids / 注入模型 id 的后缀 |

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

The plugin no longer renders usage itself. The proxy **forwards the upstream `usage`
unmodified**, so DSH's own token meter records each call and **dsh-usage-stats** displays the
pooled usage per `（Multikey）` model. To do so the proxy understands every usage shape while
streaming: OpenAI `prompt_tokens / completion_tokens / total_tokens`, OpenAI Responses
`input_tokens / output_tokens / input_tokens_details.cached_tokens`, Anthropic
`input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`.

- SSE responses parse `data:` lines and merge per-field maximum (OpenAI returns the cumulative
  total at the end; Anthropic reports input at `message_start` and output at `message_delta`).
- A `（Multikey）` model id is normalized to its base model before forwarding, so usage is
  attributed to that base model (and dsh-usage-stats groups it under the `（Multikey）` model id
  DSH actually called).

> **中文**：本插件不再自绘用量。代理原样透传上游 `usage`，由 DSH 自带的 token meter 计费，
> dsh-usage-stats 按（Multikey）模型展示池用量。

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
