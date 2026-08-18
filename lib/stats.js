/**
 * dsh-opencodego-multikey — usage accounting.
 *
 * Maintains, per API key: request counters, token totals (input / output /
 * cache read / cache creation), cost estimates, pick counts, per-day history
 * and a small per-model breakdown. Pure functions only, so this module is a
 * single source of truth for both the live proxy path and the dashboard.
 *
 * @module dsh-opencodego-multikey/stats
 */

/** How many calendar days of per-day history are retained per key. */
export const DEFAULT_HISTORY_DAYS = 90;

/** Fixed cost table for the OpenCode Go catalog models, per 1M tokens. */
export const MODEL_RATES = {
	"minimax-m3": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheCreation: 0 },
	"qwen3.7-max": { input: 2.5, output: 7.5, cacheRead: 0.5, cacheCreation: 3.125 },
	"qwen3.7-plus": { input: 0.4, output: 1.6, cacheRead: 0.04, cacheCreation: 0.5 }
};

export function zeroBuckets() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		totalTokens: 0,
		estimatedCost: 0
	};
}

/** Local `YYYY-MM-DD` for the given date (or now when omitted). */
export function dayKeyOf(date) {
	const d = date === void 0 ? new Date() : new Date(date);
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${month}-${day}`;
}

/** Normalize any of the upstream usage shapes into uniform token buckets. */
export function normalizeUsage(usage) {
	if (usage === null || typeof usage !== "object") return null;
	const input = pick(usage, [
		"input_tokens", "inputTokens", "prompt_tokens", "promptTokens",
		"input", "prompt"
	]);
	const output = pick(usage, [
		"output_tokens", "outputTokens", "completion_tokens", "completionTokens",
		"output", "completion"
	]);
	const cacheRead = pick(usage, [
		"cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens",
		"prompt_tokens_details.cached_tokens", "input_tokens_details.cached_tokens"
	]);
	const cacheCreation = pick(usage, [
		"cache_creation_input_tokens", "cacheCreationInputTokens",
		"cache_write_tokens", "cacheWriteTokens"
	]);
	const total = pick(usage, ["total_tokens", "totalTokens"]);
	if (input === null && output === null && total === null) return null;
	const inputTokens = Math.max(0, input ?? 0);
	const outputTokens = Math.max(0, output ?? 0);
	const cacheReadTokens = Math.max(0, cacheRead ?? 0);
	const cacheCreationTokens = Math.max(0, cacheCreation ?? 0);
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		totalTokens: total !== null ? Math.max(0, total) : inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
	};
}

/** Read a possibly dotted key path from a plain object. */
function pick(source, candidates) {
	for (const candidate of candidates) {
		let value = source;
		let hit = true;
		for (const segment of candidate.split(".")) {
			if (value === null || typeof value !== "object") {
				hit = false;
				break;
			}
			value = value[segment];
		}
		if (hit && typeof value === "number" && Number.isFinite(value)) return value;
		if (hit && typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

/** Estimate the USD cost of one request from tokens + model id, or null. */
export function estimateCost(model, tokens, rates = MODEL_RATES) {
	const rate = rates[String(model ?? "")];
	if (rate === void 0) return null;
	if (tokens === null || typeof tokens !== "object") return null;
	const raw = (tokens.inputTokens ?? 0) * rate.input
		+ (tokens.outputTokens ?? 0) * rate.output
		+ (tokens.cacheReadTokens ?? 0) * (rate.cacheRead ?? 0)
		+ (tokens.cacheCreationTokens ?? 0) * (rate.cacheCreation ?? 0);
	return Math.round((raw / 1e6) * 1e6) / 1e6; // per-token rates → USD
}

/** Create a fresh stats object for one key. */
export function createKeyStats() {
	return {
		requests: 0,
		completions: 0,
		errors: 0,
		picked: 0,
		firstUsedAt: null,
		lastUsedAt: null,
		...zeroBuckets(),
		daily: {},
		models: {}
	};
}

/**
 * Record one completed (or failed) proxied request against a key.
 * @param stats - the key stats object (mutated in place).
 * @param options - { ok, model, tokens, cost, at }.
 */
export function addRequest(stats, options = {}, historyDays = DEFAULT_HISTORY_DAYS) {
	const at = options.at ?? Date.now();
	const day = dayKeyOf(at);
	const tokens = normalizeUsage(options.tokens);
	const cost = options.cost === void 0
		? (tokens === null ? null : estimateCost(options.model, tokens))
		: options.cost;

	stats.requests += 1;
	if (options.ok === true) stats.completions += 1;
	else stats.errors += 1;
	if (stats.firstUsedAt === null) stats.firstUsedAt = new Date(at).toISOString();
	stats.lastUsedAt = new Date(at).toISOString();

	let daily = stats.daily[day];
	if (daily === void 0) {
		daily = { requests: 0, errors: 0, ...zeroBuckets() };
		stats.daily[day] = daily;
	}
	daily.requests += 1;
	if (options.ok !== true) daily.errors += 1;

	if (tokens !== null) {
		stats.inputTokens += tokens.inputTokens;
		stats.outputTokens += tokens.outputTokens;
		stats.cacheReadTokens += tokens.cacheReadTokens;
		stats.cacheCreationTokens += tokens.cacheCreationTokens;
		stats.totalTokens += tokens.totalTokens;
		daily.inputTokens += tokens.inputTokens;
		daily.outputTokens += tokens.outputTokens;
		daily.cacheReadTokens += tokens.cacheReadTokens;
		daily.cacheCreationTokens += tokens.cacheCreationTokens;
		daily.totalTokens += tokens.totalTokens;
		if (cost !== null && cost !== void 0) {
			stats.estimatedCost += cost;
			daily.estimatedCost += cost;
		}
	}

	if (options.model !== null && options.model !== void 0 && options.model !== "") {
		let model = stats.models[options.model];
		if (model === void 0) {
			model = { requests: 0, tokens: 0, estimatedCost: 0 };
			stats.models[options.model] = model;
		}
		model.requests += 1;
		if (tokens !== null) {
			model.tokens += tokens.totalTokens;
			if (cost !== null && cost !== void 0) model.estimatedCost += cost;
		}
	}

	pruneHistory(stats, historyDays, at);
	return stats;
}

/** Drop per-day history older than `historyDays` calendar days. */
export function pruneHistory(stats, historyDays = DEFAULT_HISTORY_DAYS, at = Date.now()) {
	const cutoff = new Date(at);
	cutoff.setDate(cutoff.getDate() - historyDays);
	const cutoffKey = dayKeyOf(cutoff);
	for (const day of Object.keys(stats.daily)) {
		if (day < cutoffKey) delete stats.daily[day];
	}
	return stats;
}

/** Serialize stats to a JSON-safe record (daily already is plain). */
export function serializeStats(stats) {
	return {
		...stats,
		daily: { ...(stats.daily ?? {}) },
		models: Object.fromEntries(Object.entries(stats.models ?? {}).map(([model, value]) => [model, { ...value }]))
	};
}

/** Parse a serialized stats record back (lenient; missing fields = 0). */
export function parseStats(raw) {
	const stats = createKeyStats();
	if (raw === null || typeof raw !== "object") return stats;
	stats.requests = intOf(raw.requests);
	stats.completions = intOf(raw.completions);
	stats.errors = intOf(raw.errors);
	stats.picked = intOf(raw.picked);
	if (typeof raw.firstUsedAt === "string") stats.firstUsedAt = raw.firstUsedAt;
	if (typeof raw.lastUsedAt === "string") stats.lastUsedAt = raw.lastUsedAt;
	for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "totalTokens", "estimatedCost"]) {
		stats[key] = numOf(raw[key]);
	}
	if (raw.daily !== null && typeof raw.daily === "object") {
		for (const [day, entry] of Object.entries(raw.daily)) {
			if (entry === null || typeof entry !== "object") continue;
			stats.daily[day] = {
				requests: intOf(entry.requests),
				errors: intOf(entry.errors),
				inputTokens: numOf(entry.inputTokens),
				outputTokens: numOf(entry.outputTokens),
				cacheReadTokens: numOf(entry.cacheReadTokens),
				cacheCreationTokens: numOf(entry.cacheCreationTokens),
				totalTokens: numOf(entry.totalTokens),
				estimatedCost: numOf(entry.estimatedCost)
			};
		}
	}
	if (raw.models !== null && typeof raw.models === "object") {
		for (const [model, entry] of Object.entries(raw.models)) {
			if (entry === null || typeof entry !== "object") continue;
			stats.models[model] = {
				requests: intOf(entry.requests),
				tokens: numOf(entry.tokens),
				estimatedCost: numOf(entry.estimatedCost)
			};
		}
	}
	return stats;
}

function intOf(value) {
	return Number.isSafeInteger(value) ? value : 0;
}

function numOf(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Sum a set of stats into one aggregate record. */
export function aggregateStats(entries) {
	const total = createKeyStats();
	total.requests = 0;
	total.errors = 0;
	const seen = new Set();
	const seenModels = new Map();
	for (const entry of entries) {
		total.requests += entry.requests;
		total.completions += entry.completions;
		total.errors += entry.errors;
		total.picked += entry.picked;
		for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "totalTokens", "estimatedCost"]) {
			total[field] += entry[field] ?? 0;
		}
		if (entry.firstUsedAt !== null && (total.firstUsedAt === null || entry.firstUsedAt < total.firstUsedAt)) total.firstUsedAt = entry.firstUsedAt;
		if (entry.lastUsedAt !== null && (total.lastUsedAt === null || entry.lastUsedAt > total.lastUsedAt)) total.lastUsedAt = entry.lastUsedAt;
		for (const [day, value] of Object.entries(entry.daily ?? {})) {
			if (seen.has(day)) continue;
			seen.add(day);
			const merged = { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, estimatedCost: 0 };
			total.daily[day] = merged;
		}
		for (const [day, value] of Object.entries(entry.daily ?? {})) {
			const merged = total.daily[day];
			merged.requests += value.requests ?? 0;
			merged.errors += value.errors ?? 0;
			for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "totalTokens", "estimatedCost"]) {
				merged[field] += value[field] ?? 0;
			}
		}
		for (const [model, value] of Object.entries(entry.models ?? {})) {
			const merged = seenModels.get(model) ?? { requests: 0, tokens: 0, estimatedCost: 0 };
			merged.requests += value.requests ?? 0;
			merged.tokens += value.tokens ?? 0;
			merged.estimatedCost += value.estimatedCost ?? 0;
			seenModels.set(model, merged);
		}
	}
	total.models = Object.fromEntries(seenModels);
	return total;
}

/** Build the compact per-key + aggregate overview sent to the dashboard. */
export function renderOverview(statsByKey, historyDays = DEFAULT_HISTORY_DAYS, now = Date.now()) {
	const keys = Object.entries(statsByKey).map(([keyId, stats]) => ({
		keyId,
		requests: stats.requests,
		completions: stats.completions,
		errors: stats.errors,
		picked: stats.picked,
		firstUsedAt: stats.firstUsedAt,
		lastUsedAt: stats.lastUsedAt,
		inputTokens: stats.inputTokens,
		outputTokens: stats.outputTokens,
		cacheReadTokens: stats.cacheReadTokens,
		cacheCreationTokens: stats.cacheCreationTokens,
		totalTokens: stats.totalTokens,
		estimatedCost: stats.estimatedCost,
		models: Object.entries(stats.models ?? {}).map(([model, value]) => ({ model, ...value }))
	})).sort((a, b) => b.totalTokens - a.totalTokens);
	const aggregate = aggregateStats(Object.values(statsByKey));
	const today = dayKeyOf(now);
	const month = today.slice(0, 7);
	let todayTokens = 0;
	let monthTokens = 0;
	let todayCost = 0;
	let monthCost = 0;
	let todayRequests = 0;
	let monthRequests = 0;
	for (const day of Object.keys(aggregate.daily)) {
		const entry = aggregate.daily[day];
		if (day === today) {
			todayTokens = entry.totalTokens;
			todayCost = entry.estimatedCost;
			todayRequests = entry.requests;
		}
		if (day.startsWith(month)) {
			monthTokens += entry.totalTokens;
			monthCost += entry.estimatedCost;
			monthRequests += entry.requests;
		}
	}
	return {
		keyStats: keys,
		aggregate: {
			requests: aggregate.requests,
			completions: aggregate.completions,
			errors: aggregate.errors,
			inputTokens: aggregate.inputTokens,
			outputTokens: aggregate.outputTokens,
			cacheReadTokens: aggregate.cacheReadTokens,
			cacheCreationTokens: aggregate.cacheCreationTokens,
			totalTokens: aggregate.totalTokens,
			estimatedCost: aggregate.estimatedCost,
			today: { requests: todayRequests, tokens: todayTokens, estimatedCost: todayCost },
			month: { requests: monthRequests, tokens: monthTokens, estimatedCost: monthCost },
			historyDays
		}
	};
}