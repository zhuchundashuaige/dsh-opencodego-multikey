/**
 * dsh-opencodego-multikey — API key pool.
 *
 * Owns the set of OpenCode Go API keys the proxy may use, plus the current
 * quota snapshot per key (refreshed in the background) and the selection
 * logic that picks the best key for the next request:
 *
 *   1. Only enabled, non-quarantined keys are eligible.
 *   2. Keys whose remaining quota is at or below `exhaustThresholdPct` are
 *      skipped (they are treated as "exhausted" until the next refresh).
 *   3. Among the rest, the key with the highest remaining quota wins.
 *   4. Ties are broken round-robin by last-selected timestamp, so a pool of
 *      equal keys is consumed evenly instead of hot-spotting one.
 *
 * Keys are stored masked in every public view; the raw key exists only in
 * memory and in the plugin state file on disk.
 *
 * @module dsh-opencodego-multikey/keys
 */

import { createHash } from "node:crypto";
import { scoreOf as scoreWindows } from "./quota.js";

/** Default quarantine durations in milliseconds. */
export const QUARANTINE_AUTH_MS = 10 * 60 * 1000;   // 401/403: bad key, leave alone
export const QUARANTINE_RATE_MS = 60 * 1000;        // 429: back off briefly
export const QUARANTINE_NETWORK_MS = 30 * 1000;     // transient network failure

/** Neutral score used when a key has no usable quota data yet. */
export const UNKNOWN_SCORE = 50;

/** Derive a stable, non-secret id from a raw key. */
export function keyIdOf(apiKey) {
	return createHash("sha1").update(String(apiKey)).digest("hex").slice(0, 12);
}

/** Mask a raw key: `sk-••••abcd`. */
export function maskKey(apiKey) {
	const text = String(apiKey ?? "");
	if (text.length <= 8) return "••••••••";
	return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

/** Normalized quota snapshot attached to one key. */
export function emptyQuota() {
	return { windows: [], score: null, fetchedAt: null, status: "unknown" };
}

/**
 * The key pool. All mutation methods persist through the caller's
 * `onChanged` hook (the state store decides when to actually write disk).
 */
export class KeyPool {
	constructor(options = {}) {
		this.now = options.now ?? Date.now;
		this.exhaustThresholdPct = options.exhaustThresholdPct ?? 2;
		this.quarantineAuthMs = options.quarantineAuthMs ?? QUARANTINE_AUTH_MS;
		this.quarantineRateMs = options.quarantineRateMs ?? QUARANTINE_RATE_MS;
		this.quarantineNetworkMs = options.quarantineNetworkMs ?? QUARANTINE_NETWORK_MS;
		this.onChanged = options.onChanged ?? (() => {});
		/** @type {Map<string, import('./keys').KeyEntry>} */
		this.entries = new Map();
		this._lastPick = new Map();
		this._pickClock = 0;
	}

	get(id) {
		return this.entries.get(id) ?? null;
	}

	list() {
		return [...this.entries.values()];
	}

	/**
	 * Add a key. Re-adding the same raw key is a no-op returning the
	 * existing entry. Returns { entry, created }.
	 */
	add(apiKey, options = {}) {
		const raw = String(apiKey ?? "").trim();
		if (raw === "") throw new Error("api key must not be empty");
		const id = keyIdOf(raw);
		const existing = this.entries.get(id);
		if (existing !== void 0) {
			return { entry: existing, created: false };
		}
		const entry = {
			id,
			key: raw,
			label: String(options.label ?? "").trim() || `Key ${this.entries.size + 1}`,
			enabled: options.enabled !== false,
			addedAt: new Date(this.now()).toISOString(),
			quota: emptyQuota(),
			quarantineUntil: null,
			quarantineReason: null
		};
		this.entries.set(id, entry);
		this.onChanged();
		return { entry, created: true };
	}

	remove(id) {
		const existed = this.entries.delete(id);
		this._lastPick.delete(id);
		if (existed) this.onChanged();
		return existed;
	}

	/** Enable / disable a key (disabled keys are never selected). */
	setEnabled(id, enabled) {
		const entry = this.entries.get(id);
		if (entry === void 0) return false;
		entry.enabled = enabled === true;
		entry.quarantineUntil = null;
		entry.quarantineReason = null;
		this.onChanged();
		return true;
	}

	/** Clear a quarantine manually (dashboard action). */
	clearQuarantine(id) {
		const entry = this.entries.get(id);
		if (entry === void 0) return false;
		entry.quarantineUntil = null;
		entry.quarantineReason = null;
		this.onChanged();
		return true;
	}

	/** Attach a freshly fetched quota snapshot to a key. */
	setQuota(id, result, at = this.now()) {
		const entry = this.entries.get(id);
		if (entry === void 0) return;
		const windows = Array.isArray(result?.windows) ? result.windows : [];
		const score = windows.length === 0 ? null : scoreWindows(windows);
		entry.quota = {
			windows,
			score,
			fetchedAt: new Date(at).toISOString(),
			status: result?.status ?? "unknown"
		};
		// A key that the usage endpoint rejects is almost certainly also
		// rejected by the inference API — quarantine it proactively.
		if (result?.status === "unauthorized") {
			this.quarantine(id, "usage endpoint rejected the key (401/403)", this.quarantineAuthMs);
		} else if (result?.status === "rate-limited") {
			this.quarantine(id, "usage endpoint rate limited (429)", this.quarantineRateMs);
		}
	}

	/** Mark a key quarantined (set by the proxy on request failures). */
	quarantine(id, reason, durationMs = this.quarantineAuthMs) {
		const entry = this.entries.get(id);
		if (entry === void 0) return false;
		entry.quarantineUntil = this.now() + durationMs;
		entry.quarantineReason = String(reason ?? "temporary failure");
		this.onChanged();
		return true;
	}

	/** Mark a transient quota-check error without wiping known windows. */
	quotaError(id, status, error) {
		const entry = this.entries.get(id);
		if (entry === void 0) return;
		entry.quota = entry.quota ?? emptyQuota();
		entry.quota.status = status ?? "unavailable";
		entry.quota.lastError = typeof error === "string" ? error.slice(0, 200) : null;
		if (status === "unauthorized") {
			this.quarantine(id, "usage endpoint rejected the key (401/403)", this.quarantineAuthMs);
		} else if (status === "rate-limited") {
			this.quarantine(id, "usage endpoint rate limited (429)", this.quarantineRateMs);
		}
		this.onChanged();
	}

	/** Whether the key is currently usable (enabled and not quarantined). */
	isUsable(entry) {
		if (entry === void 0 || entry.enabled !== true) return false;
		if (entry.quarantineUntil !== null && entry.quarantineUntil > this.now()) return false;
		return true;
	}

	/** Whether the key is exhausted (quota below the threshold). */
	isExhausted(entry) {
		const score = entry?.quota?.score;
		if (typeof score !== "number") return false; // unknown quota → eligible
		return score <= this.exhaustThresholdPct;
	}

	/**
	 * Pick the best key for one request. Returns the entry (never the raw
	 * key by itself) or null when the pool has no usable key.
	 */
	select() {
		const eligible = this.list().filter((entry) => this.isUsable(entry) && !this.isExhausted(entry));
		if (eligible.length === 0) return null;
		this._pickClock += 1;
		const order = this._pickClock;
		if (eligible.length === 1) {
			this._lastPick.set(eligible[0].id, order);
			return eligible[0];
		}
		let best = eligible[0];
		let bestScore = scoreOf(eligible[0]);
		for (const entry of eligible.slice(1)) {
			const score = scoreOf(entry);
			if (score > bestScore) {
				best = entry;
				bestScore = score;
				continue;
			}
			// Equal score → prefer the key picked least recently.
			if (score === bestScore && (this._lastPick.get(entry.id) ?? 0) < (this._lastPick.get(best.id) ?? 0)) {
				best = entry;
			}
		}
		this._lastPick.set(best.id, order);
		return best;
	}

	/** Serialize to the on-disk state shape (raw keys included). */
	serialize() {
		return this.list().map((entry) => ({
			id: entry.id,
			label: entry.label,
			key: entry.key,
			enabled: entry.enabled,
			addedAt: entry.addedAt,
			quarantineUntil: entry.quarantineUntil,
			quarantineReason: entry.quarantineReason,
			lastPickOrder: this._lastPick.get(entry.id) ?? 0
		}));
	}

	/** Restore from a serialized state record (lenient). */
	restore(rows) {
		this.entries.clear();
		this._lastPick.clear();
		this._pickClock = 0;
		if (!Array.isArray(rows)) return;
		for (const row of rows) {
			if (row === null || typeof row !== "object" || typeof row.key !== "string" || row.key === "") continue;
			const entry = {
				id: typeof row.id === "string" && row.id !== "" ? row.id : keyIdOf(row.key),
				key: row.key,
				label: typeof row.label === "string" && row.label !== "" ? row.label : `Key ${this.entries.size + 1}`,
				enabled: row.enabled !== false,
				addedAt: typeof row.addedAt === "string" ? row.addedAt : new Date(this.now()).toISOString(),
				quota: emptyQuota(),
				quarantineUntil: typeof row.quarantineUntil === "number" ? row.quarantineUntil : null,
				quarantineReason: typeof row.quarantineReason === "string" ? row.quarantineReason : null
			};
			this.entries.set(entry.id, entry);
			if (typeof row.lastPickOrder === "number" && row.lastPickOrder > 0) {
				this._lastPick.set(entry.id, row.lastPickOrder);
				if (row.lastPickOrder > this._pickClock) this._pickClock = row.lastPickOrder;
			}
		}
	}
}

function scoreOf(entry) {
	const score = entry?.quota?.score;
	return typeof score === "number" ? score : UNKNOWN_SCORE;
}