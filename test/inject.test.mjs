import test from "node:test";
import assert from "node:assert/strict";
import {
	buildMultikeyProvider,
	buildMultikeyProviders,
	cleanMultikeyVariants
} from "../lib/index.js";

const SOURCE = {
	apiKeyEnv: "OPENCODE_GO_API_KEY",
	api: "openai-completions",
	models: [
		{ id: "minimax-m3", name: "MiniMax-M3", contextWindow: 1000000, maxTokens: 131072 },
		{ id: "qwen3.7-max", name: "Qwen3.7 Max", contextWindow: 1000000, maxTokens: 65536 }
	]
};

test("buildMultikeyProvider creates a NEW provider mirroring the source models", () => {
	const next = buildMultikeyProvider(SOURCE, {
		newProviderRoute: "opencode-go-multikey",
		newProviderDisplayName: "OpenCode Go Multikey",
		proxyBaseURL: "http://127.0.0.1:19781"
	});
	assert.equal(next.displayName, "OpenCode Go Multikey");
	assert.equal(next.baseURL, "http://127.0.0.1:19781");
	assert.equal(next.api, "openai-completions");
	assert.equal(next.apiKeyEnv, "OPENCODE_GO_API_KEY");
	// Models mirrored 1:1 with the same (real) ids — no suffix.
	assert.equal(next.models.length, 2);
	assert.equal(next.models[0].id, "minimax-m3");
	assert.equal(next.models[1].id, "qwen3.7-max");
	assert.equal(next.models[0].contextWindow, 1000000);
});

test("buildMultikeyProvider returns null when source has no usable models", () => {
	assert.equal(buildMultikeyProvider(null, {}), null);
	assert.equal(buildMultikeyProvider({ models: [] }, {}), null);
	assert.equal(buildMultikeyProvider({}, {}), null);
});

test("cleanMultikeyVariants removes legacy (Multikey) variants from a provider", () => {
	const provider = {
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		models: [
			{ id: "minimax-m3" },
			{ id: "minimax-m3 (Multikey)" },
			{ id: "qwen3.7-max" }
		]
	};
	const cleaned = cleanMultikeyVariants(provider, {});
	assert.deepEqual(
		cleaned.models.map((m) => m.id),
		["minimax-m3", "qwen3.7-max"]
	);
});

test("buildMultikeyProviders cleans the source and adds the new supplier", () => {
	const providers = {
		"opencode-go": {
			...SOURCE,
			baseURL: "http://127.0.0.1:19781", // legacy injected baseURL
			models: [...SOURCE.models, { id: "minimax-m3 (Multikey)" }]
		},
		"other": { apiKeyEnv: "X", models: [{ id: "m99" }] }
	};
	const result = buildMultikeyProviders(providers, {
		sourceRoute: "opencode-go",
		newProviderRoute: "opencode-go-multikey",
		newProviderDisplayName: "OpenCode Go Multikey",
		proxyBaseURL: "http://127.0.0.1:19781"
	});
	assert.equal(result.changed, true);
	// Source cleaned of (Multikey) variants; baseURL preserved as configured.
	assert.equal(result.providers["opencode-go"].models.length, 2);
	assert.equal(result.providers["opencode-go"].baseURL, "http://127.0.0.1:19781");
	// New supplier present with mirrored models.
	assert.equal(result.providers["opencode-go-multikey"].displayName, "OpenCode Go Multikey");
	assert.equal(result.providers["opencode-go-multikey"].models.length, 2);
	// Other providers untouched.
	assert.equal(result.providers["other"].models[0].id, "m99");
});

test("buildMultikeyProviders is idempotent (unchanged on second run)", () => {
	const providers = { "opencode-go": SOURCE };
	const first = buildMultikeyProviders(providers, {
		sourceRoute: "opencode-go",
		newProviderRoute: "opencode-go-multikey",
		newProviderDisplayName: "OpenCode Go Multikey",
		proxyBaseURL: "http://127.0.0.1:19781"
	});
	const second = buildMultikeyProviders(first.providers, {
		sourceRoute: "opencode-go",
		newProviderRoute: "opencode-go-multikey",
		newProviderDisplayName: "OpenCode Go Multikey",
		proxyBaseURL: "http://127.0.0.1:19781"
	});
	assert.equal(second.changed, false, "second run should be a no-op");
});

test("buildMultikeyProviders reports when the source route is absent", () => {
	const result = buildMultikeyProviders({}, { sourceRoute: "opencode-go" });
	assert.equal(result.changed, false);
	assert.ok(result.reason.includes("source provider"));
});