/**
 * dsh-opencodego-multikey — server half.
 *
 * An OpenCode Go gateway for DSH that pools multiple API keys:
 *
 *  - a loopback reverse proxy (default http://127.0.0.1:19781) that picks
 *    the key with the most remaining quota per request, optionally downgrades
 *    the model when that key runs low, forwards to the real endpoint and
 *    records token usage;
 *  - a background quota refresher that polls the OpenCode Go usage endpoint
 *    for every key (rolling / weekly / monthly percentage windows);
 *  - a loopback-only management API on the web server for the dashboard
 *    (add / remove / toggle / unquarantine keys, force refresh, overview);
 *  - durable per-key and aggregate usage statistics persisted under
 *    <DSH_HOME>/storages/opencodego-multikey.json.
 *
 * No API keys are ever stored in the web server routes or the browser —
 * keys live in the state file and in memory only; every public view masks
 * them.
 *
 * @module dsh-opencodego-multikey
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createProxyServer } from "./proxy.js";
import { fetchQuota } from "./quota.js";
import { KeyPool } from "./keys.js";
import { createKeyStats, parseStats, renderOverview, serializeStats } from "./stats.js";

/** Stable Cordis plugin name. */
export const name = "opencodego-multikey";

/** Services required before this plugin activates. */
export const inject = ["webServer"];

/** Management API prefix (loopback-only, same-origin for the dashboard). */
export const API_PREFIX = "/api/opencodego-multikey";

const STATE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 1500;

/** Default configuration (overridable through the cordis row `config`). */
export const DEFAULTS = {
	host: "127.0.0.1",
	listenPort: 19781,
	upstreamBaseURL: "https://opencode.ai/zen/go",
	refreshMs: 60000,
	exhaustThresholdPct: 2,
	fallbackThresholdPct: 10,
	// model → cheaper model, e.g. { "qwen3.7-max": "qwen3.7-plus" }
	fallbacks: {},
	quarantineAuthMs: 10 * 60 * 1000,
	quarantineRateMs: 60 * 1000,
	quarantineNetworkMs: 30 * 1000,
	historyDays: 90,
	stateFile: null,
	// -- Multikey model injection -----------------------------------------
	// Provider route under llm-pi-ai.providers whose models get " (Multikey)"
	// variants, and the proxy base URL those variants are pinned to.
	providerRoute: "opencode-go",
	proxyBaseURL: null, // resolved at runtime: http://127.0.0.1:{listenPort}
	// Whether to write baseURL + Multikey models into llm-pi-ai settings on
	// activation. Disable to only run the proxy pool (models managed by hand).
	injectProvider: true,
	multikeySuffix: " (Multikey)"
};

export function normalizeConfig(raw = {}) {
	const source = raw ?? {};
	return {
		host: stringOf(source.host, DEFAULTS.host),
		listenPort: intOf(source.listenPort, DEFAULTS.listenPort, 1, 65535),
		upstreamBaseURL: stringOf(source.upstreamBaseURL, DEFAULTS.upstreamBaseURL),
		refreshMs: intOf(source.refreshMs, DEFAULTS.refreshMs, 5000, Number.MAX_SAFE_INTEGER),
		exhaustThresholdPct: clampPct(source.exhaustThresholdPct, DEFAULTS.exhaustThresholdPct),
		fallbackThresholdPct: clampPct(source.fallbackThresholdPct, DEFAULTS.fallbackThresholdPct),
		fallbacks: objectMap(source.fallbacks),
		quarantineAuthMs: intOf(source.quarantineAuthMs, DEFAULTS.quarantineAuthMs, 1000, Number.MAX_SAFE_INTEGER),
		quarantineRateMs: intOf(source.quarantineRateMs, DEFAULTS.quarantineRateMs, 1000, Number.MAX_SAFE_INTEGER),
		quarantineNetworkMs: intOf(source.quarantineNetworkMs, DEFAULTS.quarantineNetworkMs, 0, Number.MAX_SAFE_INTEGER),
		historyDays: intOf(source.historyDays, DEFAULTS.historyDays, 1, 3650),
		stateFile: typeof source.stateFile === "string" && source.stateFile.trim() !== "" ? source.stateFile : null,
		providerRoute: stringOf(source.providerRoute, DEFAULTS.providerRoute),
		proxyBaseURL: typeof source.proxyBaseURL === "string" && source.proxyBaseURL.trim() !== ""
			? source.proxyBaseURL.trim()
			: `http://127.0.0.1:${intOf(source.listenPort, DEFAULTS.listenPort, 1, 65535)}`,
		injectProvider: source.injectProvider !== false,
		multikeySuffix: typeof source.multikeySuffix === "string" && source.multikeySuffix.trim() !== ""
			? source.multikeySuffix.trim()
			: DEFAULTS.multikeySuffix
	};
}

function stringOf(value, fallback) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function intOf(value, fallback, min, max) {
	const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(min, Math.min(max, parsed));
}

function clampPct(value, fallback) {
	const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.max(0, Math.min(100, parsed));
}

function objectMap(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const out = {};
	for (const [key, val] of Object.entries(value)) {
		if (typeof val === "string" && val.trim() !== "") out[key] = val.trim();
	}
	return out;
}

//#region loopback fence (same policy as the sibling usage-stats plugin)
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name = hostNameOf(req.headers.host);
	return name === "localhost" || isLoopbackAddress(name);
}

/** Refuse non-loopback callers before any work. */
function rejectForeignCaller(req) {
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	return true;
}
//#endregion

//#region JSON helpers
function readJsonBody(req, limit = 1 * 1024 * 1024) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				resolve(null);
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}

function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}
//#endregion

//#region state store
function defaultStatePath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "opencodego-multikey.json");
}

class StateStore {
	constructor(path) {
		this.path = path;
		this.data = { version: STATE_VERSION, keys: [], stats: {} };
		this.saveTimer = null;
	}

	async load() {
		try {
			const raw = JSON.parse(await readFile(this.path, "utf8"));
			if (raw !== null && typeof raw === "object" && raw.version === STATE_VERSION) {
				if (Array.isArray(raw.keys)) this.data.keys = raw.keys;
				if (raw.stats !== null && typeof raw.stats === "object") this.data.stats = raw.stats;
			}
		} catch {
			/* first run or corrupt state → start fresh */
		}
		return this.data;
	}

	async save() {
		try {
			await mkdir(dirname(this.path), { recursive: true });
			const tmp = `${this.path}.tmp`;
			await writeFile(tmp, JSON.stringify(this.data), "utf8");
			await rename(tmp, this.path);
		} catch (error) {
			this.log?.warn?.(`opencodego-multikey: saving state failed: ${String(error)}`);
		}
	}

	debouncedSave() {
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, SAVE_DEBOUNCE_MS);
		if (typeof this.saveTimer.unref === "function") this.saveTimer.unref();
	}
}
//#endregion

/**
 * Refresh quota for every enabled key, updating the pool and the store.
 */
export async function refreshAllQuota(ctx, pool, store, config, deps = {}) {
	const entries = pool.list().filter((entry) => entry.enabled === true);
	await Promise.allSettled(entries.map(async (entry) => {
		const result = await fetchQuota(entry.key, config.upstreamBaseURL, {
			timeoutMs: deps.timeoutMs,
			now: deps.now
		});
		if (result.status === "ok") {
			pool.setQuota(entry.id, result);
		} else if (result.status === "unauthorized" || result.status === "rate-limited") {
			// Persistent auth/rate problems: update (quarantines the key) even
			// though no windows arrived.
			pool.quotaError(entry.id, result.status, result.error);
		} else {
			// Transient failure: keep the last known windows, just note the error.
			pool.quotaError(entry.id, result.status, result.error);
		}
	}));
	store.debouncedSave();
}

function poolView(pool, config) {
	return pool.list().map((entry) => ({
		id: entry.id,
		label: entry.label,
		maskedKey: maskForView(entry.key),
		enabled: entry.enabled,
		addedAt: entry.addedAt,
		quarantined: entry.quarantineUntil !== null && entry.quarantineUntil > Date.now(),
		quarantineReason: entry.quarantineReason,
		quarantineUntil: entry.quarantineUntil,
		quota: entry.quota,
		remainingScore: typeof entry.quota?.score === "number" ? entry.quota.score : null
	}));
}

function maskForView(key) {
	const text = String(key ?? "");
	if (text.length <= 8) return "••••••••";
	return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

//#region Multikey model injection
/**
 * Build the modified `llm-pi-ai.providers` object for one provider route:
 * pin `baseURL` to the local proxy and append a " (Multikey)" variant of
 * every model that does not already carry the suffix.
 *
 * Pure and dependency-free so it can be unit-tested.
 * @param provider - the provider entry under llm-pi-ai.providers.
 * @param options - { route, proxyBaseURL, multikeySuffix }.
 * @returns the new provider object (unchanged fields preserved).
 */
export function buildMultikeyProvider(provider, options = {}) {
	const route = options.route ?? DEFAULTS.providerRoute;
	const proxyBaseURL = options.proxyBaseURL;
	const suffix = options.multikeySuffix ?? DEFAULTS.multikeySuffix;
	if (provider === null || typeof provider !== "object") return provider;
	const providerObj = Array.isArray(provider) ? { models: provider } : { ...provider };
	const baseURL = proxyBaseURL ?? providerObj.baseURL;
	const next = { ...providerObj };
	if (typeof baseURL === "string" && baseURL.trim() !== "") next.baseURL = baseURL.trim();
	const models = Array.isArray(providerObj.models) ? providerObj.models : [];
	const variantSuffix = suffix;
	const existingVariantIds = new Set(
		models.map((entry) => {
			if (entry === null || typeof entry !== "object") return "";
			return String(entry.id ?? "");
		}).filter((id) => id.endsWith(variantSuffix))
	);
	const variants = [];
	for (const entry of models) {
		if (entry === null || typeof entry !== "object") continue;
		const id = String(entry.id ?? "");
		if (id === "" || id.endsWith(suffix) || existingVariantIds.has(`${id}${suffix}`) || existingVariantIds.has(`${id.trim()}${suffix}`)) continue;
		variants.push({
			id: `${id}${suffix}`,
			name: typeof entry.name === "string" && entry.name !== "" ? `${entry.name}${suffix}` : id,
			...(typeof entry.contextWindow === "number" ? { contextWindow: entry.contextWindow } : {}),
			...(typeof entry.maxTokens === "number" ? { maxTokens: entry.maxTokens } : {}),
			...(typeof entry.api === "string" ? { api: entry.api } : {}),
			...(typeof entry.compat === "object" && entry.compat !== null ? { compat: entry.compat } : {})
		});
	}
	if (variants.length > 0) next.models = [...models, ...variants];
	return next;
}

/**
 * Idempotently write provider baseURL + Multikey models into the harness
 * llm-pi-ai settings. Reads the current namespace, merges only the target
 * route, and writes back through `settings.update`.
 * @param settings - the `settings` service (ctx.get('settings')).
 * @param options - { route, proxyBaseURL, multikeySuffix }.
 * @returns { changed, provider } describing what happened.
 */
export async function injectProviderModels(settings, options = {}) {
	if (settings === void 0 || typeof settings.get !== "function" || typeof settings.update !== "function") {
		return { changed: false, reason: "settings service unavailable" };
	}
	const route = options.route ?? DEFAULTS.providerRoute;
	const ns = "llm-pi-ai";
	const current = settings.get(ns);
	const providers = current?.providers && typeof current.providers === "object" ? current.providers : {};
	if (!Object.prototype.hasOwnProperty.call(providers, route)) {
		return { changed: false, reason: `provider "${route}" not present in llm-pi-ai settings` };
	}
	const original = providers[route];
	const injected = buildMultikeyProvider(original, options);
	const already = JSON.stringify(injected) === JSON.stringify(original);
	if (already) return { changed: false, provider: original };
	const nextProviders = { ...providers, [route]: injected };
	const nextNs = { ...(current !== null && typeof current === "object" ? current : {}), providers: nextProviders };
	await settings.update(ns, { providers: nextProviders });
	return { changed: true, provider: injected };
}
//#endregion

/**
 * Cordis plugin body.
 * @param ctx - plugin context (webServer required; logger optional).
 * @param rawConfig - row `config` from cordis.patch.yml.
 */
export async function apply(ctx, rawConfig = {}) {
	const config = normalizeConfig(rawConfig);
	const store = new StateStore(config.stateFile ?? defaultStatePath());
	store.log = ctx.logger;
	await store.load();

	const pool = new KeyPool({
		exhaustThresholdPct: config.exhaustThresholdPct,
		quarantineAuthMs: config.quarantineAuthMs,
		quarantineRateMs: config.quarantineRateMs,
		quarantineNetworkMs: config.quarantineNetworkMs,
		onChanged: () => store.debouncedSave()
	});
	pool.restore(store.data.keys);

	const statsByKey = new Map();
	for (const [keyId, raw] of Object.entries(store.data.stats ?? {})) {
		if (pool.get(keyId) !== null) statsByKey.set(keyId, parseStats(raw));
	}
	for (const entry of pool.list()) {
		if (!statsByKey.has(entry.id)) statsByKey.set(entry.id, createKeyStats());
	}

	// Keep the persisted stats structure in sync with the live pool.
	const persistStats = () => {
		store.data.stats = {};
		for (const [keyId, stats] of statsByKey) store.data.stats[keyId] = serializeStats(stats);
		store.data.keys = pool.serialize();
	};

	// --- Multikey model injection -------------------------------------------
	// Pin the provider route's baseURL to the proxy and add " (Multikey)"
	// model variants so choosing one in the Model dropdown routes the request
	// through the pool. Best-effort: failures only log, never crash the plugin.
	if (config.injectProvider) {
		void injectProviderModels(ctx.get("settings"), {
			route: config.providerRoute,
			proxyBaseURL: config.proxyBaseURL,
			multikeySuffix: config.multikeySuffix
		}).then((result) => {
			ctx.logger?.info?.(`opencodego-multikey: provider injection ${result.changed ? "applied" : "no-op"} (${result.reason ?? result.provider ? "ok" : "unchanged"})`);
		}).catch((error) => {
			ctx.logger?.warn?.(`opencodego-multikey: provider injection failed: ${String(error)}`);
		});
	}

	// --- proxy listener ----------------------------------------------------
	const proxy = createProxyServer({
		pool,
		statsByKey,
		config,
		logger: ctx.logger,
		onRequest: persistStats
	});
	ctx.effect(() => {
		proxy.listen(config.listenPort, config.host);
		proxy.on("error", (error) => ctx.logger?.warn?.(`opencodego-multikey: proxy listener: ${String(error)}`));
		return () => {
			proxy.close();
			clearTimeout(store.saveTimer);
		};
	}, "opencodego-multikey: proxy listener");

	// --- background quota refresh -------------------------------------------
	const refresh = () => refreshAllQuota(ctx, pool, store, config);
	void refresh();
	const refreshInterval = setInterval(refresh, config.refreshMs);
	if (typeof refreshInterval.unref === "function") refreshInterval.unref();
	ctx.effect(() => () => clearInterval(refreshInterval), "opencodego-multikey: quota refresh");

	// --- management API on the web server -----------------------------------
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return;

	const routes = [
		{ path: `${API_PREFIX}/overview`, handler: handleOverview },
		{ path: `${API_PREFIX}/keys`, handler: handleKeys },
		{ path: `${API_PREFIX}/keys/toggle`, handler: handleToggle },
		{ path: `${API_PREFIX}/keys/clear-quarantine`, handler: handleClearQuarantine },
		{ path: `${API_PREFIX}/refresh`, handler: handleRefresh }
	];

	for (const route of routes) {
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: route.path,
			handler: (req, res) => route.handler(req, res, { ctx, config, pool, statsByKey, store, persistStats })
		}), `opencodego-multikey: ${route.path}`);
	}

	// Shared route handlers (bound via the closure above).
	async function handleOverview(req, res, env) {
		if (rejectForeignCaller(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
		json(res, 200, {
			ok: true,
			config: {
				listenPort: env.config.listenPort,
				host: env.config.host,
				upstreamBaseURL: env.config.upstreamBaseURL,
				refreshMs: env.config.refreshMs,
				exhaustThresholdPct: env.config.exhaustThresholdPct,
				fallbackThresholdPct: env.config.fallbackThresholdPct,
				fallbacks: env.config.fallbacks
			},
			keys: poolView(env.pool),
			usage: renderOverview(Object.fromEntries(env.statsByKey), env.config.historyDays, Date.now())
		});
	}

	async function handleKeys(req, res, env) {
		if (rejectForeignCaller(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (req.method === "POST") {
			const body = await readJsonBody(req);
			if (body === null || typeof body.key !== "string" || body.key.trim() === "") {
				return json(res, 400, { ok: false, error: "body.key is required" });
			}
			try {
				const { entry, created } = env.pool.add(body.key, {
					label: body.label,
					enabled: body.enabled
				});
				if (created) {
					env.statsByKey.set(entry.id, createKeyStats());
					env.persistStats();
					env.store.debouncedSave();
					// Probe the new key's quota immediately.
					void refreshAllQuota(env.ctx, env.pool, env.store, env.config);
				}
				return json(res, created ? 201 : 200, {
					ok: true,
					created,
					key: { id: entry.id, label: entry.label, maskedKey: maskForView(entry.key), enabled: entry.enabled }
				});
			} catch (error) {
				return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (req.method === "DELETE") {
			const url = new URL(req.url ?? "/", "http://x");
			const id = url.searchParams.get("id");
			if (typeof id !== "string" || id === "") return json(res, 400, { ok: false, error: "?id= is required" });
			const removed = env.pool.remove(id);
			if (removed) {
				env.statsByKey.delete(id);
				env.persistStats();
				env.store.debouncedSave();
			}
			return json(res, 200, { ok: true, removed });
		}
		return json(res, 405, { ok: false, error: "method-not-allowed" });
	}

	async function handleToggle(req, res, env) {
		if (rejectForeignCaller(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
		const body = await readJsonBody(req);
		if (body === null || typeof body.id !== "string") return json(res, 400, { ok: false, error: "body.id is required" });
		const changed = env.pool.setEnabled(body.id, body.enabled !== false);
		if (changed) {
			env.persistStats();
			env.store.debouncedSave();
		}
		return json(res, 200, { ok: true, changed });
	}

	async function handleClearQuarantine(req, res, env) {
		if (rejectForeignCaller(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
		const body = await readJsonBody(req);
		if (body === null || typeof body.id !== "string") return json(res, 400, { ok: false, error: "body.id is required" });
		const changed = env.pool.clearQuarantine(body.id);
		if (changed) env.store.debouncedSave();
		return json(res, 200, { ok: true, changed });
	}

	async function handleRefresh(req, res, env) {
		if (rejectForeignCaller(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
		await refreshAllQuota(env.ctx, env.pool, env.store, env.config);
		return json(res, 200, { ok: true });
	}
}