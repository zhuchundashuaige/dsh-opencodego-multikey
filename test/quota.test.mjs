import test from "node:test";
import assert from "node:assert/strict";
import {
	clampPercent,
	parseUsageBody,
	scoreOf,
	windowFromObject,
	fetchQuota,
	joinUrl
} from "../lib/quota.js";

test("windowFromObject handles the Bearer endpoint's 0..100 percent", () => {
	const window = windowFromObject({ usedPercent: 37.2, resetInSec: 3600 }, "weekly", 1_700_000_000_000);
	assert.equal(window.kind, "weekly");
	assert.equal(window.usedPercent, 37.2);
	assert.equal(window.remainingPercent, 62.8);
	assert.ok(window.resetsAt.startsWith("2023-"));
});

test("windowFromObject scales dashboard ratio fields only when no percent exists", () => {
	const ratio = windowFromObject({ usagePercent: 0.25, resetInSec: 60 }, "monthly", 0);
	assert.equal(ratio.usedPercent, 25);
	const explicit = windowFromObject({ usagePercent: 0.25, percent: 40 }, "monthly", 0);
	assert.equal(explicit.usedPercent, 40);
});

test("windowFromObject derives percent from used/limit counters", () => {
	const window = windowFromObject({ used: 250, limit: 1000 }, "rolling", 0);
	assert.equal(window.usedPercent, 25);
});

test("windowFromObject returns null for unusable objects", () => {
	assert.equal(windowFromObject(null, "monthly"), null);
	assert.equal(windowFromObject({ foo: 1 }, "monthly"), null);
});

test("parseUsageBody extracts rolling/weekly/monthly windows", () => {
	const windows = parseUsageBody({
		usage: {
			rolling: { usedPercent: 10, resetInSec: 60 },
			weekly: { usedPercent: 40, resetInSec: 86400 },
			monthly: { usedPercent: 80, resetInSec: 604800 }
		}
	}, 0);
	assert.deepEqual(
		windows.map((w) => w.kind),
		["rolling", "weekly", "monthly"]
	);
	assert.deepEqual(
		windows.map((w) => w.remainingPercent),
		[90, 60, 20]
	);
});

test("parseUsageBody tolerates a top-level body", () => {
	const windows = parseUsageBody({ monthly: { usedPercent: 5, resetInSec: 10 } }, 0);
	assert.equal(windows.length, 1);
	assert.equal(windows[0].kind, "monthly");
});

test("scoreOf prefers monthly over weekly over rolling", () => {
	assert.equal(scoreOf([
		{ kind: "rolling", remainingPercent: 10 },
		{ kind: "weekly", remainingPercent: 20 },
		{ kind: "monthly", remainingPercent: 30 }
	]), 30);
	assert.equal(scoreOf([
		{ kind: "rolling", remainingPercent: 10 },
		{ kind: "weekly", remainingPercent: 20 }
	]), 20);
	assert.equal(scoreOf([{ kind: "rolling", remainingPercent: 99 }]), 99);
});

test("scoreOf returns null when no window exists", () => {
	assert.equal(scoreOf([]), null);
	assert.equal(scoreOf(null), null);
});

test("clampPercent bounds to 0..100", () => {
	assert.equal(clampPercent(-5), 0);
	assert.equal(clampPercent(150), 100);
	assert.equal(clampPercent(42.5), 42.5);
	assert.equal(clampPercent("12"), 12);
	assert.equal(clampPercent("nope"), null);
});

test("joinUrl joins origins that carry a base path", () => {
	assert.equal(joinUrl("https://opencode.ai/zen/go", "/v1/usage"), "https://opencode.ai/zen/go/v1/usage");
	assert.equal(joinUrl("https://opencode.ai/zen/go/", "v1/chat/completions"), "https://opencode.ai/zen/go/v1/chat/completions");
	assert.equal(joinUrl("https://opencode.ai", "/v1/usage"), "https://opencode.ai/v1/usage");
});

test("fetchQuota succeeds through the transport seam", async () => {
	const result = await fetchQuota("sk-test", "https://opencode.ai/zen/go", {
		request: async (url, init) => {
			assert.equal(url, "https://opencode.ai/zen/go/v1/usage");
			assert.equal(init.headers.authorization, "Bearer sk-test");
			return {
				usage: {
					rolling: { usedPercent: 1, resetInSec: 60 },
					weekly: { usedPercent: 2, resetInSec: 86400 },
					monthly: { usedPercent: 3, resetInSec: 604800 }
				}
			};
		}
	});
	assert.equal(result.status, "ok");
	assert.equal(result.windows.length, 3);
	assert.equal(result.windows[2].remainingPercent, 97);
});

test("fetchQuota maps HTTP 401 to unauthorized", async () => {
	const result = await fetchQuota("sk-bad", "https://opencode.ai/zen/go", {
		request: async () => {
			const error = new Error("upstream returned HTTP 401");
			error.httpStatus = 401;
			throw error;
		}
	});
	assert.equal(result.status, "unauthorized");
	assert.equal(result.windows.length, 0);
});