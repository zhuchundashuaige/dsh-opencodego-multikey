import test from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { request as httpClientRequest } from "node:http";
import {
	applyModelFallback,
	captureSseLine,
	createProxyServer,
	forwardHeaders,
	mergeUsage
} from "../lib/proxy.js";
import { joinUrl } from "../lib/quota.js";
import { KeyPool, keyIdOf } from "../lib/keys.js";
import { createKeyStats } from "../lib/stats.js";

test("forwardHeaders strips hop-by-hop and connection headers", () => {
	const out = forwardHeaders({
		host: "127.0.0.1:19781",
		authorization: "Bearer sk-old",
		"content-length": "12",
		connection: "keep-alive",
		"transfer-encoding": "chunked",
		"content-type": "application/json",
		"x-custom": "yes"
	});
	assert.deepEqual(out, { "content-type": "application/json", "x-custom": "yes" });
});

test("applyModelFallback rewrites only when quota is low", () => {
	const config = { fallbacks: { "qwen3.7-max": "qwen3.7-plus" }, fallbackThresholdPct: 10 };
	assert.deepEqual(applyModelFallback({ model: "qwen3.7-max" }, config, 90), {
		body: { model: "qwen3.7-max" }, changed: false, from: "qwen3.7-max", to: null
	});
	assert.deepEqual(applyModelFallback({ model: "qwen3.7-max" }, config, 8), {
		body: { model: "qwen3.7-plus" }, changed: true, from: "qwen3.7-max", to: "qwen3.7-plus"
	});
	// Unknown quota → no rewrite.
	assert.deepEqual(applyModelFallback({ model: "qwen3.7-max" }, config, null), {
		body: { model: "qwen3.7-max" }, changed: false, from: "qwen3.7-max", to: null
	});
	// No fallback configured → untouched.
	assert.deepEqual(applyModelFallback({ model: "minimax-m3" }, config, 1), {
		body: { model: "minimax-m3" }, changed: false, from: "minimax-m3", to: null
	});
});

test("mergeUsage keeps the maximum cumulative value per field", () => {
	const capture = { seen: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
	mergeUsage(capture, { input_tokens: 100, output_tokens: 5 });
	mergeUsage(capture, { input_tokens: 100, output_tokens: 150, total_tokens: 250 });
	assert.equal(capture.seen, true);
	assert.equal(capture.inputTokens, 100);
	assert.equal(capture.outputTokens, 150);
	assert.equal(capture.totalTokens, 250);
});

test("captureSseLine parses OpenAI streaming usage chunks", () => {
	const capture = { seen: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
	captureSseLine(capture, 'data: {"choices":[]}');
	assert.equal(capture.seen, false);
	captureSseLine(capture, 'data: {"usage":{"prompt_tokens":30,"completion_tokens":12,"total_tokens":42}}');
	assert.equal(capture.seen, true);
	assert.equal(capture.inputTokens, 30);
	assert.equal(capture.outputTokens, 12);
	captureSseLine(capture, "data: [DONE]");
	assert.equal(capture.seen, true);
});

test("captureSseLine parses Anthropic streaming message usage", () => {
	const capture = { seen: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
	captureSseLine(capture, 'data: {"type":"message_start","message":{"usage":{"input_tokens":40,"cache_creation_input_tokens":3}}}');
	captureSseLine(capture, 'data: {"type":"message_delta","usage":{"output_tokens":8}}');
	assert.equal(capture.inputTokens, 40);
	assert.equal(capture.cacheCreationTokens, 3);
	assert.equal(capture.outputTokens, 8);
});

test("joinUrl is used for proxy targeting", () => {
	assert.equal(
		joinUrl("https://opencode.ai/zen/go", "/v1/chat/completions"),
		"https://opencode.ai/zen/go/v1/chat/completions"
	);
});

// A real end-to-end test: fake upstream -> proxy -> client, asserting the
// body round-trips, the key is chosen, and usage is recorded.
test("proxy end-to-end: forwards, captures usage and picks the best key", async () => {
	const upstream = httpServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			assert.equal(req.headers.authorization, "Bearer sk-best", "proxy must swap in the selected key");
			assert.equal(body.model, "qwen3.7-max");
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({
				model: body.model,
				usage: { prompt_tokens: 77, completion_tokens: 23, total_tokens: 100 }
			}));
		});
	});
	await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	const port = upstream.address().port;

	const pool = new KeyPool();
	const best = pool.add("sk-best", { label: "Best" }).entry.id;
	const worse = pool.add("sk-worse", { label: "Worse" }).entry.id;
	pool.setQuota(best, { windows: [{ kind: "monthly", remainingPercent: 90 }], status: "ok" });
	pool.setQuota(worse, { windows: [{ kind: "monthly", remainingPercent: 10 }], status: "ok" });

	const statsByKey = new Map();
	for (const entry of pool.list()) statsByKey.set(entry.id, createKeyStats());

	const proxy = createProxyServer({
		pool,
		statsByKey,
		config: { upstreamBaseURL: `http://127.0.0.1:${port}`, fallbacks: {}, fallbackThresholdPct: 10 },
		logger: console,
		now: Date.now,
		historyDays: 90
	});
	await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	const proxyPort = proxy.address().port;

	try {
		const response = await new Promise((resolve, reject) => {
			const req = httpClientRequest(
				{
					host: "127.0.0.1",
					port: proxyPort,
					path: "/v1/chat/completions",
					method: "POST",
					headers: { "content-type": "application/json", authorization: "Bearer sk-whatever" }
				},
				(res) => {
					const chunks = [];
					res.on("data", (chunk) => chunks.push(chunk));
					res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
				}
			);
			req.on("error", reject);
			req.end(JSON.stringify({ model: "qwen3.7-max", messages: [{ role: "user", content: "hi" }] }));
		});

		assert.equal(response.status, 200);
		const parsed = JSON.parse(response.body);
		assert.equal(parsed.model, "qwen3.7-max");
		assert.equal(parsed.usage.total_tokens, 100);
		assert.equal(statsByKey.get(keyIdOf("sk-best")).requests, 1);
		assert.equal(statsByKey.get(keyIdOf("sk-best")).totalTokens, 100);
		assert.equal(statsByKey.get(keyIdOf("sk-best")).picked, 1);
		assert.equal(statsByKey.get(keyIdOf("sk-worse")).requests, 0);
	} finally {
		proxy.close();
		upstream.close();
	}
});

test("proxy returns 429 when the pool is empty", async () => {
	const proxy = createProxyServer({
		pool: new KeyPool(),
		statsByKey: new Map(),
		config: { upstreamBaseURL: "http://127.0.0.1:1", fallbacks: {} },
		logger: console
	});
	await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	const proxyPort = proxy.address().port;
	try {
		const response = await new Promise((resolve, reject) => {
			const req = httpClientRequest(
				{ host: "127.0.0.1", port: proxyPort, path: "/v1/chat/completions", method: "POST" },
				(res) => {
					res.resume();
					res.on("end", () => resolve(res.statusCode));
				}
			);
			req.on("error", reject);
			req.end("{}");
		});
		assert.equal(response, 429);
	} finally {
		proxy.close();
	}
});