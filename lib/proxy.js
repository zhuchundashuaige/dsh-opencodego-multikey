/**
 * dsh-opencodego-multikey — the OpenAI/Anthropic-compatible reverse proxy.
 *
 * DSH's pi-ai adapter is pointed at a provider route whose baseURL is the
 * proxy origin (http://127.0.0.1:{port}). Every incoming model request is:
 *
 *   1. assigned the best API key from the pool (highest remaining quota),
 *   2. optionally rewritten to a cheaper fallback model when the chosen
 *      key is running low,
 *   3. forwarded to the real OpenCode Go endpoint with the chosen key,
 *   4. streamed back unchanged while token usage is captured from the
 *      response (OpenAI chat completions / responses and Anthropic Messages
 *      JSON and SSE shapes are all understood),
 *   5. recorded into the per-key usage statistics.
 *
 * Only loopback clients are served; the listener binds to 127.0.0.1.
 *
 * @module dsh-opencodego-multikey/proxy
 */

import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { joinUrl } from "./quota.js";
import { addRequest, estimateCost, normalizeUsage } from "./stats.js";

/** Hop-by-hop headers that must never be forwarded verbatim. */
const HOP_BY_HOP = new Set([
	"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
	"te", "trailer", "transfer-encoding", "upgrade"
]);

const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024; // 128 MiB cap before streaming without capture

function jsonError(res, status, error, extra = {}) {
	const body = JSON.stringify({ ok: false, error, ...extra });
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache",
		...(status === 429 ? { "retry-after": "5" } : {})
	});
	res.end(body);
}

/** Choose the outgoing transport for one target URL. */
export function transportFor(url) {
	return String(url).startsWith("https:") ? { request: httpsRequest, isSecure: true } : { request: httpRequest, isSecure: false };
}

/** Strip hop-by-hop and connection-specific headers for forwarding. */
export function forwardHeaders(headers) {
	const out = {};
	for (const [key, value] of Object.entries(headers ?? {})) {
		const lower = key.toLowerCase();
		if (HOP_BY_HOP.has(lower)) continue;
		if (lower === "host" || lower === "authorization" || lower === "content-length") continue;
		out[key] = value;
	}
	return out;
}

/**
 * Apply the configured model fallback to a request body.
 * @returns { body, changed, from, to }
 */
export function applyModelFallback(body, config, score) {
	const fallbacks = config?.fallbacks ?? {};
	const model = body?.model;
	if (typeof model !== "string" || model === "") return { body, changed: false, from: model ?? null, to: null };
	const fallback = fallbacks[model];
	if (typeof fallback !== "string" || fallback === "") return { body, changed: false, from: model, to: null };
	// Downgrade only when we KNOW the key is running low; an unknown quota
	// must never silently change the requested model.
	if (typeof score !== "number" || score > (config?.fallbackThresholdPct ?? 10)) {
		return { body, changed: false, from: model, to: null };
	}
	return { body: { ...body, model: fallback }, changed: true, from: model, to: fallback };
}

/**
 * Merge a newly observed usage object into a running capture, keeping the
 * maximum cumulative value of each field (streams report input tokens early
 * and output tokens late, so per-field max is correct for OpenAI and
 * Anthropic streaming alike).
 */
export function mergeUsage(capture, usage) {
	const normalized = normalizeUsage(usage);
	if (normalized === null) return capture;
	for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "totalTokens"]) {
		capture[field] = Math.max(capture[field] ?? 0, normalized[field] ?? 0);
	}
	capture.seen = true;
	return capture;
}

/** Feed one SSE `data:` line into the usage capture. */
export function captureSseLine(capture, line) {
	const trimmed = String(line).trim();
	if (!trimmed.startsWith("data:")) return capture;
	const payload = trimmed.slice(5).trim();
	if (payload === "" || payload === "[DONE]") return capture;
	let parsed = null;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return capture;
	}
	if (parsed === null || typeof parsed !== "object") return capture;
	if (parsed.usage !== null && typeof parsed.usage === "object") {
		mergeUsage(capture, parsed.usage);
	} else if (parsed.message !== null && typeof parsed.message === "object" && parsed.message.usage !== null && typeof parsed.message.usage === "object") {
		mergeUsage(capture, parsed.message.usage);
	}
	return capture;
}

function isJsonContent(headers) {
	const type = String(headers?.["content-type"] ?? "").toLowerCase();
	return type.includes("application/json") || type.includes("text/json") || type === "";
}

function isSseContent(headers) {
	return String(headers?.["content-type"] ?? "").toLowerCase().includes("text/event-stream");
}

function filteredResponseHeaders(headers, body) {
	const out = {};
	for (const [key, value] of Object.entries(headers ?? {})) {
		const lower = key.toLowerCase();
		if (HOP_BY_HOP.has(lower)) continue;
		if (lower === "content-length" || lower === "content-encoding") continue;
		out[key] = value;
	}
	if (body !== void 0) out["content-length"] = String(body.length);
	return out;
}

/** Read the request body up to a cap; null when the cap is exceeded. */
function readBody(req, maxBytes) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let overflow = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				overflow = true;
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (overflow) {
				resolve(null);
				return;
			}
			resolve(Buffer.concat(chunks));
		});
		req.on("error", () => resolve(null));
	});
}

/**
 * Create the proxy HTTP server.
 * @param deps - { pool, statsByKey (Map), config, logger, onRequest?, now? }
 */
export function createProxyServer(deps) {
	const { logger } = deps;
	const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	const server = createServer((req, res) => {
		handleProxy(req, res, { ...deps, maxBodyBytes })
			.then(() => deps.onRequest?.())
			.catch((error) => {
				logger?.warn?.(`opencodego-multikey: proxy failure: ${String(error)}`);
				try {
					if (!res.headersSent) jsonError(res, 502, "upstream proxy failure");
					else res.end();
				} catch {
					/* client already gone */
				}
				deps.onRequest?.();
			});
	});
	return server;
}

/**
 * Handle one proxied request. Exported separately so unit tests can drive
 * the full flow with a mocked transport.
 * @param incoming - http.IncomingMessage
 * @param outgoing - http.ServerResponse
 * @param deps - { pool, statsByKey, config, logger, maxBodyBytes, now?, transport?, historyDays? }
 */
export async function handleProxy(incoming, outgoing, deps) {
	const { pool, statsByKey, config, logger } = deps;
	const upstreamBaseURL = config.upstreamBaseURL;
	const now = deps.now ?? Date.now;

	if (incoming.method !== "POST" && incoming.method !== "GET") {
		jsonError(outgoing, 405, "method not allowed");
		return;
	}

	const entry = pool.select();
	if (entry === null) {
		jsonError(outgoing, 429, "no usable api key in the pool (all enabled keys are exhausted, quarantined, or absent)");
		return;
	}
	const keyId = entry.id;

	const body = await readBody(incoming, deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
	let parsedBody = null;
	let model = null;
	let fallback = null;
	if (body !== null) {
		try {
			parsedBody = JSON.parse(body);
			model = parsedBody?.model ?? null;
		} catch {
			parsedBody = null;
		}
	}
	if (parsedBody !== null && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
		const applied = applyModelFallback(parsedBody, config, entry.quota?.score ?? null);
		if (applied.changed) {
			parsedBody = applied.body;
			model = applied.to;
			fallback = { from: applied.from, to: applied.to };
			logger?.info?.(`opencodego-multikey: key ${keyId} below ${config.fallbackThresholdPct}% — model downgraded ${applied.from} → ${applied.to}`);
		}
	}

	const target = joinUrl(upstreamBaseURL, incoming.url ?? "/");
	const { request: transport } = deps.transport ?? transportFor(target);
	const headers = {
		...forwardHeaders(incoming.headers),
		authorization: `Bearer ${entry.key}`,
		...(body === null ? {} : { "content-length": Buffer.byteLength(body) })
	};

	const stats = statsByKey.get(keyId);
	if (stats !== void 0) stats.picked = (stats.picked ?? 0) + 1;

	const record = (status, tokens) => {
		const stats = statsByKey.get(keyId);
		if (stats === void 0) return;
		const cost = tokens === null || tokens === void 0 ? null : estimateCost(model, tokens);
		addRequest(stats, {
			ok: status >= 200 && status < 300,
			model,
			tokens: tokens ?? null,
			cost,
			at: now()
		}, deps.historyDays);
	};

	const quarantineFor = (status, reason) => {
		if (status === 401 || status === 403) {
			pool.quarantine(keyId, reason ?? "inference rejected (401/403)", pool.quarantineAuthMs);
		} else if (status === 429) {
			pool.quarantine(keyId, reason ?? "inference rate limited (429)", pool.quarantineRateMs);
		}
	};

	try {
		await new Promise((resolve, reject) => {
			const upstream = transport(target, { method: incoming.method, headers }, (upstreamResponse) => {
				const capture = {
					seen: false, inputTokens: 0, outputTokens: 0,
					cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0
				};
				const status = upstreamResponse.statusCode ?? 502;
				if (isSseContent(upstreamResponse.headers)) {
					streamSse(upstreamResponse, outgoing, capture, () => {
						record(status, capture.seen ? capture : null);
						quarantineFor(status);
						resolve();
					});
					return;
				}
				const chunks = [];
				upstreamResponse.on("data", (chunk) => chunks.push(chunk));
				upstreamResponse.on("end", () => {
					const full = Buffer.concat(chunks);
					if (status >= 200 && status < 300 && isJsonContent(upstreamResponse.headers) && full.length > 0) {
						try {
							const parsed = JSON.parse(full.toString("utf8"));
							if (parsed !== null && typeof parsed === "object" && parsed.usage !== null && typeof parsed.usage === "object") {
								mergeUsage(capture, parsed.usage);
							}
						} catch {
							/* non-JSON success body → pass through untouched */
						}
					}
					if (!outgoing.headersSent) {
						outgoing.writeHead(status, filteredResponseHeaders(upstreamResponse.headers, full));
					}
					outgoing.end(full);
					record(status, capture.seen ? capture : null);
					quarantineFor(status);
					resolve();
				});
			});
			upstream.setTimeout(10 * 60 * 1000, () => {
				upstream.destroy(new Error("upstream idle timeout"));
			});
			upstream.on("error", (error) => {
				if (error?.httpStatus) {
					quarantineFor(error.httpStatus, `upstream error ${error.httpStatus}`);
				} else {
					pool.quarantine(keyId, "transient network failure", pool.quarantineNetworkMs);
				}
				if (!outgoing.headersSent) jsonError(outgoing, 502, "upstream connection failed");
				else outgoing.end();
				record(502, null);
				reject(error);
			});
			if (body !== null) upstream.write(body);
			upstream.end();
		});
	} catch {
		/* handled in the rejection path above */
	}
}

/** Stream an SSE upstream body while capturing usage on the side. */
function streamSse(upstream, outgoing, capture, onDone) {
	if (!outgoing.headersSent) {
		outgoing.writeHead(upstream.statusCode ?? 200, filteredResponseHeaders(upstream.headers));
	}
	let buffer = "";
	upstream.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		let index;
		while ((index = buffer.indexOf("\n")) !== -1) {
			captureSseLine(capture, buffer.slice(0, index));
			buffer = buffer.slice(index + 1);
		}
		if (!outgoing.destroyed) outgoing.write(chunk);
	});
	upstream.on("end", () => {
		if (buffer !== "") captureSseLine(capture, buffer);
		try {
			outgoing.end();
		} catch {
			/* ignore */
		}
		onDone();
	});
	upstream.on("error", () => {
		try {
			outgoing.end();
		} catch {
			/* ignore */
		}
		onDone();
	});
}