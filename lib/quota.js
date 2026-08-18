/**
 * dsh-opencodego-multikey — quota adapter for the OpenCode Go usage endpoint.
 *
 * OpenCode Go's documented API does not expose quota, but its first-party
 * client currently uses an undocumented Bearer-key endpoint:
 *
 *   GET {upstreamBaseURL}/v1/usage   Authorization: Bearer <apiKey>
 *
 * The response reports percentage "windows" (rolling / weekly / monthly)
 * with `usedPercent` (0..100) and `resetInSec`. Parsing is deliberately
 * lenient — the object can also carry the fields under ratio-style names
 * (usedPercentage / usagePercent / percentUsed ...) and reset times as
 * ISO strings or epoch seconds — so a future response-shape change degrades
 * to "unknown quota" instead of a hard failure.
 *
 * This module is pure and dependency-free so it can be unit-tested without
 * DSH or a network.
 *
 * @module dsh-opencodego-multikey/quota
 */

/** How long before an upstream timeout is reported as `unavailable`. */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Each parsed window keeps the wall-clock reset time plus percentages. */
export function clampPercent(value) {
	const parsed = numberOrNull(value);
	return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}

export function numberOrNull(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function round1(value) {
	return Math.round(value * 10) / 10;
}

/**
 * Parse one window object (rolling / weekly / monthly) into a normalized
 * record. Returns null when the object carries no usable percentage.
 */
export function windowFromObject(value, kind, now = Date.now()) {
	if (value === null || typeof value !== "object") return null;
	const percentSource = value.percent ?? value.usagePercent ?? value.usedPercent ?? value.usedPercentage ?? value.percentUsed ?? value.percentage;
	let usedPercent = clampPercent(percentSource);
	if (usedPercent === null) {
		const used = numberOrNull(value.used ?? value.consumed);
		const limit = numberOrNull(value.limit ?? value.total ?? value.quota);
		if (used !== null && limit !== null && limit > 0) {
			usedPercent = clampPercent((used / limit) * 100);
		}
	}
	if (usedPercent === null) return null;
	// The dashboard embeds `usagePercent` as a 0..1 ratio; the Bearer
	// endpoint's own `percent` is already 0..100. Only scale ratio-named
	// fields when no explicit percent field is present.
	if (usedPercent <= 1 && value.percent === void 0 && percentSource !== void 0) {
		usedPercent *= 100;
	}
	const resetSeconds = numberOrNull(value.resetInSec ?? value.resetInSeconds ?? value.resetSeconds);
	const resetsAt = resetSeconds === null
		? toIso(value.resetAt ?? value.resetsAt ?? value.nextReset)
		: new Date(now + Math.max(0, resetSeconds) * 1000).toISOString();
	return {
		kind,
		usedPercent: round1(clampPercent(usedPercent)),
		remainingPercent: round1(100 - clampPercent(usedPercent)),
		...(resetsAt === null ? {} : { resetsAt })
	};
}

/** Parse a usage endpoint body into an array of normalized windows. */
export function parseUsageBody(body, now = Date.now()) {
	const usage = body?.usage ?? body;
	if (usage === null || typeof usage !== "object") return [];
	const sessionSource = usage.rolling ?? usage.session ?? usage.daily;
	const weeklySource = usage.weekly ?? usage.week;
	const monthlySource = usage.monthly ?? usage.month;
	return [
		windowFromObject(sessionSource, "rolling", now),
		windowFromObject(weeklySource, "weekly", now),
		windowFromObject(monthlySource, "monthly", now)
	].filter(Boolean);
}

/**
 * Score a parsed window list for key selection.
 *
 * The caller wants the key with the MOST remaining quota. The definitive
 * number for long-term quota planning is the monthly window, then weekly,
 * then the rolling/session window. A key with NO usable quota data gets a
 * neutral score so it stays eligible rather than being starved out.
 *
 * @returns number in 0..100, or null when no window exists at all.
 */
export function scoreOf(windows) {
	if (!Array.isArray(windows)) return null;
	const byKind = (kind) => {
		const hit = windows.find((window) => window.kind === kind);
		return hit === void 0 ? null : hit.remainingPercent;
	};
	const score = byKind("monthly") ?? byKind("weekly") ?? byKind("rolling") ?? null;
	if (score === null) return null;
	return Math.max(0, Math.min(100, Number(score) || 0));
}

/**
 * Fetch and parse the quota for one API key.
 * @param apiKey - the candidate key.
 * @param upstreamBaseURL - origin such as https://opencode.ai/zen/go.
 * @param deps - { request?, timeoutMs? } transport seam for tests.
 * @returns { windows, status, error? } with status one of
 *   ok | unauthorized | rate-limited | invalid-response | unavailable.
 */
export async function fetchQuota(apiKey, upstreamBaseURL, deps = {}) {
	const transport = deps.request ?? httpRequest;
	const url = joinUrl(upstreamBaseURL, "/v1/usage");
	try {
		const body = await transport(url, {
			headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
			timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
		});
		const now = typeof deps.now === "function" ? deps.now() : Date.now();
		const windows = parseUsageBody(body, now);
		if (windows.length === 0) {
			return { windows: [], status: "invalid-response", error: "usage endpoint returned no recognizable windows" };
		}
		return { windows, status: "ok" };
	} catch (error) {
		return { windows: [], status: statusOf(error), error: error instanceof Error ? error.message : String(error) };
	}
}

/** Map a thrown transport error to one of the normalized status values. */
export function statusOf(error) {
	if (error?.httpStatus === 401 || error?.httpStatus === 403) return "unauthorized";
	if (error?.httpStatus === 429) return "rate-limited";
	if (error?.name === "TimeoutError" || error?.name === "AbortError") return "unavailable";
	if (error?.providerStatus) return error.providerStatus;
	return error instanceof SyntaxError ? "invalid-response" : "unavailable";
}

function toIso(value) {
	if (value === null || value === void 0 || value === "") return null;
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value < 20000000000 ? value * 1000 : value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	const date = new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Join an origin that may carry a base path with a route path. */
export function joinUrl(origin, path) {
	const base = String(origin ?? "").replace(/\/+$/, "");
	const suffix = String(path ?? "").startsWith("/") ? path : `/${path}`;
	return `${base}${suffix}`;
}

/**
 * Minimal JSON GET over node:https with a timeout, returning the parsed body.
 * Swappable through `deps.request` for tests. Throws Error with `httpStatus`.
 */
export async function httpRequest(url, init = {}) {
	const { request } = await import("node:https");
	const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const req = request(url, {
			method: "GET",
			headers: init.headers ?? {}
		}, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				const text = Buffer.concat(chunks).toString("utf8");
				if (res.statusCode < 200 || res.statusCode >= 300) {
					const error = new Error(`upstream returned HTTP ${res.statusCode}`);
					error.httpStatus = res.statusCode;
					reject(error);
					return;
				}
				try {
					resolve(JSON.parse(text));
				} catch {
					reject(new SyntaxError(`upstream returned invalid JSON for ${url}`));
				}
			});
		});
		req.on("error", (error) => {
			error.httpStatus = 0;
			reject(error);
		});
		req.setTimeout(timeoutMs, () => {
			const error = new Error(`upstream timed out after ${timeoutMs}ms`);
			error.name = "TimeoutError";
			req.destroy(error);
		});
		req.end();
	});
}