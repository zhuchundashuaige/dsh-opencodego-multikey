import test from "node:test";
import assert from "node:assert/strict";
import { buildMultikeyProvider } from "../lib/index.js";

test("buildMultikeyProvider pins baseURL and appends (Multikey) variants", () => {
	const provider = {
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		models: [
			{ id: "minimax-m3", name: "MiniMax-M3", contextWindow: 1000000, maxTokens: 131072 },
			{ id: "qwen3.7-max", name: "Qwen3.7 Max", contextWindow: 1000000, maxTokens: 65536 }
		]
	};
	const next = buildMultikeyProvider(provider, {
		proxyBaseURL: "http://127.0.0.1:19781"
	});
	assert.equal(next.baseURL, "http://127.0.0.1:19781");
	assert.equal(next.models.length, 4);
	const variants = next.models.filter((m) => m.id.endsWith(" (Multikey)"));
	assert.equal(variants.length, 2);
	assert.equal(variants[0].id, "minimax-m3 (Multikey)");
	assert.equal(variants[0].name, "MiniMax-M3 (Multikey)");
	assert.equal(variants[1].id, "qwen3.7-max (Multikey)");
	// Original models untouched.
	assert.equal(next.models[0].id, "minimax-m3");
	assert.equal(next.models[0].baseURL, undefined); // baseURL only on provider
});

test("buildMultikeyProvider keeps an already-injected route unchanged", () => {
	const provider = {
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		baseURL: "http://127.0.0.1:19781",
		models: [
			{ id: "minimax-m3" },
			{ id: "minimax-m3 (Multikey)" } // already present
		]
	};
	const next = buildMultikeyProvider(provider, { proxyBaseURL: "http://127.0.0.1:19781" });
	assert.equal(next.models.length, 2, "no duplicate variant added");
	assert.equal(JSON.stringify(next), JSON.stringify(provider), "unchanged when already injected");
});

test("buildMultikeyProvider tolerates non-object / missing provider", () => {
	assert.equal(buildMultikeyProvider(null, {}), null);
	assert.equal(buildMultikeyProvider(undefined, {}), undefined);
});

test("buildMultikeyProvider passes through custom suffix", () => {
	const next = buildMultikeyProvider(
		{ models: [{ id: "glm-5.2", name: "GLM5.2" }] },
		{ proxyBaseURL: "http://x", multikeySuffix: " (Pool)" }
	);
	assert.equal(next.models[1].id, "glm-5.2 (Pool)");
});