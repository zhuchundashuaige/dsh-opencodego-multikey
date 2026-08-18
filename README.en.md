# dsh-opencodego-multikey

[中文](README.md) | English

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-1f6feb" alt="DSH plugin">
  <img src="https://img.shields.io/github/v/release/zhuchundashuaige/dsh-opencodego-multikey?sort=semver" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-2da44e" alt="License">
</p>

An **OpenCode Go multi-API-key gateway plugin** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI.

DSH ships an `opencode-go` provider that only allows **one** API key per route. This plugin runs a local reverse proxy that folds many keys into **one pool**:

- **Dedicated provider "OpenCode Go Multikey"**: on load the plugin adds a new provider route `opencode-go-multikey` (display name `OpenCode Go Multikey`) whose models are identical to `OpenCode Go` and whose api key can be anything, with baseURL pointed at the local proxy; picking any of its models **load-balances** the key pool automatically;
- **Multi-key management**: add / remove / enable / disable any number of API keys on **Settings → OpenCodeGo Multi-Key**;
- **Quota-aware scheduling**: every request automatically uses the key with the most remaining quota; ties are round-robined; nearly-exhausted / invalid / rate-limited keys are skipped and quarantined, then recover when the quarantine lapses;
- **Usage shown by dsh-usage-stats**: the plugin draws no usage panel. Because "OpenCode Go Multikey" is a dedicated provider, [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) can aggregate the pool's usage cleanly under that provider.

---

## Features

| Capability | Description |
| --- | --- |
| Local reverse proxy | Listens on `127.0.0.1:19781` (configurable); forwards OpenAI / Anthropic requests verbatim, only swapping `Authorization` |
| Dedicated provider injection | On load, adds the `opencode-go-multikey` provider ("OpenCode Go Multikey", models identical to opencode-go, any api key) with baseURL at the proxy; cleans legacy `（Multikey）` model variants |
| Smart key selection | Highest remaining quota first (monthly > weekly > rolling); unknown quota joins neutrally; ties round-robin |
| Auto-quarantine | 401/403 for 10 min, 429 for 1 min, transient network for 30 s (configurable); manually clearable |
| Low-quota model downgrade (optional) | e.g. `qwen3.7-max → qwen3.7-plus`; never downgrades under an unknown quota |
| Entry point | **Settings menu only** (Settings → OpenCodeGo Multi-Key); no sidebar badge |
| Usage display | By dsh-usage-stats per "OpenCode Go Multikey" model (no usage panel of its own) |
| Bilingual | Settings page and README are zh/en bilingual (README.md + README.en.md switchable) |
| Persistence | State stored at `<DSH_HOME>/storages/opencodego-multikey.json` |
| Security | Proxy and management API are loopback-only; every view shows masked keys |

---

## Architecture

```
                        ┌──────────────────────── DSH Web process ──────────────────────┐
 DSH pi-ai request ────►│ opencode-go provider baseURL → local proxy                  │
 (baseURL=              │      │                                                      │
  http://127.0.0.1:19781)     ▼                                                       │
                        │  ┌────────────────────────────────────────────┐              │
                        │  │ lib/proxy.js reverse proxy (loopback only)  │              │
                        │  │  1. pick key with the most remaining quota  │              │
                        │  │  2. optional model downgrade (fallbacks)    │              │
                        │  │  3. forward to https://opencode.ai/zen/go   │              │
                        │  │  4. pass through usage (DSH token meter)    │              │
                        │  └──────────────────┬─────────────────────────┘              │
                        │                     │ usage / quarantine                      │
                        │  ┌──────────────────▼─────────────────────────┐              │
                        │  │ KeyPool (memory + state file)               │              │
                        │  └──────────────────┬─────────────────────────┘              │
                        │                     │ pull quota every 60 s                  │
                        │  ┌──────────────────▼─────────────────────────┐              │
                        │  │ lib/quota.js  GET /v1/usage (Bearer)        │              │
                        │  └────────────────────────────────────────────┘              │
                        │  management API (same-origin, loopback): /api/opencodego-multikey/* │
                        └──▲───────────────────────────────────────────────────────────┘
                           │
                    Browser: Settings → "OpenCodeGo Multi-Key" manages the pool;
                    usage is shown per model in the sidebar "Usage & Balance" (dsh-usage-stats)
```

---

## Install

```bash
dsh plugin --profile web add github:zhuchundashuaige/dsh-opencodego-multikey
```

or run the installer from this repository:

```bash
node scripts/install.mjs
```

After installing, **restart `dsh web`** once (the host-side "OpenCode Go Multikey" provider injection needs the new code), then **hard-refresh** the browser (Ctrl+Shift+R).

### Hot reload during development

Depend on a **local link** to this checkout to live-edit the panel:

```bash
dsh plugin --profile web remove dsh-opencodego-multikey
dsh plugin --profile web add link:C:\path\to\dsh-opencodego-multikey
```

The client bundle is served with `no-cache` and re-hashed: after editing `lib/client.js`, **hard-refresh** the browser (host-side `lib/*.js` changes still require a `dsh` restart).

> `dsh plugin add` adds the plugin to `dsh.profile.bundles` automatically because the package declares `dsh.bundle`.

---

## Configure the DSH provider

On load the plugin auto-writes (via the `settings` service, idempotently):

- Adds a **dedicated provider** `opencode-go-multikey` (display name `OpenCode Go Multikey`): models identical to `opencode-go`, `api` and `apiKeyEnv` inherited (any api key), `baseURL = http://127.0.0.1:{listenPort}` (the local proxy);
- Cleans any legacy `（Multikey）` model variants from the `opencode-go` provider (its models and baseURL are left as-is).

So the Model dropdown gains a full "OpenCode Go Multikey" set of models — picking any routes the request through the pool load-balancer. The `apiKeyEnv` value only satisfies DSH's config validation; the proxy ignores the inbound credential and uses the Key pool, which also lets dsh-usage-stats aggregate usage neatly under this dedicated provider.

To manage by hand, set `injectProvider: false`, create the provider yourself with its baseURL at the proxy, and manage the models manually.

---

## Usage

1. In the Model dropdown pick a model under the **"OpenCode Go Multikey"** provider (e.g. `minimax-m3`) — calls automatically load-balance the key pool.
2. Open **Settings → OpenCodeGo Multi-Key**, paste an OpenCode Go API key (optional label), hit **Add**. The plugin probes its quota immediately and auto-refreshes every 60 s. Each key card shows status (active / quarantined / disabled) and the rolling / weekly / monthly quota bars (used % + reset time).
3. Disable / delete a key, or un-quarantine a key that was auto-isolated.
4. **View aggregate usage** with [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats): open the sidebar "Usage & Balance" and see each "OpenCode Go Multikey" model's pooled usage.

### Scheduling rules

- Each request starts by picking from **enabled, non-quarantined, non-exhausted** keys.
- Sorted by remaining quota: `monthly > weekly > rolling`.
- Keys with unknown quota compete with a neutral score (50).
- Quota ≤ `exhaustThresholdPct` (default 2%) counts as exhausted and is skipped.
- Equal score → least-recently-picked wins (round-robin).
- `fallbacks` match the model's real id (the supplier's model ids equal opencode-go's).

### Model downgrade (optional)

```yaml
- id: opencodego-multikey
  config:
    fallbackThresholdPct: 10
    fallbacks:
      qwen3.7-max: qwen3.7-plus
      qwen3.7-plus: minimax-m3
```

When the selected key's remaining quota ≤ `fallbackThresholdPct` (default 10%) the request model is rewritten to the cheaper one. Downgrade never happens while the quota is unknown.

---

## Configuration

All passed via the `config` of the `opencodego-multikey` row (all optional; defaults below).

| Key | Default | Description |
| --- | --- | --- |
| `listenPort` | `19781` | Proxy listen port (loopback only) |
| `host` | `127.0.0.1` | Proxy bind address |
| `upstreamBaseURL` | `https://opencode.ai/zen/go` | Upstream OpenCode Go origin |
| `refreshMs` | `60000` | Quota refresh period (ms) |
| `exhaustThresholdPct` | `2` | Remaining quota below this counts as exhausted |
| `fallbackThresholdPct` | `10` | Quota threshold that triggers model downgrade |
| `fallbacks` | `{}` | Model downgrade map |
| `quarantineAuthMs` | `600000` | 401/403 quarantine duration |
| `quarantineRateMs` | `60000` | 429 quarantine duration |
| `quarantineNetworkMs` | `30000` | Transient-network quarantine |
| `historyDays` | `90` | Daily-detail retention days |
| `stateFile` | `<DSH_HOME>/storages/opencodego-multikey.json` | State file |
| `sourceRoute` | `opencode-go` | Source provider route whose models/api are mirrored |
| `newProviderRoute` | `opencode-go-multikey` | New dedicated provider route id (under `llm-pi-ai.providers`) |
| `newProviderDisplayName` | `OpenCode Go Multikey` | Display name of the new provider |
| `proxyBaseURL` | `http://127.0.0.1:{listenPort}` | Proxy base URL pinned onto the new provider |
| `injectProvider` | `true` | Auto-add the new supplier + clean legacy `（Multikey）` variants on load |
| `multikeySuffix` | `" (Multikey)"` | Suffix recognized when cleaning legacy variants |
| `fallbackProtocol` | `openai-completions` | Wire protocol used when the source route declares no `api` |

Example:

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

## Management API (loopback, panel use only)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/opencodego-multikey/overview` | Config + masked key list + usage + aggregate |
| POST | `/api/opencodego-multikey/keys` | Add key, body `{ key, label?, enabled? }` |
| DELETE | `/api/opencodego-multikey/keys?id=<id>` | Remove key |
| POST | `/api/opencodego-multikey/keys/toggle` | Enable/disable, body `{ id, enabled }` |
| POST | `/api/opencodego-multikey/keys/clear-quarantine` | Clear quarantine, body `{ id }` |
| POST | `/api/opencodego-multikey/refresh` | Force refresh all keys' quota |

All endpoints accept only loopback requests (`127.0.0.1` / `::1`, Host header checked).

---

## Usage accounting

The plugin no longer renders usage itself. The proxy **forwards the upstream `usage` unmodified**, so DSH's own token meter records each call and [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) displays the pooled usage per "OpenCode Go Multikey" model. To do so the proxy understands every usage shape while streaming: OpenAI `prompt_tokens / completion_tokens / total_tokens`, OpenAI Responses `input_tokens / output_tokens / input_tokens_details.cached_tokens`, Anthropic `input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`.

- SSE responses parse `data:` lines and merge by per-field maximum (OpenAI returns the cumulative total at the end; Anthropic reports input at `message_start` and output at `message_delta`).
- Models are forwarded with their real ids, so dsh-usage-stats groups usage under the "OpenCode Go Multikey" model id that DSH actually called.

---

## Development

```bash
npm run check   # syntax-check every file
npm test        # unit + integration tests (node:test, no DSH needed)
```

Coverage: quota-window parsing and scoring, key-pool selection / round-robin / quarantine, `（Multikey）` injection idempotency and suffix normalization, plus an end-to-end proxy test against a local fake upstream.

---

## i18n

The Settings page reads a single locale namespace `opencodegoMultiKey` (`zh` / `en` dictionaries, registered via `ctx.locale`); the nav label and hints follow the active UI language. This README ships [中文](README.md) and [English](README.en.md).

---

## Security

See [SECURITY.md](./SECURITY.md). Key points: proxy & API loopback-only; keys live only in memory and the state file; every view shows masked keys; upstream uses the `upstreamBaseURL` scheme (HTTPS by default).

---

## License

[MIT](./LICENSE)
