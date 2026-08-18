/**
 * dsh-opencodego-multikey — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step): a sidebar footer
 * action that opens a floating dashboard for the OpenCode Go multi-key
 * gateway — add / remove / toggle API keys, live quota windows per key,
 * per-key token usage and the aggregate totals. Everything is served from
 * the loopback-only management API on the same origin, so the browser never
 * touches the proxy port directly.
 */
window.__ModuleLoader__.load({
	id: "dsh-opencodego-multikey",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region css
		const css = [
			".ogk_layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}",
			".ogk_footerButtons{align-items:center;width:100%;display:flex}",
			".ogk_badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}",
			".ogk_badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".ogk_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".ogk_badgeCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}",
			".ogk_panel{z-index:30;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));width:480px;max-width:calc(100vw - 24px);max-height:76vh;box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--ogk-accent:#00a67d;border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:128px;left:12px;overflow:hidden}",
			".ogk_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}",
			".ogk_headerLeft{align-items:center;gap:8px;display:flex}",
			".ogk_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			".ogk_headerActions{align-items:center;gap:2px;display:flex}",
			".ogk_iconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}",
			".ogk_iconButton:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".ogk_body{flex:1;min-height:0;padding:4px 14px 14px;overflow-y:auto}",
			".ogk_section{margin-top:12px}",
			".ogk_sectionTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0 0 6px}",
			".ogk_note{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:12px;line-height:18px}",
			".ogk_error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin:4px 0;padding:7px 8px;font-size:12px;line-height:18px;display:flex}",
			".ogk_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0}",
			".ogk_statsRow{display:flex;gap:8px}",
			".ogk_stat{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex:1;flex-direction:column;gap:1px;padding:8px 10px;display:flex}",
			".ogk_statValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".ogk_statLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			".ogk_meta{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}",
			".ogk_keyList{flex-direction:column;gap:8px;display:flex}",
			".ogk_keyCard{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,color-mix(in srgb,var(--ogk-accent) 7%,transparent),transparent 42%);border-radius:12px;padding:10px 11px;display:flex;flex-direction:column;gap:8px}",
			".ogk_keyHead{align-items:center;gap:8px;display:flex}",
			".ogk_keyMark{width:24px;height:24px;color:#fff;background:var(--ogk-accent);border-radius:7px;justify-content:center;align-items:center;font-size:10px;font-weight:700;display:flex;flex:none}",
			".ogk_keyIdentity{min-width:0;flex:1;display:flex;flex-direction:column}",
			".ogk_keyName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px}",
			".ogk_keyMask{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace}",
			".ogk_keyStatus{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-fill-l2);border-radius:999px;padding:2px 7px;font-size:10px;line-height:16px;white-space:nowrap}",
			".ogk_keyStatus[data-status=ok]{color:var(--ogk-accent);background:color-mix(in srgb,var(--ogk-accent) 12%,transparent)}",
			".ogk_keyStatus[data-status=quarantined]{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}",
			".ogk_keyStatus[data-status=disabled]{color:var(--dsw-alias-label-tertiary)}",
			".ogk_keyActions{align-items:center;gap:4px;display:flex;flex-wrap:wrap}",
			".ogk_btn{cursor:pointer;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 8px;font:inherit;font-size:11px;line-height:18px}",
			".ogk_btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".ogk_btnDanger{color:var(--dsw-alias-state-error-primary)}",
			".ogk_quotaList{flex-direction:column;gap:6px;display:flex}",
			".ogk_quotaRow{display:flex;flex-direction:column;gap:3px}",
			".ogk_quotaMeta{align-items:baseline;gap:8px;display:flex}",
			".ogk_quotaLabel{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}",
			".ogk_quotaValue{color:var(--dsw-alias-label-primary);margin-left:auto;font-size:12px;font-weight:600;line-height:16px;font-variant-numeric:tabular-nums}",
			".ogk_quotaReset{color:var(--dsw-alias-label-caption);font-size:9px;line-height:14px;white-space:nowrap}",
			".ogk_quotaTrack{height:6px;background:var(--dsw-alias-fill-l2);border-radius:999px;overflow:hidden}",
			".ogk_quotaFill{height:100%;background:var(--ogk-accent);border-radius:inherit;min-width:2px;transition:width .2s ease}",
			".ogk_quotaFill[data-window=weekly]{background:#e0a21f}",
			".ogk_quotaFill[data-window=monthly]{background:#7656e8}",
			".ogk_quotaEmpty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px}",
			".ogk_tokensRow{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;gap:4px 10px}",
			".ogk_resetRow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}",
			".ogk_addForm{flex-direction:column;gap:6px;display:flex}",
			".ogk_addRow{display:flex;gap:6px}",
			".ogk_input{box-sizing:border-box;min-width:0;flex:1;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;line-height:18px}",
			".ogk_addBtn{cursor:pointer;color:#fff;background:var(--ogk-accent);border:none;border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px;flex:none}",
			".ogk_addBtn:disabled{opacity:.5;cursor:default}",
			".ogk_footerNote{color:var(--dsw-alias-label-caption);margin-top:10px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}"
		].join("");
		const tagId = "dsh-opencodego-multikey/OpenCodeGoMultiKey.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-opencodego-multikey";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const S = {
			layer: "ogk_layer", footerButtons: "ogk_footerButtons", badge: "ogk_badge", badgeLabel: "ogk_badgeLabel", badgeCount: "ogk_badgeCount",
			panel: "ogk_panel", header: "ogk_header", headerLeft: "ogk_headerLeft", title: "ogk_title", headerActions: "ogk_headerActions", iconButton: "ogk_iconButton",
			body: "ogk_body", section: "ogk_section", sectionTitle: "ogk_sectionTitle", note: "ogk_note", error: "ogk_error", retry: "ogk_retry",
			statsRow: "ogk_statsRow", stat: "ogk_stat", statValue: "ogk_statValue", statLabel: "ogk_statLabel", meta: "ogk_meta",
			keyList: "ogk_keyList", keyCard: "ogk_keyCard", keyHead: "ogk_keyHead", keyMark: "ogk_keyMark", keyIdentity: "ogk_keyIdentity",
			keyName: "ogk_keyName", keyMask: "ogk_keyMask", keyStatus: "ogk_keyStatus", keyActions: "ogk_keyActions",
			btn: "ogk_btn", btnDanger: "ogk_btnDanger",
			quotaList: "ogk_quotaList", quotaRow: "ogk_quotaRow", quotaMeta: "ogk_quotaMeta", quotaLabel: "ogk_quotaLabel",
			quotaValue: "ogk_quotaValue", quotaReset: "ogk_quotaReset", quotaTrack: "ogk_quotaTrack", quotaFill: "ogk_quotaFill", quotaEmpty: "ogk_quotaEmpty",
			tokensRow: "ogk_tokensRow", resetRow: "ogk_resetRow",
			addForm: "ogk_addForm", addRow: "ogk_addRow", input: "ogk_input", addBtn: "ogk_addBtn", footerNote: "ogk_footerNote"
		};
		//#endregion

		//#region helpers
		function fmt(n) {
			return String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		function fmtCompact(n) {
			const value = n ?? 0;
			if (value < 1000) return String(value);
			if (value < 1000000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
			return `${(value / 1000000).toFixed(1)}m`;
		}
		function fmtUsd(value) {
			const n = Number(value ?? 0);
			if (!Number.isFinite(n) || n <= 0) return "$0";
			return `$${n < 0.001 ? n.toFixed(6) : n.toFixed(3)}`;
		}
		function interpolate(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(params, key) ? String(params[key]) : match));
		}
		async function fetchJson(path, init) {
			const response = await fetch(path, {
				headers: { accept: "application/json" },
				...init
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload === null || payload.ok !== true) {
				throw new Error(payload?.error ?? `HTTP ${response.status}`);
			}
			return payload;
		}
		//#endregion

		//#region panel
		function OpenCodeGoMultiKeyPanel({ t }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			const [open, setOpen] = react.useState(false);
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [keyInput, setKeyInput] = react.useState("");
			const [labelInput, setLabelInput] = react.useState("");
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			const mountedRef = react.useRef(true);

			const load = react.useCallback(async () => {
				try {
					const payload = await fetchJson("/api/opencodego-multikey/overview");
					setData(payload);
					setError(null);
					setRefreshedAt(Date.now());
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}, []);

			react.useEffect(() => {
				mountedRef.current = true;
				return () => { mountedRef.current = false; };
			}, []);

			react.useEffect(() => {
				if (!open) return;
				void load();
				const timer = window.setInterval(load, 30000);
				return () => window.clearInterval(timer);
			}, [open, load]);

			const act = async (action, body) => {
				setBusy(true);
				try {
					await fetchJson(`/api/opencodego-multikey/${action}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body ?? {})
					});
					await load();
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			};

			const addKey = () => {
				const key = keyInput.trim();
				if (key === "") return;
				void act("keys", { key, label: labelInput.trim() }).then(() => {
					setKeyInput("");
					setLabelInput("");
				});
			};

			const removeKey = (id, label) => {
				if (typeof window.confirm === "function" && !window.confirm(`${translate("action.deleteConfirm")} ${label}?`)) return;
				setBusy(true);
				fetchJson(`/api/opencodego-multikey/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" })
					.then(load)
					.catch((err) => setError(err instanceof Error ? err.message : String(err)))
					.finally(() => setBusy(false));
			};

			const forceRefresh = () => void act("refresh");

			const aggregate = data?.usage?.aggregate ?? null;
			const keys = Array.isArray(data?.keys) ? data.keys : [];

			return react_jsx_runtime.jsxs("div", {
				className: S.layer,
				children: [
					open && react_dom.createPortal(react_jsx_runtime.jsxs("section", {
						className: S.panel,
						"data-opencodego-multikey-panel": true,
						"aria-label": translate("panel.title"),
						children: [
							react_jsx_runtime.jsxs("header", {
								className: S.header,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.headerLeft,
										children: [
											react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 16 }),
											react_jsx_runtime.jsx("span", { className: S.title, children: translate("panel.title") })
										]
									}),
									react_jsx_runtime.jsxs("div", {
										className: S.headerActions,
										children: [
											react_jsx_runtime.jsx(primitives.Tooltip, {
												label: translate("action.refresh"),
												side: "bottom",
												delayMs: 500,
												children: react_jsx_runtime.jsx("button", {
													type: "button", className: S.iconButton, "aria-label": translate("action.refresh"),
													onClick: forceRefresh, disabled: busy,
													children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 14 })
												})
											}),
											react_jsx_runtime.jsx(primitives.Tooltip, {
												label: translate("action.close"),
												side: "bottom",
												delayMs: 500,
												children: react_jsx_runtime.jsx("button", {
													type: "button", className: S.iconButton, "aria-label": translate("action.close"),
													onClick: () => setOpen(false),
													children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
												})
											})
										]
									})
								]
							}),
							react_jsx_runtime.jsx("div", {
								className: S.body,
								children: [
									error !== null ? react_jsx_runtime.jsxs("div", {
										className: S.error,
										children: [
											react_jsx_runtime.jsx("span", { children: translate("error", { message: error }) }),
											react_jsx_runtime.jsx("button", { type: "button", className: S.retry, onClick: load, children: translate("action.retry") })
										]
									}) : null,
									aggregate !== null && react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
										children: [
											react_jsx_runtime.jsx("section", {
												className: S.section,
												children: react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("aggregate.title") })
											}),
											react_jsx_runtime.jsxs("div", {
												className: S.statsRow,
												children: [
													react_jsx_runtime.jsx(Stat, { value: fmt(aggregate.today?.tokens ?? 0), label: translate("aggregate.today") }),
													react_jsx_runtime.jsx(Stat, { value: fmt(aggregate.month?.tokens ?? 0), label: translate("aggregate.month") }),
													react_jsx_runtime.jsx(Stat, { value: fmt(aggregate.totalTokens ?? 0), label: translate("aggregate.total") })
												]
											}),
											react_jsx_runtime.jsx("p", {
												className: S.meta,
												children: `${translate("aggregate.requests")} ${fmt(aggregate.requests ?? 0)} · ${translate("aggregate.estimate")} ${fmtUsd(aggregate.estimatedCost)} · ${translate("aggregate.errors")} ${fmt(aggregate.errors ?? 0)}`
											})
										]
									}),
									react_jsx_runtime.jsx("section", {
										className: S.section,
										children: react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("keys.title") })
									}),
									keys.length === 0 ? react_jsx_runtime.jsx("p", { className: S.quotaEmpty, children: translate("keys.empty") }) : react_jsx_runtime.jsx("div", {
										className: S.keyList,
										children: keys.map((key) => react_jsx_runtime.jsx(KeyCard, {
											key: key.id,
											entry: key,
											usage: usageOf(data, key.id),
											translate,
											busy,
											onToggle: (enabled) => act("keys/toggle", { id: key.id, enabled }),
											onClear: () => act("keys/clear-quarantine", { id: key.id }),
											onRemove: () => removeKey(key.id, key.label)
										}))
									}),
									react_jsx_runtime.jsx("section", {
										className: S.section,
										children: react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("add.title") })
									}),
									react_jsx_runtime.jsxs("div", {
										className: S.addForm,
										children: [
											react_jsx_runtime.jsx("input", {
												type: "password", className: S.input, value: keyInput,
												placeholder: translate("add.keyPlaceholder"),
												onChange: (event) => setKeyInput(event.target.value),
												onKeyDown: (event) => { if (event.key === "Enter") addKey(); }
											}),
											react_jsx_runtime.jsxs("div", {
												className: S.addRow,
												children: [
													react_jsx_runtime.jsx("input", {
														type: "text", className: S.input, value: labelInput,
														placeholder: translate("add.labelPlaceholder"),
														onChange: (event) => setLabelInput(event.target.value),
														onKeyDown: (event) => { if (event.key === "Enter") addKey(); }
													}),
													react_jsx_runtime.jsx("button", {
														type: "button", className: S.addBtn, onClick: addKey, disabled: busy || keyInput.trim() === "",
														children: translate("add.submit")
													})
												]
											})
										]
									}),
									refreshedAt !== null && react_jsx_runtime.jsx("p", {
										className: S.footerNote,
										children: `${translate("panel.updatedAt")} ${new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
									})
								]
							})
						]
					}), document.body),
					react_jsx_runtime.jsx("div", {
						className: S.footerButtons,
						children: react_jsx_runtime.jsxs("button", {
							type: "button", className: S.badge, "data-opencodego-multikey-badge": true,
							"aria-label": translate("panel.badge"), "aria-expanded": open,
							onClick: () => setOpen((value) => !value),
							children: [
								react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 18 }),
								react_jsx_runtime.jsx("span", { className: S.badgeLabel, children: translate("panel.badge") }),
								aggregate !== null && react_jsx_runtime.jsx("span", { className: S.badgeCount, children: `${fmtCompact(aggregate.today?.tokens ?? 0)}t` })
							]
						})
					})
				]
			});
		}

		function usageOf(data, keyId) {
			return (Array.isArray(data?.usage?.keyStats) ? data.usage.keyStats : []).find((entry) => entry.keyId === keyId) ?? null;
		}

		function Stat({ value, label }) {
			return react_jsx_runtime.jsxs("div", {
				className: S.stat,
				children: [
					react_jsx_runtime.jsx("span", { className: S.statValue, children: value }),
					react_jsx_runtime.jsx("span", { className: S.statLabel, children: label })
				]
			});
		}

		function statusLabel(entry, translate) {
			if (!entry.enabled) return translate("status.disabled");
			if (entry.quarantined) return translate("status.quarantined");
			return translate("status.ok");
		}

		function KeyCard({ entry, usage, translate, busy, onToggle, onClear, onRemove }) {
			const windows = Array.isArray(entry.quota?.windows) ? entry.quota.windows : [];
			const remainingScore = typeof entry.remainingScore === "number" ? entry.remainingScore : null;
			return react_jsx_runtime.jsxs("article", {
				className: S.keyCard,
				"data-key": entry.id,
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.keyHead,
						children: [
							react_jsx_runtime.jsx("span", { className: S.keyMark, "aria-hidden": true, children: entry.label.slice(0, 2).toUpperCase() }),
							react_jsx_runtime.jsxs("span", {
								className: S.keyIdentity,
								children: [
									react_jsx_runtime.jsx("span", { className: S.keyName, children: entry.label }),
									react_jsx_runtime.jsx("span", { className: S.keyMask, children: entry.maskedKey })
								]
							}),
							react_jsx_runtime.jsx("span", {
								className: S.keyStatus,
								"data-status": !entry.enabled ? "disabled" : entry.quarantined ? "quarantined" : "ok",
								children: statusLabel(entry, translate)
							})
						]
					}),
					windows.length === 0 ? react_jsx_runtime.jsx("p", { className: S.quotaEmpty, children: remainingScore === null ? translate("quota.unknown") : translate("quota.exhausted") }) : react_jsx_runtime.jsx("div", {
						className: S.quotaList,
						children: windows.map((window) => {
							const used = Math.max(0, Math.min(100, Number(window.usedPercent) || 0));
							return react_jsx_runtime.jsxs("div", {
								className: S.quotaRow,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.quotaMeta,
										children: [
											react_jsx_runtime.jsx("span", { className: S.quotaLabel, children: windowLabel(window.kind, translate) }),
											react_jsx_runtime.jsx("span", { className: S.quotaReset, children: resetLabel(window.resetsAt, translate) }),
											react_jsx_runtime.jsx("span", { className: S.quotaValue, children: translate("quota.used", { value: used.toFixed(used % 1 === 0 ? 0 : 1) }) })
										]
									}),
									react_jsx_runtime.jsx("div", {
										className: S.quotaTrack,
										role: "progressbar",
										"aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Number(used.toFixed(1)),
										children: react_jsx_runtime.jsx("div", { className: S.quotaFill, "data-window": window.kind, style: { width: `${used}%` } })
									})
								]
							}, window.kind);
						})
					}),
					usage !== null && react_jsx_runtime.jsx("div", {
						className: S.tokensRow,
						children: [
							react_jsx_runtime.jsx("span", { children: `${translate("usage.requests")} ${fmt(usage.requests)}` }),
							react_jsx_runtime.jsx("span", { children: `${translate("usage.tokens")} ${fmt(usage.totalTokens)}` }),
							react_jsx_runtime.jsx("span", { children: `${translate("usage.input")} ${fmt(usage.inputTokens)}` }),
							react_jsx_runtime.jsx("span", { children: `${translate("usage.output")} ${fmt(usage.outputTokens)}` }),
							react_jsx_runtime.jsx("span", { children: `≈${fmtUsd(usage.estimatedCost)}` }),
							react_jsx_runtime.jsx("span", { children: `${translate("usage.picked")} ${fmt(usage.picked)}` })
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: S.keyActions,
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button", className: S.btn, disabled: busy,
								onClick: () => onToggle(!entry.enabled),
								children: entry.enabled ? translate("action.disable") : translate("action.enable")
							}),
							entry.quarantined && react_jsx_runtime.jsx("button", {
								type: "button", className: S.btn, disabled: busy,
								onClick: onClear,
								children: translate("action.unquarantine")
							}),
							react_jsx_runtime.jsx("button", {
								type: "button", className: `${S.btn} ${S.btnDanger}`, disabled: busy,
								onClick: onRemove,
								children: translate("action.delete")
							})
						]
					})
				]
			});
		}

		function windowLabel(kind, translate) {
			if (kind === "rolling") return translate("window.rolling");
			if (kind === "weekly") return translate("window.weekly");
			if (kind === "monthly") return translate("window.monthly");
			return kind;
		}

		function resetLabel(resetsAt, translate) {
			if (typeof resetsAt !== "string") return "";
			const date = new Date(resetsAt);
			if (Number.isNaN(date.getTime())) return "";
			return translate("quota.resets", { time: date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
		}
		//#endregion

		//#region locales
		const NS = "opencodegoMultiKey";
		const zh = {
			"panel.title": "OpenCodeGo 多Key",
			"panel.badge": "Go 多Key",
			"panel.updatedAt": "更新于",
			"error": "加载失败：{message}",
			"action.refresh": "刷新用量",
			"action.retry": "重试",
			"action.close": "关闭",
			"action.delete": "删除",
			"action.deleteConfirm": "确定删除",
			"action.enable": "启用",
			"action.disable": "停用",
			"action.unquarantine": "解除隔离",
			"aggregate.title": "汇总用量",
			"aggregate.today": "今日",
			"aggregate.month": "本月",
			"aggregate.total": "累计",
			"aggregate.requests": "请求",
			"aggregate.estimate": "估算费用",
			"aggregate.errors": "失败",
			"keys.title": "API Key 池",
			"keys.empty": "还没有配置 API Key，请在下方添加。",
			"add.title": "添加 API Key",
			"add.keyPlaceholder": "粘贴 OpenCode Go API Key（sk-…）",
			"add.labelPlaceholder": "备注名（可选）",
			"add.submit": "添加",
			"status.ok": "可用",
			"status.quarantined": "已隔离",
			"status.disabled": "已停用",
			"quota.unknown": "额度未知（等待刷新）",
			"quota.exhausted": "额度已用尽",
			"quota.used": "已用 {value}%",
			"quota.resets": "{time} 重置",
			"window.rolling": "滚动窗口",
			"window.weekly": "每周窗口",
			"window.monthly": "每月窗口",
			"usage.requests": "请求",
			"usage.tokens": "Tokens",
			"usage.input": "输入",
			"usage.output": "输出",
			"usage.picked": "选中",
		};
		const en = {
			"panel.title": "OpenCodeGo Multi-Key",
			"panel.badge": "Go Keys",
			"panel.updatedAt": "Updated",
			"error": "Load failed: {message}",
			"action.refresh": "Refresh usage",
			"action.retry": "Retry",
			"action.close": "Close",
			"action.delete": "Delete",
			"action.deleteConfirm": "Delete key",
			"action.enable": "Enable",
			"action.disable": "Disable",
			"action.unquarantine": "Unquarantine",
			"aggregate.title": "Aggregate usage",
			"aggregate.today": "Today",
			"aggregate.month": "Month",
			"aggregate.total": "All time",
			"aggregate.requests": "requests",
			"aggregate.estimate": "est. cost",
			"aggregate.errors": "errors",
			"keys.title": "API key pool",
			"keys.empty": "No API keys yet — add one below.",
			"add.title": "Add API key",
			"add.keyPlaceholder": "Paste an OpenCode Go API key (sk-…)",
			"add.labelPlaceholder": "Label (optional)",
			"add.submit": "Add",
			"status.ok": "Active",
			"status.quarantined": "Quarantined",
			"status.disabled": "Disabled",
			"quota.unknown": "Quota unknown (waiting for refresh)",
			"quota.exhausted": "Quota exhausted",
			"quota.used": "{value}% used",
			"quota.resets": "Resets {time}",
			"window.rolling": "Rolling",
			"window.weekly": "Weekly",
			"window.monthly": "Monthly",
			"usage.requests": "req",
			"usage.tokens": "tokens",
			"usage.input": "in",
			"usage.output": "out",
			"usage.picked": "picked",
		};
		//#endregion

		//#region plugin body
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "opencodego-multikey: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "opencodego-multikey",
				locale: NS,
				order: 20
			}, OpenCodeGoMultiKeyPanel));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.OpenCodeGoMultiKeyPanel = OpenCodeGoMultiKeyPanel;
		exports.KeyCard = KeyCard;
		exports.fmt = fmt;
		exports.fmtUsd = fmtUsd;
		return module.exports;
	}
});