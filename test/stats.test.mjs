import test from "node:test";
import assert from "node:assert/strict";
import {
	addRequest,
	aggregateStats,
	createKeyStats,
	dayKeyOf,
	estimateCost,
	normalizeUsage,
	parseStats,
	renderOverview,
	serializeStats
} from "../lib/stats.js";

test("normalizeUsage understands OpenAI chat completions", () => {
	assert.deepEqual(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }), {
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		totalTokens: 15
	});
});

test("normalizeUsage understands OpenAI responses + cached tokens", () => {
	const usage = normalizeUsage({
		input_tokens: 20,
		output_tokens: 7,
		total_tokens: 27,
		input_tokens_details: { cached_tokens: 12 }
	});
	assert.equal(usage.inputTokens, 20);
	assert.equal(usage.outputTokens, 7);
	assert.equal(usage.cacheReadTokens, 12);
});

test("normalizeUsage understands Anthropic messages usage", () => {
	const usage = normalizeUsage({
		input_tokens: 30,
		output_tokens: 9,
		cache_creation_input_tokens: 4,
		cache_read_input_tokens: 8
	});
	assert.equal(usage.cacheCreationTokens, 4);
	assert.equal(usage.cacheReadTokens, 8);
	assert.equal(usage.totalTokens, 51);
});

test("normalizeUsage returns null for empty objects", () => {
	assert.equal(normalizeUsage(null), null);
	assert.equal(normalizeUsage({}), null);
	assert.equal(normalizeUsage({ status: "completed" }), null);
});

test("estimateCost uses per-million rates", () => {
	const tokens = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 };
	assert.equal(estimateCost("qwen3.7-max", tokens), 1000 * 2.5 / 1e6 + 500 * 7.5 / 1e6);
	assert.equal(estimateCost("unknown-model", tokens), null);
});

test("addRequest accumulates counters, daily buckets and models", () => {
	const stats = createKeyStats();
	const at = new Date("2026-01-02T03:00:00Z").getTime();
	addRequest(stats, {
		ok: true,
		model: "qwen3.7-plus",
		tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 150 },
		at
	});
	addRequest(stats, {
		ok: false,
		model: "qwen3.7-plus",
		tokens: null,
		at: at + 1000
	});
	assert.equal(stats.requests, 2);
	assert.equal(stats.completions, 1);
	assert.equal(stats.errors, 1);
	assert.equal(stats.totalTokens, 150);
	assert.equal(stats.estimatedCost > 0, true);
	assert.equal(stats.daily[dayKeyOf(at)].requests, 2);
	assert.equal(stats.models["qwen3.7-plus"].requests, 2);
	assert.ok(stats.firstUsedAt !== null && stats.lastUsedAt !== null);
});

test("serialize/parse round-trips stats", () => {
	const stats = createKeyStats();
	addRequest(stats, { ok: true, model: "minimax-m3", tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 15 }, at: Date.now() });
	const parsed = parseStats(serializeStats(stats));
	assert.equal(parsed.requests, stats.requests);
	assert.equal(parsed.totalTokens, stats.totalTokens);
	assert.deepEqual(Object.keys(parsed.daily), Object.keys(stats.daily));
});

test("aggregateStats sums across keys", () => {
	const a = createKeyStats();
	const b = createKeyStats();
	addRequest(a, { ok: true, model: "qwen3.7-plus", tokens: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 10 }, at: Date.now() });
	addRequest(b, { ok: true, model: "qwen3.7-max", tokens: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 10 }, at: Date.now() });
	const total = aggregateStats([a, b]);
	assert.equal(total.requests, 2);
	assert.equal(total.totalTokens, 20);
	assert.equal(Object.keys(total.models).length, 2);
});

test("renderOverview reports today/month/all aggregates", () => {
	const statsByKey = {};
	const key = "key-1";
	statsByKey[key] = createKeyStats();
	addRequest(statsByKey[key], {
		ok: true,
		model: "minimax-m3",
		tokens: { inputTokens: 0, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100 },
		at: Date.now()
	});
	const overview = renderOverview(statsByKey, 90, Date.now());
	assert.equal(overview.keyStats.length, 1);
	assert.equal(overview.aggregate.totalTokens, 100);
	assert.equal(overview.aggregate.today.tokens, 100);
	assert.equal(overview.aggregate.month.tokens, 100);
	assert.equal(overview.keyStats[0].keyId, key);
});