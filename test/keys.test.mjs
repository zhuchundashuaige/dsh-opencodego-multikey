import test from "node:test";
import assert from "node:assert/strict";
import { KeyPool, keyIdOf, maskKey, UNKNOWN_SCORE } from "../lib/keys.js";

function poolWith(keys, options = {}) {
	const pool = new KeyPool(options);
	for (const [key, label, enabled] of keys) {
		pool.add(key, { label, enabled });
	}
	return pool;
}

test("keyIdOf is stable and never equals the raw key", () => {
	assert.equal(keyIdOf("sk-a"), keyIdOf("sk-a"));
	assert.notEqual(keyIdOf("sk-a"), keyIdOf("sk-b"));
	assert.ok(!keyIdOf("sk-a").includes("sk-"));
});

test("maskKey hides everything but the prefix and suffix", () => {
	assert.equal(maskKey("sk-abc123"), "sk-••••c123");
	assert.equal(maskKey("short"), "••••••••");
});

test("adding the same key twice is a no-op", () => {
	const pool = new KeyPool();
	const first = pool.add("sk-aaa", { label: "A" });
	const second = pool.add("sk-aaa", { label: "B" });
	assert.equal(first.created, true);
	assert.equal(second.created, false);
	assert.equal(first.entry.id, second.entry.id);
	assert.equal(pool.list().length, 1);
});

test("empty keys are rejected", () => {
	const pool = new KeyPool();
	assert.throws(() => pool.add("   "));
});

test("select picks the key with the highest remaining quota", () => {
	const pool = poolWith([
		["sk-low", "Low"],
		["sk-mid", "Mid"],
		["sk-high", "High"]
	]);
	pool.setQuota(pool.get(keyIdOf("sk-low")).id, { windows: [{ kind: "monthly", remainingPercent: 10 }], status: "ok" });
	pool.setQuota(pool.get(keyIdOf("sk-mid")).id, { windows: [{ kind: "monthly", remainingPercent: 50 }], status: "ok" });
	pool.setQuota(pool.get(keyIdOf("sk-high")).id, { windows: [{ kind: "monthly", remainingPercent: 90 }], status: "ok" });
	for (let i = 0; i < 5; i += 1) {
		assert.equal(pool.select().id, keyIdOf("sk-high"));
	}
});

test("select skips quarantined keys", () => {
	const pool = poolWith([
		["sk-a", "A"],
		["sk-b", "B"]
	]);
	pool.setQuota(pool.get(keyIdOf("sk-a")).id, { windows: [{ kind: "monthly", remainingPercent: 99 }], status: "ok" });
	pool.setQuota(pool.get(keyIdOf("sk-b")).id, { windows: [{ kind: "monthly", remainingPercent: 5 }], status: "ok" });
	pool.quarantine(keyIdOf("sk-a"), "test", 60000);
	assert.equal(pool.select().id, keyIdOf("sk-b"));
});

test("select skips exhausted keys (quota at or below threshold)", () => {
	const pool = poolWith([
		["sk-empty", "Empty"],
		["sk-full", "Full"]
	], { exhaustThresholdPct: 2 });
	pool.setQuota(pool.get(keyIdOf("sk-empty")).id, { windows: [{ kind: "monthly", remainingPercent: 1 }], status: "ok" });
	pool.setQuota(pool.get(keyIdOf("sk-full")).id, { windows: [{ kind: "monthly", remainingPercent: 80 }], status: "ok" });
	const picks = new Set();
	for (let i = 0; i < 4; i += 1) picks.add(pool.select().id);
	assert.deepEqual([...picks], [keyIdOf("sk-full")]);
});

test("select round-robins among equal-score keys", () => {
	const pool = poolWith([
		["sk-a", "A"],
		["sk-b", "B"],
		["sk-c", "C"]
	]);
	for (const entry of pool.list()) {
		pool.setQuota(entry.id, { windows: [{ kind: "monthly", remainingPercent: 50 }], status: "ok" });
	}
	const seen = [];
	for (let i = 0; i < 6; i += 1) seen.push(pool.select().id);
	// Three keys, six picks → every key picked exactly twice.
	const counts = {};
	for (const id of seen) counts[id] = (counts[id] ?? 0) + 1;
	assert.deepEqual(counts, { [keyIdOf("sk-a")]: 2, [keyIdOf("sk-b")]: 2, [keyIdOf("sk-c")]: 2 });
});

test("keys with unknown quota stay eligible with a neutral score", () => {
	const pool = poolWith([
		["sk-known", "Known"],
		["sk-unknown", "Unknown"]
	]);
	pool.setQuota(pool.get(keyIdOf("sk-known")).id, { windows: [{ kind: "monthly", remainingPercent: 5 }], status: "ok" }, 0);
	const picked = pool.select();
	assert.ok(picked.id === keyIdOf("sk-known") || picked.id === keyIdOf("sk-unknown"));
	assert.equal(pool.get(keyIdOf("sk-unknown")).quota.score, null);
});

test("disabled keys are never selected", () => {
	const pool = poolWith([
		["sk-on", "On"],
		["sk-off", "Off"]
	]);
	pool.setEnabled(pool.get(keyIdOf("sk-off")).id, false);
	pool.setQuota(pool.get(keyIdOf("sk-on")).id, { windows: [{ kind: "monthly", remainingPercent: 10 }], status: "ok" });
	pool.setQuota(pool.get(keyIdOf("sk-off")).id, { windows: [{ kind: "monthly", remainingPercent: 99 }], status: "ok" });
	assert.equal(pool.select().id, keyIdOf("sk-on"));
});

test("setQuota quarantines on unauthorized", () => {
	const pool = poolWith([["sk-a", "A"]], { now: () => 1000 });
	const id = pool.get(keyIdOf("sk-a")).id;
	pool.setQuota(id, { windows: [], status: "unauthorized" }, 1000);
	assert.ok(pool.get(id).quarantineUntil > 1000);
	assert.equal(pool.select(), null);
});

test("quotaError keeps known windows on transient failure", () => {
	const pool = poolWith([["sk-a", "A"]]);
	const id = pool.get(keyIdOf("sk-a")).id;
	pool.setQuota(id, { windows: [{ kind: "monthly", remainingPercent: 70 }], status: "ok" });
	pool.quotaError(id, "unavailable", "network flaky");
	assert.equal(pool.get(id).quota.windows[0].remainingPercent, 70);
	assert.equal(pool.get(id).quota.status, "unavailable");
});

test("serialize/restore round-trips keys including quarantine state", () => {
	const pool = poolWith([
		["sk-a", "A"],
		["sk-b", "B"]
	]);
	pool.quarantine(pool.get(keyIdOf("sk-b")).id, "boom", 5000);
	const restored = new KeyPool();
	restored.restore(pool.serialize());
	assert.equal(restored.list().length, 2);
	assert.equal(restored.get(keyIdOf("sk-b")).quarantineReason, "boom");
	assert.equal(restored.get(keyIdOf("sk-b")).quarantineUntil > 0, true);
});

test("select returns null for an empty pool", () => {
	const pool = new KeyPool();
	assert.equal(pool.select(), null);
});

test("UNKNOWN_SCORE is exported for tie handling", () => {
	assert.equal(UNKNOWN_SCORE, 50);
});