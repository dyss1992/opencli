//#region src/chrome-api.ts
/** Native browser management. Calls use Chrome IDs and do not acquire page leases. */
var CHROME_METHODS = {
	"tabs.query": "(queryInfo: object) => Tab[]",
	"tabs.get": "(tabId: number) => Tab",
	"tabs.create": "(createProperties: object) => Tab",
	"tabs.duplicate": "(tabId: number) => Tab",
	"tabs.update": "(tabId: number, updateProperties: object) => Tab",
	"tabs.move": "(tabIds: number | number[], moveProperties: object) => Tab | Tab[]",
	"tabs.remove": "(tabIds: number | number[]) => void",
	"tabs.group": "(options: {tabIds: number[], groupId?: number, createProperties?: {windowId?: number}}) => number",
	"tabs.ungroup": "(tabIds: number | number[]) => void",
	"tabGroups.query": "(queryInfo: object) => TabGroup[]",
	"tabGroups.get": "(groupId: number) => TabGroup",
	"tabGroups.update": "(groupId: number, updateProperties: {title?: string, color?: string, collapsed?: boolean}) => TabGroup",
	"tabGroups.move": "(groupId: number, moveProperties: {index: number, windowId?: number}) => TabGroup",
	"windows.get": "(windowId: number, queryOptions?: object) => Window",
	"windows.getAll": "(queryOptions?: object) => Window[]",
	"windows.create": "(createData: object) => Window",
	"windows.update": "(windowId: number, updateInfo: object) => Window",
	"windows.remove": "(windowId: number) => void"
};
var ChromeApiError = class extends Error {
	code;
	hint;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
var nativeError = (code, message) => new ChromeApiError(code, message);
var READ = /* @__PURE__ */ new Set([
	"tabs.query",
	"tabs.get",
	"tabGroups.query",
	"tabGroups.get",
	"windows.get",
	"windows.getAll"
]);
function resolve(method) {
	if (!Object.hasOwn(CHROME_METHODS, method)) throw nativeError("unsupported_chrome_method", `Unsupported Chrome method ${method}. Use chrome describe to list browser-management methods.`);
	const [namespace, name] = method.split(".");
	const receiver = chrome[namespace];
	return {
		receiver,
		fn: receiver?.[name],
		namespace,
		name
	};
}
async function describeChrome(method) {
	if (!method) return {
		methods: Object.keys(CHROME_METHODS),
		ids: "Use numeric Chrome IDs from tabs.query/tabGroups.query/windows.getAll, not page targetIds.",
		lifecycle: "Native-created tabs and windows are user-managed and persist after the CLI exits."
	};
	const { fn, namespace, name } = resolve(method);
	return {
		method,
		signature: CHROME_METHODS[method],
		available: typeof fn === "function",
		access: READ.has(method) ? "read" : "write",
		declaredPermissions: chrome.runtime.getManifest().permissions ?? [],
		grantedPermissions: await chrome.permissions.getAll(),
		documentation: `https://developer.chrome.com/docs/extensions/reference/api/${namespace}#method-${name}`,
		...namespace === "tabGroups" ? { colors: [
			"grey",
			"blue",
			"red",
			"yellow",
			"green",
			"pink",
			"purple",
			"cyan",
			"orange"
		] } : {}
	};
}
async function callChrome(method, args, protectedTabs, protectedGroups) {
	const { receiver, fn } = resolve(method);
	if (!Array.isArray(args)) throw nativeError("invalid_args", "Chrome args must be an array of positional arguments.");
	if (typeof fn !== "function") throw nativeError("chrome_api_unavailable", `chrome.${method} is unavailable.`);
	try {
		if (!READ.has(method)) {
			let tabs = [];
			const first = args[0];
			if (method.startsWith("tabGroups.") || ["windows.update", "windows.remove"].includes(method)) {
				if (!Number.isInteger(first)) throw nativeError("invalid_args", "Use an explicit numeric group or window ID.");
			}
			if (method.startsWith("tabGroups.")) {
				if (protectedGroups.has(first)) throw nativeError("managed_resource_conflict", "This group is managed by OpenCLI browser sessions. Use an ordinary Chrome group.");
				tabs = await chrome.tabs.query({ groupId: first });
			} else if (method === "tabs.group") {
				if (!Array.isArray(first?.tabIds) || !first.tabIds.length || first.tabIds.some((id) => !Number.isInteger(id))) throw nativeError("invalid_args", "tabs.group requires a non-empty tabIds array.");
				if (first.groupId !== void 0) {
					if (protectedGroups.has(first.groupId)) throw nativeError("managed_resource_conflict", "Cannot add tabs to an OpenCLI-managed group.");
					tabs.push(...await chrome.tabs.query({ groupId: first.groupId }));
				}
				tabs.push(...await Promise.all(first.tabIds.map((id) => chrome.tabs.get(id))));
			} else if ([
				"tabs.update",
				"tabs.move",
				"tabs.remove",
				"tabs.ungroup",
				"tabs.duplicate"
			].includes(method)) {
				const ids = Array.isArray(first) ? first : [first];
				if (!ids.length || ids.some((id) => !Number.isInteger(id))) throw nativeError("invalid_args", "Use explicit numeric tab IDs from tabs.query.");
				tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
			} else if (["windows.update", "windows.remove"].includes(method)) tabs = await chrome.tabs.query({ windowId: first });
			else if (method === "windows.create" && first?.tabId !== void 0) tabs = [await chrome.tabs.get(first.tabId)];
			if (tabs.some((t) => protectedTabs.has(t.id) || protectedGroups.has(t.groupId))) throw nativeError("managed_resource_conflict", "The operation touches an active OpenCLI session. Finish that session before reorganizing its tabs.");
		}
		return await Reflect.apply(fn, receiver, args) ?? null;
	} catch (error) {
		if (error instanceof ChromeApiError) throw error;
		throw nativeError("chrome_api_error", `chrome.${method}: ${error.message}`);
	}
}
//#endregion
//#region src/browser-readback.ts
var BrowserReadbackError = class extends Error {};
/** Read only identifiers and visibility; never attach, select, or expose page contents. */
async function readBrowserSnapshot(backgroundOwnedTabIds) {
	const windows = await chrome.windows.getAll({
		populate: true,
		windowTypes: ["normal"]
	});
	return {
		schema: "opencli-browser-snapshot-v1",
		extensionVersion: chrome.runtime.getManifest().version,
		windows: windows.map((window) => {
			if (window.id === void 0) throw new BrowserReadbackError("window identifier unavailable");
			if (window.tabs === void 0) throw new BrowserReadbackError("window tabs unavailable");
			return {
				id: window.id,
				focused: window.focused,
				tabs: window.tabs.map((tab) => {
					if (tab.id === void 0) throw new BrowserReadbackError("tab identifier unavailable");
					return {
						id: tab.id,
						index: tab.index,
						active: tab.active,
						backgroundOwned: backgroundOwnedTabIds.has(tab.id)
					};
				})
			};
		})
	};
}
//#endregion
//#region src/protocol.ts
/** Default daemon port */
var DAEMON_PORT = 19825;
var DAEMON_HOST = "localhost";
var DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
/** Lightweight health-check endpoint — probed before each WebSocket attempt. */
var DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
//#endregion
//#region src/cdp.ts
/**
* CDP execution via chrome.debugger API.
*
* chrome.debugger only needs the "debugger" permission — no host_permissions.
* It can attach to any http/https tab. Avoid chrome:// and chrome-extension://
* tabs (resolveTabId in background.ts filters them).
*/
var attached = /* @__PURE__ */ new Set();
var tabFrameContexts = /* @__PURE__ */ new Map();
var frameTargets = /* @__PURE__ */ new Map();
var frameTargetKeys = /* @__PURE__ */ new Map();
var frameTargetCleanupRegistered = false;
var CDP_RESPONSE_BODY_CAPTURE_LIMIT = 8388608;
var CDP_REQUEST_BODY_CAPTURE_LIMIT = 1048576;
var networkCaptures = /* @__PURE__ */ new Map();
/**
* Default deadline for a single chrome.debugger command. chrome.debugger has
* no timeout of its own: a page-blocking native dialog (alert/confirm/print/
* beforeunload) makes Runtime.evaluate hang forever, wedging every later
* command on the tab. Long enough for legitimate in-page waits (default 30s
* plus headroom), short enough to fail before the daemon's 120s timer.
*/
var CDP_COMMAND_TIMEOUT_MS = 6e4;
/** Health-check probe deadline — a blocked probe should fail fast. */
var CDP_PROBE_TIMEOUT_MS = 2e3;
/**
* chrome.debugger.sendCommand with a deadline. The underlying command cannot
* be cancelled — this only unblocks the caller so the CLI gets an error
* instead of an infinite hang.
*/
async function sendDebuggerCommand(target, method, params, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
	let timer;
	const commandPromise = params === void 0 ? chrome.debugger.sendCommand(target, method) : chrome.debugger.sendCommand(target, method, params);
	commandPromise.catch(() => {});
	try {
		return await Promise.race([commandPromise, new Promise((_, reject) => {
			timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`CDP command ${method} timed out after ${Math.round(timeoutMs / 1e3)}s — the page may be blocked by a native dialog (alert/confirm/print)`)), timeoutMs);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
function isDebuggableUrl$1(url) {
	if (!url) return true;
	return url.startsWith("http://") || url.startsWith("https://") || url === "about:blank" || url.startsWith("data:");
}
async function ensureAttached(tabId, aggressiveRetry = false) {
	let tab;
	try {
		tab = await chrome.tabs.get(tabId);
		if (!isDebuggableUrl$1(tab.url)) {
			attached.delete(tabId);
			throw new Error(`Cannot debug tab ${tabId}: URL is ${tab.url ?? "unknown"}`);
		}
	} catch (e) {
		if (e instanceof Error && e.message.startsWith("Cannot debug tab")) throw e;
		attached.delete(tabId);
		throw new Error(`Tab ${tabId} no longer exists`);
	}
	if (tab.autoDiscardable === true) await chrome.tabs.update(tabId, { autoDiscardable: false });
	if (tab.discarded || tab.status === "unloaded") {
		attached.delete(tabId);
		await chrome.tabs.reload(tabId);
		for (let attempt = 0; attempt < 50; attempt++) {
			const current = await chrome.tabs.get(tabId);
			if (!current.discarded && current.status !== "unloaded") break;
			if (attempt === 49) throw new Error(`Tab ${tabId} remained unloaded after reload`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	if (attached.has(tabId)) try {
		await sendDebuggerCommand({ tabId }, "Runtime.evaluate", {
			expression: "1",
			returnByValue: true
		}, CDP_PROBE_TIMEOUT_MS);
		return;
	} catch {
		attached.delete(tabId);
	}
	const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
	const RETRY_DELAY_MS = aggressiveRetry ? 1500 : 500;
	let lastError = "";
	const preservedNetworkCapture = networkCaptures.get(tabId);
	for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) try {
		try {
			await chrome.debugger.detach({ tabId });
		} catch {}
		await chrome.debugger.attach({ tabId }, "1.3");
		lastError = "";
		break;
	} catch (e) {
		lastError = e instanceof Error ? e.message : String(e);
		if (attempt < MAX_ATTACH_RETRIES) {
			console.warn(`[opencli] attach attempt ${attempt}/${MAX_ATTACH_RETRIES} failed: ${lastError}, retrying in ${RETRY_DELAY_MS}ms...`);
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			try {
				const tab = await chrome.tabs.get(tabId);
				if (!isDebuggableUrl$1(tab.url)) {
					lastError = `Tab URL changed to ${tab.url} during retry`;
					break;
				}
			} catch {
				lastError = `Tab ${tabId} no longer exists`;
			}
		}
	}
	if (lastError) {
		let finalUrl = "unknown";
		let finalWindowId = "unknown";
		try {
			const tab = await chrome.tabs.get(tabId);
			finalUrl = tab.url ?? "undefined";
			finalWindowId = String(tab.windowId);
		} catch {}
		console.warn(`[opencli] attach failed for tab ${tabId}: url=${finalUrl}, windowId=${finalWindowId}, error=${lastError}`);
		const hint = lastError.includes("chrome-extension://") ? ". Tip: another Chrome extension may be interfering — try disabling other extensions" : "";
		throw new Error(`attach failed: ${lastError}${hint}`);
	}
	attached.add(tabId);
	await sendDebuggerCommand({ tabId }, "Page.enable");
	try {
		await sendDebuggerCommand({ tabId }, "Runtime.enable");
	} catch {}
	if (preservedNetworkCapture) try {
		await sendDebuggerCommand({ tabId }, "Network.enable");
		networkCaptures.set(tabId, preservedNetworkCapture);
	} catch {}
}
async function evaluate(tabId, expression, aggressiveRetry = false, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
	try {
		await ensureAttached(tabId, aggressiveRetry);
		const result = await sendDebuggerCommand({ tabId }, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true
		}, timeoutMs);
		if (result.exceptionDetails) {
			const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
			throw new Error(errMsg);
		}
		return result.result?.value;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("Detached") || msg.includes("Debugger is not attached") || msg.includes("Target closed")) attached.delete(tabId);
		throw e;
	}
}
var evaluateAsync = evaluate;
/**
* Capture a screenshot via CDP Page.captureScreenshot.
* Returns base64-encoded image data.
*/
async function screenshot(tabId, options = {}) {
	await ensureAttached(tabId);
	const format = options.format ?? "png";
	const fullPage = options.fullPage === true;
	const overrideWidth = options.width && options.width > 0 ? Math.ceil(options.width) : void 0;
	const overrideHeight = !fullPage && options.height && options.height > 0 ? Math.ceil(options.height) : void 0;
	const needsOverride = fullPage || overrideWidth !== void 0 || overrideHeight !== void 0;
	if (needsOverride) {
		if (overrideWidth !== void 0 && fullPage) await sendDebuggerCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
			mobile: false,
			width: overrideWidth,
			height: 0,
			deviceScaleFactor: 1
		});
		let finalWidth = overrideWidth ?? 0;
		let finalHeight = overrideHeight ?? 0;
		if (fullPage) {
			const metrics = await sendDebuggerCommand({ tabId }, "Page.getLayoutMetrics");
			const size = metrics.cssContentSize || metrics.contentSize;
			if (size) {
				if (finalWidth === 0) finalWidth = Math.ceil(size.width);
				finalHeight = Math.ceil(size.height);
			}
		}
		await sendDebuggerCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
			mobile: false,
			width: finalWidth,
			height: finalHeight,
			deviceScaleFactor: 1
		});
	}
	try {
		const params = { format };
		if (format === "jpeg" && options.quality !== void 0) params.quality = Math.max(0, Math.min(100, options.quality));
		return (await sendDebuggerCommand({ tabId }, "Page.captureScreenshot", params)).data;
	} finally {
		if (needsOverride) await sendDebuggerCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {});
	}
}
/**
* Set local file paths on a file input element via CDP DOM.setFileInputFiles.
* This bypasses the need to send large base64 payloads through the message channel —
* Chrome reads the files directly from the local filesystem.
*
* @param tabId - Target tab ID
* @param files - Array of absolute local file paths
* @param selector - CSS selector to find the file input (optional, defaults to first file input)
*/
async function setFileInputFiles(tabId, files, selector) {
	await ensureAttached(tabId);
	await sendDebuggerCommand({ tabId }, "DOM.enable");
	await sendDebuggerCommand({ tabId }, "Page.enable");
	const query = selector || "input[type=\"file\"]";
	if (!(await sendDebuggerCommand({ tabId }, "Runtime.evaluate", {
		expression: `!!document.querySelector(${JSON.stringify(query)})`,
		returnByValue: true
	})).result?.value) throw new Error(`No element found matching selector: ${query}`);
	await sendDebuggerCommand({ tabId }, "Page.setInterceptFileChooserDialog", { enabled: true });
	try {
		const backendNodeId = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup();
				reject(/* @__PURE__ */ new Error("Page.fileChooserOpened not received within 5s — the input may not have opened a file chooser"));
			}, 5e3);
			const listener = (source, method, params) => {
				if (source.tabId !== tabId || method !== "Page.fileChooserOpened") return;
				cleanup();
				const backend = params?.backendNodeId;
				if (typeof backend === "number") resolve(backend);
				else reject(/* @__PURE__ */ new Error("Page.fileChooserOpened carried no backendNodeId"));
			};
			const cleanup = () => {
				clearTimeout(timer);
				chrome.debugger.onEvent.removeListener(listener);
			};
			chrome.debugger.onEvent.addListener(listener);
			sendDebuggerCommand({ tabId }, "Runtime.evaluate", {
				expression: `document.querySelector(${JSON.stringify(query)}).click()`,
				userGesture: true
			}).catch((err) => {
				cleanup();
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
		await sendDebuggerCommand({ tabId }, "DOM.setFileInputFiles", {
			files,
			backendNodeId
		});
	} finally {
		await sendDebuggerCommand({ tabId }, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
	}
}
function matchesDownloadPattern(item, pattern) {
	if (!pattern) return true;
	return [
		item.filename,
		item.url,
		item.finalUrl,
		item.mime
	].filter(Boolean).join("\n").toLowerCase().includes(pattern.toLowerCase());
}
function downloadResult(item, startedAt) {
	return {
		downloaded: item.state === "complete",
		id: item.id,
		filename: item.filename,
		url: item.url,
		finalUrl: item.finalUrl,
		mime: item.mime,
		totalBytes: item.totalBytes,
		state: item.state,
		danger: item.danger,
		error: item.error,
		elapsedMs: Date.now() - startedAt
	};
}
async function waitForDownload(pattern = "", timeoutMs = 3e4) {
	const startedAt = Date.now();
	const timeout = Math.max(1, timeoutMs);
	return await new Promise((resolve) => {
		let done = false;
		const inProgressIds = /* @__PURE__ */ new Set();
		const finish = (result) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			chrome.downloads.onCreated.removeListener(onCreated);
			chrome.downloads.onChanged.removeListener(onChanged);
			resolve(result);
		};
		const inspectById = async (id) => {
			const item = (await chrome.downloads.search({ id }))[0];
			if (!item || !matchesDownloadPattern(item, pattern)) return;
			inProgressIds.add(id);
			if (item.state === "complete" || item.state === "interrupted") finish(downloadResult(item, startedAt));
		};
		const onCreated = (item) => {
			if (!matchesDownloadPattern(item, pattern)) return;
			inProgressIds.add(item.id);
			if (item.state === "complete" || item.state === "interrupted") finish(downloadResult(item, startedAt));
		};
		const onChanged = (delta) => {
			if (!delta.id) return;
			if (!inProgressIds.has(delta.id) && !delta.filename && !delta.url) return;
			if (delta.filename?.current || delta.url?.current) {
				inspectById(delta.id);
				return;
			}
			if (delta.state?.current === "complete" || delta.state?.current === "interrupted") inspectById(delta.id);
		};
		const timer = setTimeout(() => {
			finish({
				downloaded: false,
				state: "interrupted",
				error: `No download matched "${pattern || "*"}" within ${timeout}ms`,
				elapsedMs: Date.now() - startedAt
			});
		}, timeout);
		chrome.downloads.onCreated.addListener(onCreated);
		chrome.downloads.onChanged.addListener(onChanged);
		chrome.downloads.search({
			limit: 50,
			orderBy: ["-startTime"],
			startedAfter: new Date(startedAt - Math.max(timeout, 1e3)).toISOString()
		}).then((recent) => {
			if (done) return;
			const completed = recent.find((item) => item.state === "complete" && matchesDownloadPattern(item, pattern));
			if (completed) {
				finish(downloadResult(completed, startedAt));
				return;
			}
			for (const item of recent) if (item.state === "in_progress" && matchesDownloadPattern(item, pattern)) inProgressIds.add(item.id);
		}).catch((err) => {
			finish({
				downloaded: false,
				state: "interrupted",
				error: err instanceof Error ? err.message : String(err),
				elapsedMs: Date.now() - startedAt
			});
		});
	});
}
function frameTargetKey(tabId, frameId) {
	return `${tabId}:${frameId}`;
}
function registerFrameTargetCleanup() {
	if (frameTargetCleanupRegistered) return;
	frameTargetCleanupRegistered = true;
	chrome.debugger.onEvent.addListener((_source, method, params) => {
		if (method === "Target.detachedFromTarget") clearFrameTarget(String(params?.targetId || ""));
	});
}
function clearFrameTarget(targetId) {
	if (!targetId) return;
	const key = frameTargetKeys.get(targetId);
	if (key) frameTargets.delete(key);
	frameTargetKeys.delete(targetId);
}
async function ensureFrameTarget(tabId, frameId, aggressiveRetry = false, targetUrl) {
	registerFrameTargetCleanup();
	await ensureAttached(tabId, aggressiveRetry);
	const key = frameTargetKey(tabId, frameId);
	const existing = frameTargets.get(key);
	if (existing) return existing;
	await sendDebuggerCommand({ tabId }, "Target.setDiscoverTargets", { discover: true }).catch(() => {});
	await sendDebuggerCommand({ tabId }, "Target.setAutoAttach", {
		autoAttach: true,
		waitForDebuggerOnStart: false,
		flatten: true,
		filter: [{
			type: "iframe",
			exclude: false
		}]
	}).catch(() => {});
	const targetId = await resolveFrameTargetId(tabId, frameId, targetUrl);
	try {
		await chrome.debugger.attach({ targetId }, "1.3");
	} catch (err) {
		if (!(err instanceof Error ? err.message : String(err)).includes("Another debugger is already attached")) throw err;
	}
	frameTargets.set(key, targetId);
	frameTargetKeys.set(targetId, key);
	return targetId;
}
async function resolveFrameTargetId(tabId, frameId, targetUrl) {
	const targets = (await sendDebuggerCommand({ tabId }, "Target.getTargets").catch(() => null))?.targetInfos ?? [];
	const frameTarget = targets.find((candidate) => {
		const candidateId = candidate.targetId || candidate.id;
		return candidate.type === "iframe" && (candidateId === frameId || !!targetUrl && candidate.url === targetUrl);
	});
	const targetId = frameTarget?.targetId || frameTarget?.id;
	if (targetId) return targetId;
	const candidates = targets.filter((target) => target.type === "iframe").map((target) => `${target.targetId || target.id || "?"} ${target.url || ""}`).join("; ");
	throw new Error(`No iframe target found for frame ${frameId}${targetUrl ? ` (${targetUrl})` : ""}. Candidates: ${candidates || "none"}`);
}
async function sendCommandInFrameTarget(tabId, frameId, method, params = {}, aggressiveRetry = false, timeoutMs = CDP_COMMAND_TIMEOUT_MS, targetUrl) {
	return sendDebuggerCommand({ targetId: await ensureFrameTarget(tabId, frameId, aggressiveRetry, targetUrl) }, method, params, timeoutMs);
}
async function insertText(tabId, text) {
	await ensureAttached(tabId);
	await sendDebuggerCommand({ tabId }, "Input.insertText", { text });
}
function registerFrameTracking() {
	registerFrameTargetCleanup();
	chrome.debugger.onEvent.addListener((source, method, params) => {
		const tabId = source.tabId;
		if (!tabId) return;
		if (method === "Runtime.executionContextCreated") {
			const context = params.context;
			if (!context?.auxData?.frameId || context.auxData.isDefault !== true) return;
			const frameId = context.auxData.frameId;
			if (!tabFrameContexts.has(tabId)) tabFrameContexts.set(tabId, /* @__PURE__ */ new Map());
			tabFrameContexts.get(tabId).set(frameId, context.id);
		}
		if (method === "Runtime.executionContextDestroyed") {
			const ctxId = params.executionContextId;
			const contexts = tabFrameContexts.get(tabId);
			if (contexts) {
				for (const [fid, cid] of contexts) if (cid === ctxId) {
					contexts.delete(fid);
					break;
				}
			}
		}
		if (method === "Runtime.executionContextsCleared") tabFrameContexts.delete(tabId);
	});
	chrome.tabs.onRemoved.addListener((tabId) => {
		tabFrameContexts.delete(tabId);
	});
}
async function getFrameTree(tabId) {
	await ensureAttached(tabId);
	return sendDebuggerCommand({ tabId }, "Page.getFrameTree");
}
async function evaluateInFrame(tabId, expression, frameId, aggressiveRetry = false, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
	await ensureAttached(tabId, aggressiveRetry);
	await sendDebuggerCommand({ tabId }, "Runtime.enable").catch(() => {});
	const contexts = tabFrameContexts.get(tabId);
	const contextId = contexts?.get(frameId);
	if (contextId !== void 0) try {
		const result = await sendDebuggerCommand({ tabId }, "Runtime.evaluate", {
			expression,
			contextId,
			returnByValue: true,
			awaitPromise: true
		}, timeoutMs);
		if (result.exceptionDetails) {
			const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
			throw new Error(errMsg);
		}
		return result.result?.value;
	} catch (err) {
		const msg = String(err?.message || err);
		if (!/Cannot find context|context with specified id|Execution context was destroyed/i.test(msg)) throw err;
		contexts?.delete(frameId);
	}
	await sendCommandInFrameTarget(tabId, frameId, "Runtime.enable", {}, aggressiveRetry, timeoutMs).catch(() => void 0);
	const result = await sendCommandInFrameTarget(tabId, frameId, "Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true
	}, aggressiveRetry, timeoutMs);
	if (result.exceptionDetails) {
		const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
		throw new Error(errMsg);
	}
	return result.result?.value;
}
function normalizeCapturePatterns(pattern) {
	return String(pattern || "").split("|").map((part) => part.trim()).filter(Boolean);
}
function shouldCaptureUrl(url, patterns) {
	if (!url) return false;
	if (!patterns.length) return true;
	return patterns.some((pattern) => url.includes(pattern));
}
function normalizeHeaders(headers) {
	if (!headers || typeof headers !== "object") return {};
	const out = {};
	for (const [key, value] of Object.entries(headers)) out[String(key)] = String(value);
	return out;
}
function getOrCreateNetworkCaptureEntry(tabId, requestId, fallback) {
	const state = networkCaptures.get(tabId);
	if (!state) return null;
	const existingIndex = state.requestToIndex.get(requestId);
	if (existingIndex !== void 0) return state.entries[existingIndex] || null;
	const url = fallback?.url || "";
	if (!shouldCaptureUrl(url, state.patterns)) return null;
	const entry = {
		kind: "cdp",
		requestId,
		url,
		method: fallback?.method || "GET",
		requestHeaders: fallback?.requestHeaders || {},
		timestamp: Date.now()
	};
	state.entries.push(entry);
	state.requestToIndex.set(requestId, state.entries.length - 1);
	return entry;
}
async function startNetworkCapture(tabId, pattern) {
	await ensureAttached(tabId);
	await sendDebuggerCommand({ tabId }, "Network.enable");
	networkCaptures.set(tabId, {
		patterns: normalizeCapturePatterns(pattern),
		entries: [],
		requestToIndex: /* @__PURE__ */ new Map()
	});
}
async function readNetworkCapture(tabId, retainIncomplete = false) {
	const state = networkCaptures.get(tabId);
	if (!state) return [];
	const entries = state.entries.map((entry) => ({ ...entry }));
	if (!retainIncomplete) {
		state.entries = [];
		state.requestToIndex.clear();
		return entries;
	}
	const pendingEntries = [];
	const pendingMap = /* @__PURE__ */ new Map();
	for (const [requestId, index] of state.requestToIndex) {
		const entry = state.entries[index];
		if (entry && !entry.captureComplete) {
			pendingMap.set(requestId, pendingEntries.length);
			pendingEntries.push(entry);
		}
	}
	state.entries = pendingEntries;
	state.requestToIndex = pendingMap;
	return entries;
}
function hasActiveNetworkCapture(tabId) {
	return networkCaptures.has(tabId);
}
function clearFrameTargetsForTab(tabId) {
	for (const [key, targetId] of [...frameTargets.entries()]) {
		if (!key.startsWith(`${tabId}:`)) continue;
		frameTargets.delete(key);
		frameTargetKeys.delete(targetId);
		chrome.debugger.detach({ targetId }).catch(() => {});
	}
}
async function detach(tabId) {
	clearFrameTargetsForTab(tabId);
	if (!attached.has(tabId)) return;
	attached.delete(tabId);
	networkCaptures.delete(tabId);
	tabFrameContexts.delete(tabId);
	try {
		await chrome.debugger.detach({ tabId });
	} catch {}
}
function preventTabDiscard(tab) {
	if (tab.id !== void 0 && tab.autoDiscardable !== false) chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
}
function registerListeners() {
	chrome.tabs.onCreated.addListener(preventTabDiscard);
	chrome.tabs.onRemoved.addListener((tabId) => {
		attached.delete(tabId);
		networkCaptures.delete(tabId);
		tabFrameContexts.delete(tabId);
		clearFrameTargetsForTab(tabId);
	});
	chrome.debugger.onDetach.addListener((source) => {
		if (source.tabId) {
			attached.delete(source.tabId);
			networkCaptures.delete(source.tabId);
			tabFrameContexts.delete(source.tabId);
			clearFrameTargetsForTab(source.tabId);
			return;
		}
		if (source.targetId) clearFrameTarget(source.targetId);
	});
	chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
		if (tab) preventTabDiscard(tab);
		if (info.url && !isDebuggableUrl$1(info.url)) await detach(tabId);
	});
	chrome.debugger.onEvent.addListener(async (source, method, params) => {
		if (method === "Page.javascriptDialogOpening" && params?.type === "beforeunload" && source.tabId !== void 0 && attached.has(source.tabId)) await sendDebuggerCommand({ tabId: source.tabId }, "Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
		const tabId = source.tabId;
		if (!tabId) return;
		const state = networkCaptures.get(tabId);
		if (!state) return;
		const eventParams = params;
		if (method === "Network.requestWillBeSent") {
			const requestId = String(eventParams?.requestId || "");
			const request = eventParams?.request;
			const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
				url: request?.url,
				method: request?.method,
				requestHeaders: normalizeHeaders(request?.headers)
			});
			if (!entry) return;
			if (!eventParams?.redirectResponse) {
				entry.requestBodyKind = request?.hasPostData ? "string" : "empty";
				{
					const raw = String(request?.postData || "");
					const fullSize = raw.length;
					const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
					entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
					entry.requestBodyFullSize = fullSize;
					entry.requestBodyTruncated = truncated;
				}
				entry.requestBodyPending = true;
				try {
					const postData = await sendDebuggerCommand({ tabId }, "Network.getRequestPostData", { requestId });
					if (postData?.postData) {
						const raw = postData.postData;
						const fullSize = raw.length;
						const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
						entry.requestBodyKind = "string";
						entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
						entry.requestBodyFullSize = fullSize;
						entry.requestBodyTruncated = truncated;
					}
				} catch {} finally {
					entry.requestBodyPending = false;
					if (entry.responseFinished) entry.captureComplete = true;
				}
			}
			return;
		}
		if (method === "Network.responseReceived") {
			const requestId = String(eventParams?.requestId || "");
			const response = eventParams?.response;
			const stateEntryIndex = state.requestToIndex.get(requestId);
			if (stateEntryIndex === void 0) return;
			const entry = state.entries[stateEntryIndex];
			if (!entry) return;
			entry.responseStatus = response?.status;
			entry.responseContentType = response?.mimeType || "";
			entry.responseHeaders = normalizeHeaders(response?.headers);
			return;
		}
		if (method === "Network.loadingFinished") {
			const requestId = String(eventParams?.requestId || "");
			const stateEntryIndex = state.requestToIndex.get(requestId);
			if (stateEntryIndex === void 0) return;
			const entry = state.entries[stateEntryIndex];
			if (!entry) return;
			try {
				const body = await sendDebuggerCommand({ tabId }, "Network.getResponseBody", { requestId });
				if (typeof body?.body === "string") {
					const fullSize = body.body.length;
					const truncated = fullSize > CDP_RESPONSE_BODY_CAPTURE_LIMIT;
					const stored = truncated ? body.body.slice(0, CDP_RESPONSE_BODY_CAPTURE_LIMIT) : body.body;
					entry.responsePreview = body.base64Encoded ? `base64:${stored}` : stored;
					entry.responseBodyFullSize = fullSize;
					entry.responseBodyTruncated = truncated;
				}
			} catch {} finally {
				entry.responseFinished = true;
				if (!entry.requestBodyPending) entry.captureComplete = true;
			}
			return;
		}
		if (method === "Network.loadingFailed") {
			const requestId = String(eventParams?.requestId || "");
			const stateEntryIndex = state.requestToIndex.get(requestId);
			if (stateEntryIndex === void 0) return;
			const entry = state.entries[stateEntryIndex];
			if (entry) {
				entry.responseFinished = true;
				if (!entry.requestBodyPending) entry.captureComplete = true;
			}
		}
	});
}
//#endregion
//#region src/identity.ts
/**
* Page identity mapping — targetId ↔ tabId.
*
* targetId is the cross-layer page identity (CDP target UUID).
* tabId is an internal Chrome Tabs API routing detail — never exposed outside the extension.
*
* Lifecycle:
*   - Cache populated lazily via chrome.debugger.getTargets()
*   - Evicted on tab close (chrome.tabs.onRemoved)
*   - Miss triggers full refresh; refresh miss → hard error (no guessing)
*/
var targetToTab = /* @__PURE__ */ new Map();
var tabToTarget = /* @__PURE__ */ new Map();
/**
* Resolve targetId for a given tabId.
* Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
* Throws if no targetId can be found (page may have been destroyed).
*/
async function resolveTargetId(tabId) {
	const cached = tabToTarget.get(tabId);
	if (cached) return cached;
	await refreshMappings();
	const result = tabToTarget.get(tabId);
	if (!result) throw new Error(`No targetId for tab ${tabId} — page may have been closed`);
	return result;
}
/**
* Resolve tabId for a given targetId.
* Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
* Throws if no tabId can be found — never falls back to guessing.
*/
async function resolveTabId$1(targetId) {
	const cached = targetToTab.get(targetId);
	if (cached !== void 0) return cached;
	await refreshMappings();
	const result = targetToTab.get(targetId);
	if (result === void 0) throw new Error(`Page not found: ${targetId} — stale page identity`);
	return result;
}
/**
* Remove mappings for a closed tab.
* Called from chrome.tabs.onRemoved listener.
*/
function evictTab(tabId) {
	const targetId = tabToTarget.get(tabId);
	if (targetId) targetToTab.delete(targetId);
	tabToTarget.delete(tabId);
}
/**
* Full refresh of targetId ↔ tabId mappings from chrome.debugger.getTargets().
*/
async function refreshMappings() {
	const targets = await chrome.debugger.getTargets();
	targetToTab.clear();
	tabToTarget.clear();
	for (const t of targets) if (t.type === "page" && t.tabId !== void 0) {
		targetToTab.set(t.id, t.tabId);
		tabToTarget.set(t.tabId, t.id);
	}
}
//#endregion
//#region src/journal.ts
var JOURNAL_KEY = "opencli_command_journal_v1";
var JOURNAL_MAX_ENTRIES = 64;
/** Results larger than this are not recorded; a replayed id re-fails honestly. */
var JOURNAL_RESULT_MAX_BYTES = 65536;
var cache = null;
var writeQueue = Promise.resolve();
var inFlight = /* @__PURE__ */ new Map();
async function load() {
	if (cache) return cache;
	try {
		cache = (await chrome.storage.session.get(JOURNAL_KEY))?.[JOURNAL_KEY] ?? {};
	} catch {
		cache = {};
	}
	return cache;
}
function persist() {
	const snapshot = cache;
	if (!snapshot) return;
	writeQueue = writeQueue.then(async () => {
		try {
			await chrome.storage.session.set({ [JOURNAL_KEY]: snapshot });
		} catch {}
	});
}
function trim(journal) {
	const ids = Object.keys(journal);
	if (ids.length <= JOURNAL_MAX_ENTRIES) return;
	ids.sort((a, b) => journal[a].ts - journal[b].ts);
	for (const id of ids.slice(0, ids.length - JOURNAL_MAX_ENTRIES)) delete journal[id];
}
function resultByteLength(result) {
	try {
		return JSON.stringify(result).length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
var UNKNOWN_OUTCOME_HINT = "Inspect the browser/session state before retrying. Do not blindly re-run write commands such as navigate, click, type, or eval.";
/**
* Execute a command exactly once per id. Duplicate deliveries of the same id
* (transport retries after a dropped connection) replay the recorded outcome.
*/
async function executeWithJournal(cmd, execute) {
	const id = cmd.id;
	if (!id) return execute(cmd);
	const running = inFlight.get(id);
	if (running) return running;
	const run = (async () => {
		const journal = await load();
		const entry = journal[id];
		if (entry?.status === "done") {
			if (entry.result) return entry.result;
			return {
				id,
				ok: false,
				errorCode: "result_evicted",
				error: "Command already executed, but its result was too large to record for replay.",
				errorHint: UNKNOWN_OUTCOME_HINT
			};
		}
		if (entry?.status === "started") return {
			id,
			ok: false,
			errorCode: "command_lost",
			error: "Command was interrupted mid-execution (extension or browser restarted); it may or may not have applied.",
			errorHint: UNKNOWN_OUTCOME_HINT
		};
		journal[id] = {
			status: "started",
			ts: Date.now()
		};
		trim(journal);
		persist();
		let result;
		try {
			result = await execute(cmd);
		} catch (err) {
			result = {
				id,
				ok: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
		journal[id] = resultByteLength(result) <= JOURNAL_RESULT_MAX_BYTES ? {
			status: "done",
			ts: Date.now(),
			result
		} : {
			status: "done",
			ts: Date.now()
		};
		persist();
		return result;
	})();
	inFlight.set(id, run);
	try {
		return await run;
	} finally {
		inFlight.delete(id);
	}
}
//#endregion
//#region src/credential-fill-frame.ts
/** This function is serialized by chrome.scripting, so every helper stays local. */
async function credentialFillInFrame(request) {
	const host = window.location.hostname;
	const normalizeHost = (value) => value.trim().toLowerCase().replace(/^\.+/, "");
	const normalizedHost = normalizeHost(host);
	if (!request.allowedHosts.some((entry) => {
		const allowedHost = normalizeHost(entry);
		return allowedHost.length > 0 && (normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`));
	})) return {
		ok: false,
		host,
		username_filled: false,
		password_filled: false,
		submitted: false,
		reason: "host_not_allowed"
	};
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
	const isVisible = (element) => {
		if (!(element instanceof HTMLElement)) return false;
		const style = window.getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && !element.hasAttribute("disabled");
	};
	const queryFirstVisibleInput = (selectors) => {
		for (const selector of selectors) {
			let elements = [];
			try {
				elements = Array.from(document.querySelectorAll(selector));
			} catch {
				continue;
			}
			const found = elements.find((element) => (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && isVisible(element) && !element.readOnly);
			if (found) return found;
		}
		return null;
	};
	const textOf = (element) => clean([
		element.innerText,
		element.getAttribute("aria-label"),
		element.getAttribute("title"),
		element.getAttribute("placeholder"),
		element instanceof HTMLInputElement ? element.value : ""
	].filter(Boolean).join(" "));
	const matchesActivationText = (text) => request.activateTextPatterns.some((pattern) => {
		try {
			return new RegExp(pattern).test(text);
		} catch {
			return text === pattern || text.includes(pattern);
		}
	});
	const activateLoginMode = () => {
		const target = Array.from(document.querySelectorAll("button, a, input, div, span")).filter(isVisible).find((element) => matchesActivationText(textOf(element)));
		if (!target) return false;
		target.click();
		return true;
	};
	const inputEvent = (type, value) => {
		try {
			return new InputEvent(type, {
				bubbles: true,
				cancelable: false,
				inputType: "insertText",
				data: value
			});
		} catch {
			return new Event(type, {
				bubbles: true,
				cancelable: false
			});
		}
	};
	const dispatchLegacyEvent = (field, eventName) => {
		const event = field.ownerDocument.createEvent("Event");
		event.initEvent(eventName, true, false);
		field.dispatchEvent(event);
	};
	const setValue = async (field, value) => {
		field.focus();
		await Promise.resolve();
		field.dispatchEvent(new FocusEvent("focus", {
			bubbles: false,
			cancelable: false
		}));
		field.dispatchEvent(new FocusEvent("focusin", {
			bubbles: true,
			cancelable: false
		}));
		field.dispatchEvent(new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: false,
			key: value
		}));
		field.dispatchEvent(inputEvent("beforeinput", value));
		field.dispatchEvent(new KeyboardEvent("keypress", {
			bubbles: true,
			cancelable: false,
			key: value
		}));
		const descriptor = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value");
		if (descriptor?.set) descriptor.set.call(field, value);
		else field.value = value;
		field.dispatchEvent(new Event("input", {
			bubbles: true,
			cancelable: false
		}));
		field.dispatchEvent(new KeyboardEvent("keyup", {
			bubbles: true,
			cancelable: false,
			key: value
		}));
		field.dispatchEvent(new Event("change", {
			bubbles: true,
			cancelable: false
		}));
		dispatchLegacyEvent(field, "input");
		dispatchLegacyEvent(field, "change");
	};
	const findSubmitTarget = (usernameInput, passwordInput) => {
		for (const selector of request.submitSelectors) {
			let elements = [];
			try {
				elements = Array.from(document.querySelectorAll(selector));
			} catch {
				continue;
			}
			const found = elements.find((element) => {
				if (!isVisible(element)) return false;
				return /^(登录|登 录|提交|确认|继续)$/.test(textOf(element)) || element.getAttribute("type") === "submit";
			});
			if (found) return found;
		}
		return passwordInput?.form?.querySelector("button[type=\"submit\"], input[type=\"submit\"]") ?? usernameInput?.form?.querySelector("button[type=\"submit\"], input[type=\"submit\"]") ?? null;
	};
	let usernameInput = queryFirstVisibleInput(request.usernameSelectors);
	let passwordInput = queryFirstVisibleInput(request.passwordSelectors);
	if ((!usernameInput || !passwordInput) && activateLoginMode()) {
		await delay(500);
		usernameInput = queryFirstVisibleInput(request.usernameSelectors);
		passwordInput = queryFirstVisibleInput(request.passwordSelectors);
	}
	if (!usernameInput || !passwordInput) return {
		ok: false,
		host,
		username_filled: false,
		password_filled: false,
		submitted: false,
		reason: "login_inputs_not_found"
	};
	await setValue(usernameInput, request.username);
	await setValue(passwordInput, request.password);
	let submitted = false;
	if (request.submit) {
		const submitTarget = findSubmitTarget(usernameInput, passwordInput);
		if (submitTarget) {
			submitTarget.click();
			submitted = true;
		} else if (passwordInput.form && typeof passwordInput.form.requestSubmit === "function") {
			passwordInput.form.requestSubmit();
			submitted = true;
		}
	}
	return {
		ok: true,
		host,
		username_filled: clean(usernameInput.value).length > 0,
		password_filled: clean(passwordInput.value).length > 0,
		submitted,
		reason: ""
	};
}
//#endregion
//#region src/credential-fill.ts
var DEFAULT_USERNAME_SELECTORS = [
	"#fm-login-id",
	"input[name=\"fm-login-id\"]",
	"input[autocomplete=\"username\"]",
	"input[type=\"email\"]",
	"input[type=\"text\"]"
];
var DEFAULT_PASSWORD_SELECTORS = [
	"#fm-login-password",
	"input[name=\"fm-login-password\"]",
	"input[autocomplete=\"current-password\"]",
	"input[type=\"password\"]"
];
var DEFAULT_LOGIN_ACTIVATION_TEXT = [
	"账号密码登录",
	"密码登录",
	"账号登录"
];
var DEFAULT_SUBMIT_SELECTORS = [
	"button[type=\"submit\"]",
	"input[type=\"submit\"]",
	"button",
	"a"
];
function cleanStringArray(value, fallback) {
	if (!Array.isArray(value)) return [...fallback];
	const cleaned = value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
	return cleaned.length > 0 ? cleaned : [...fallback];
}
function normalizeCredentialFillRequest(value, defaultSubmit = true) {
	if (!value || typeof value !== "object") return null;
	const record = value;
	if (typeof record.username !== "string" || typeof record.password !== "string") return null;
	const allowedHosts = cleanStringArray(record.allowedHosts, []);
	if (allowedHosts.length === 0) return null;
	return {
		username: record.username,
		password: record.password,
		allowedHosts,
		usernameSelectors: cleanStringArray(record.usernameSelectors, DEFAULT_USERNAME_SELECTORS),
		passwordSelectors: cleanStringArray(record.passwordSelectors, DEFAULT_PASSWORD_SELECTORS),
		activateTextPatterns: cleanStringArray(record.activateTextPatterns, DEFAULT_LOGIN_ACTIVATION_TEXT),
		submitSelectors: cleanStringArray(record.submitSelectors, DEFAULT_SUBMIT_SELECTORS),
		submit: typeof record.submit === "boolean" ? record.submit : defaultSubmit
	};
}
function isCredentialFillFrameResult(value) {
	if (!value || typeof value !== "object") return false;
	const record = value;
	return typeof record.ok === "boolean" && typeof record.host === "string" && typeof record.username_filled === "boolean" && typeof record.password_filled === "boolean" && typeof record.submitted === "boolean";
}
async function runCredentialFillOnTab(tabId, request) {
	const frameResults = (await chrome.scripting.executeScript({
		target: {
			tabId,
			allFrames: true
		},
		world: "MAIN",
		func: credentialFillInFrame,
		args: [request]
	})).map((entry) => ({
		frameId: entry.frameId,
		result: entry.result
	})).filter((entry) => typeof entry.frameId === "number" && isCredentialFillFrameResult(entry.result)).map(({ frameId, result }) => ({
		frameId,
		result: {
			ok: result.ok,
			host: result.host,
			username_filled: result.username_filled,
			password_filled: result.password_filled,
			submitted: result.submitted,
			...typeof result.reason === "string" ? { reason: result.reason } : {}
		}
	}));
	return frameResults.find((entry) => entry.result.ok) ?? frameResults.find((entry) => entry.result.reason !== "host_not_allowed") ?? frameResults[0] ?? null;
}
//#endregion
//#region src/passive-autofill.ts
var CANDIDATE_HOSTS = [
	"login.taobao.com",
	"loginmyseller.taobao.com",
	"havanalogin.taobao.com"
];
var REQUEST_TIMEOUT_MS = 2500;
var ATTEMPT_TTL_MS = 2e4;
var RETRY_DELAYS_MS = [
	0,
	400,
	1200,
	2500
];
function isResponse(value) {
	if (!value || typeof value !== "object") return false;
	const record = value;
	return record.type === "autofill-response" && typeof record.requestId === "string" && typeof record.ok === "boolean";
}
function isCandidateUrl(rawUrl) {
	if (!rawUrl) return false;
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		const host = url.hostname.toLowerCase();
		return CANDIDATE_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
	} catch {
		return false;
	}
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createPassiveAutofill(dependencies) {
	let requestCounter = 0;
	const pending = /* @__PURE__ */ new Map();
	const recentAttempts = /* @__PURE__ */ new Map();
	function handleDaemonMessage(value) {
		if (!isResponse(value)) return false;
		const request = pending.get(value.requestId);
		if (!request) return true;
		clearTimeout(request.timer);
		pending.delete(value.requestId);
		const credential = value.ok ? normalizeCredentialFillRequest(value.credential, false) : null;
		request.resolve(credential ? {
			...credential,
			submit: false
		} : null);
		return true;
	}
	async function waitForSocket() {
		await dependencies.connect();
		const deadline = Date.now() + REQUEST_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (dependencies.isSocketOpen()) return true;
			await delay(100);
		}
		return dependencies.isSocketOpen();
	}
	async function requestCredential(rawUrl) {
		if (!await waitForSocket()) return null;
		const requestId = `autofill_${Date.now()}_${++requestCounter}`;
		const contextId = await dependencies.getContextId();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve(null);
			}, REQUEST_TIMEOUT_MS);
			pending.set(requestId, {
				resolve,
				timer
			});
			if (dependencies.send({
				type: "autofill-request",
				requestId,
				contextId,
				url: rawUrl
			})) return;
			clearTimeout(timer);
			pending.delete(requestId);
			resolve(null);
		});
	}
	async function fillTab(tabId, rawUrl) {
		const credential = await requestCredential(rawUrl);
		if (!credential) return;
		for (const delayMs of RETRY_DELAYS_MS) {
			if (delayMs > 0) await delay(delayMs);
			try {
				const selected = await runCredentialFillOnTab(tabId, credential);
				if (selected?.result.ok) return;
				const reason = selected?.result.reason;
				if (reason && reason !== "login_inputs_not_found" && reason !== "host_not_allowed") return;
			} catch {
				return;
			}
		}
	}
	async function triggerForTab(tabId, rawUrl, options = {}) {
		if (!isCandidateUrl(rawUrl)) return;
		const now = Date.now();
		for (const [key, timestamp] of recentAttempts) if (now - timestamp > ATTEMPT_TTL_MS * 3) recentAttempts.delete(key);
		const key = `${tabId}\n${rawUrl}`;
		if (!options.bypassRecent && now - (recentAttempts.get(key) ?? 0) < ATTEMPT_TTL_MS) return;
		recentAttempts.set(key, now);
		await fillTab(tabId, rawUrl);
	}
	function scheduleForTab(tabId, rawUrl) {
		triggerForTab(tabId, rawUrl).catch(() => {});
	}
	function registerListeners() {
		chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
			if (changeInfo.status === "complete" || changeInfo.url) scheduleForTab(tabId, changeInfo.url ?? tab.url);
		});
		chrome.webNavigation?.onCommitted?.addListener((details) => scheduleForTab(details.tabId, details.url), { url: CANDIDATE_HOSTS.map((hostEquals) => ({ hostEquals })) });
		chrome.webNavigation?.onCompleted?.addListener((details) => scheduleForTab(details.tabId, details.url), { url: CANDIDATE_HOSTS.map((hostEquals) => ({ hostEquals })) });
	}
	async function scanOpenTabs() {
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) if (typeof tab.id === "number") scheduleForTab(tab.id, tab.url);
	}
	return {
		handleDaemonMessage,
		registerListeners,
		scanOpenTabs,
		scheduleForTab,
		triggerForTab
	};
}
//#endregion
//#region src/profile-rebind.ts
var validId = (value) => typeof value === "string" && /^[a-z0-9]{8}$/.test(value);
function createProfileRebinder(dependencies) {
	let pending = null;
	return {
		isPending: () => pending !== null,
		async prepare(command) {
			await dependencies.ready();
			if (pending || !dependencies.isIdle()) return {
				id: command.id,
				ok: false,
				errorCode: "profile_rebind_busy",
				error: "The extension is busy. Stop and inspect."
			};
			const current = await dependencies.getContextId();
			if (!validId(command.expectedContextId) || !validId(command.rebindContextId) || command.contextId !== command.expectedContextId || current !== command.expectedContextId || current === command.rebindContextId) return {
				id: command.id,
				ok: false,
				errorCode: "profile_rebind_invalid",
				error: "The expected profile ID does not match this extension."
			};
			if (pending || !dependencies.isIdle()) return {
				id: command.id,
				ok: false,
				errorCode: "profile_rebind_busy",
				error: "The extension is busy. Stop and inspect."
			};
			pending = {
				id: command.id,
				stored: false,
				scheduled: false
			};
			try {
				await dependencies.storeContextId(command.rebindContextId);
				pending.stored = true;
				return {
					id: command.id,
					ok: true,
					data: {
						contextId: command.rebindContextId,
						previousContextId: current
					}
				};
			} catch {
				return {
					id: command.id,
					ok: false,
					errorCode: "profile_rebind_storage_failed",
					error: "Profile storage could not be confirmed. Stop and inspect; do not retry."
				};
			}
		},
		acknowledge(result, sent) {
			if (!sent || !result.ok || !pending?.stored || pending.id !== result.id || pending.scheduled) return;
			pending.scheduled = true;
			dependencies.schedule(() => dependencies.reload(), 250);
		}
	};
}
//#endregion
//#region src/background.ts
var ws = null;
var reconnectTimer = null;
var reconnectAttempts = 0;
var CONTEXT_ID_KEY = "opencli_context_id_v1";
var currentContextId = "default";
var contextIdPromise = null;
var connectInFlight = null;
var workerReady = Promise.resolve();
var workerRecovered = true;
async function getCurrentContextId() {
	if (contextIdPromise) return contextIdPromise;
	contextIdPromise = (async () => {
		try {
			const local = chrome.storage?.local;
			if (!local) return currentContextId;
			const existing = (await local.get(CONTEXT_ID_KEY))[CONTEXT_ID_KEY];
			if (typeof existing === "string" && existing.trim()) {
				currentContextId = existing.trim();
				return currentContextId;
			}
			const generated = generateContextId();
			await local.set({ [CONTEXT_ID_KEY]: generated });
			currentContextId = generated;
			return currentContextId;
		} catch {
			return currentContextId;
		}
	})();
	return contextIdPromise;
}
function generateContextId() {
	const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
	const maxUnbiasedByte = Math.floor(256 / 31) * 31;
	let id = "";
	while (id.length < 8) {
		const bytes = /* @__PURE__ */ new Uint8Array(8);
		try {
			crypto.getRandomValues(bytes);
		} catch {
			for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
		}
		for (const byte of bytes) {
			if (byte >= maxUnbiasedByte) continue;
			id += alphabet[byte % 31];
			if (id.length === 8) break;
		}
	}
	return id;
}
var _origLog = console.log.bind(console);
var _origWarn = console.warn.bind(console);
var _origError = console.error.bind(console);
function forwardLog(level, args) {
	try {
		const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
		safeSend(ws, {
			type: "log",
			level,
			msg,
			ts: Date.now()
		});
	} catch {}
}
function safeSend(socket, payload) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return false;
	try {
		socket.send(JSON.stringify(payload));
		return true;
	} catch {
		return false;
	}
}
var passiveAutofill = createPassiveAutofill({
	connect,
	getContextId: getCurrentContextId,
	isSocketOpen: () => ws?.readyState === WebSocket.OPEN,
	send: (payload) => safeSend(ws, payload)
});
var profileRebinder = createProfileRebinder({
	ready: () => workerReady,
	getContextId: getCurrentContextId,
	isIdle: () => [...activeCommandCounts.values()].every((count) => count === 0),
	storeContextId: async (contextId) => {
		await chrome.storage.local.set({ [CONTEXT_ID_KEY]: contextId });
	},
	reload: () => chrome.runtime.reload(),
	schedule: (callback, delayMs) => setTimeout(callback, delayMs)
});
console.log = (...args) => {
	_origLog(...args);
	forwardLog("info", args);
};
console.warn = (...args) => {
	_origWarn(...args);
	forwardLog("warn", args);
};
console.error = (...args) => {
	_origError(...args);
	forwardLog("error", args);
};
function isDaemonSocketActive(socket = ws) {
	return socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
}
/**
* Probe the daemon via its /ping HTTP endpoint before attempting a WebSocket
* connection.  fetch() failures are silently catchable; new WebSocket() is not
* — Chrome logs ERR_CONNECTION_REFUSED to the extension error page before any
* JS handler can intercept it.  By keeping the probe inside connect() every
* call site remains unchanged and the guard can never be accidentally skipped.
*/
function connect() {
	if (isDaemonSocketActive()) return Promise.resolve();
	if (connectInFlight) return connectInFlight;
	connectInFlight = (workerRecovered ? connectAttempt() : workerReady.then(() => connectAttempt())).finally(() => {
		connectInFlight = null;
	});
	return connectInFlight;
}
async function connectAttempt() {
	if (isDaemonSocketActive()) return;
	try {
		const res = await fetch(DAEMON_PING_URL, {
			signal: AbortSignal.timeout(1e3),
			credentials: "omit"
		});
		if (!res.ok) {
			console.warn(`[opencli] daemon ping failed: HTTP ${res.status}`);
			scheduleReconnect();
			return;
		}
		reconnectAttempts = 0;
	} catch {
		scheduleReconnect();
		return;
	}
	if (isDaemonSocketActive()) return;
	let thisWs;
	try {
		const contextId = await getCurrentContextId();
		if (isDaemonSocketActive()) return;
		thisWs = new WebSocket(DAEMON_WS_URL);
		ws = thisWs;
		currentContextId = contextId;
	} catch {
		scheduleReconnect();
		return;
	}
	thisWs.onopen = () => {
		if (ws !== thisWs) return;
		console.log("[opencli] Connected to daemon");
		reconnectAttempts = 0;
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		safeSend(thisWs, {
			type: "hello",
			contextId: currentContextId,
			version: chrome.runtime.getManifest().version,
			compatRange: ">=1.7.0"
		});
		startWsKeepalive(thisWs);
	};
	thisWs.onmessage = async (event) => {
		if (ws !== thisWs) return;
		try {
			const payload = JSON.parse(event.data);
			if (passiveAutofill.handleDaemonMessage(payload)) return;
			const command = payload;
			const result = command.action === "profile-rebind" ? await handleCommand(command) : await executeWithJournal(command, handleCommand);
			const sent = safeSend(ws && ws.readyState === WebSocket.OPEN ? ws : thisWs, result);
			if (command.action === "profile-rebind") profileRebinder.acknowledge(result, sent);
		} catch {
			console.error("[opencli] Message handling error");
		}
	};
	thisWs.onclose = () => {
		stopWsKeepalive(thisWs);
		if (ws !== thisWs) return;
		console.log("[opencli] Disconnected from daemon");
		ws = null;
		scheduleReconnect();
	};
	thisWs.onerror = () => {
		thisWs.close();
	};
}
var WS_KEEPALIVE_INTERVAL_MS = 2e4;
var wsKeepaliveTimer = null;
var wsKeepaliveSocket = null;
function startWsKeepalive(socket) {
	if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
	wsKeepaliveSocket = socket;
	wsKeepaliveTimer = setInterval(() => {
		if (socket !== ws || socket.readyState !== WebSocket.OPEN) {
			stopWsKeepalive(socket);
			return;
		}
		safeSend(socket, {
			type: "ping",
			ts: Date.now()
		});
	}, WS_KEEPALIVE_INTERVAL_MS);
}
function stopWsKeepalive(socket) {
	if (wsKeepaliveSocket !== socket) return;
	if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
	wsKeepaliveTimer = null;
	wsKeepaliveSocket = null;
}
/**
* Reconnect cadence: plain exponential backoff with jitter, never giving up
* while Chrome keeps the service worker alive. 1s → 2s → 4s → … capped at 15s
* (+0-500ms jitter); attempts reset on a successful WS open. The durable wake
* path is chrome.alarms: production Chrome enforces a ~30s minimum alarm
* interval, so alarms wake the worker after idle eviction while setTimeout
* provides the faster path only when the worker remains alive.
*/
var RECONNECT_BASE_DELAY_MS = 1e3;
var RECONNECT_MAX_DELAY_MS = 15e3;
function nextReconnectDelayMs() {
	return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempts, 6)) + Math.floor(Math.random() * 500);
}
function scheduleReconnect() {
	if (reconnectTimer) return;
	const delay = nextReconnectDelayMs();
	reconnectAttempts++;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, delay);
}
var automationSessions = /* @__PURE__ */ new Map();
var IDLE_TIMEOUT_DEFAULT = 3e4;
var IDLE_TIMEOUT_INTERACTIVE = 6e5;
var IDLE_TIMEOUT_NONE = -1;
var REGISTRY_KEY = "opencli_target_lease_registry_v2";
var LEASE_IDLE_ALARM_PREFIX = "opencli:lease-idle:";
var CONTAINER_TAB_GROUP_TITLE = {
	interactive: "OpenCLI Browser",
	automation: "OpenCLI Adapter"
};
var OWNED_TAB_GROUP_COLOR = "orange";
var leaseMutationQueue = Promise.resolve();
var ownedContainers = {
	interactive: {
		windowId: null,
		groupId: null,
		promise: null,
		groupPromise: null
	},
	automation: {
		windowId: null,
		groupId: null,
		promise: null,
		groupPromise: null
	}
};
var interactiveGroupLedger = /* @__PURE__ */ new Set();
var CommandFailure = class extends Error {
	code;
	hint;
	constructor(code, message, hint) {
		super(message);
		this.code = code;
		this.hint = hint;
		this.name = "CommandFailure";
	}
};
var sessionOverrides = /* @__PURE__ */ new Map();
function setSessionOverride(key, patch) {
	sessionOverrides.set(key, {
		...sessionOverrides.get(key),
		...patch
	});
}
/** Commands currently executing per lease — idle release is deferred while > 0. */
var activeCommandCounts = /* @__PURE__ */ new Map();
var closingLeases = /* @__PURE__ */ new Set();
var closingTabs = /* @__PURE__ */ new Set();
var LEASE_KEY_SEPARATOR = "\0";
function getLeaseKey(session, surface) {
	return `${surface}${LEASE_KEY_SEPARATOR}${encodeURIComponent(session)}`;
}
function getSessionName(session) {
	const raw = session?.trim();
	if (!raw) throw new CommandFailure("session_required", "Browser session is required.", "Pass a browser session name, e.g. opencli browser <session> <command>.");
	return raw;
}
function getCommandSurface(cmd) {
	return cmd.surface === "adapter" ? "adapter" : "browser";
}
function getSurfaceFromKey(key) {
	return key.split(LEASE_KEY_SEPARATOR, 1)[0] === "adapter" ? "adapter" : "browser";
}
function getSessionFromKey(key) {
	const idx = key.indexOf(LEASE_KEY_SEPARATOR);
	if (idx === -1) return key;
	try {
		return decodeURIComponent(key.slice(idx + 1));
	} catch {
		return key.slice(idx + 1);
	}
}
function getIdleTimeout(key) {
	const session = automationSessions.get(key);
	if (session?.kind === "bound") return IDLE_TIMEOUT_NONE;
	const overrides = sessionOverrides.get(key);
	if (getSurfaceFromKey(key) === "adapter" && (session?.lifecycle === "persistent" || overrides?.lifecycle === "persistent")) return IDLE_TIMEOUT_NONE;
	if (overrides?.idleTimeoutMs !== void 0) return overrides.idleTimeoutMs;
	return getSurfaceFromKey(key) === "browser" ? IDLE_TIMEOUT_INTERACTIVE : IDLE_TIMEOUT_DEFAULT;
}
function getLeaseLifecycle(key, kind) {
	if (kind === "bound") return "pinned";
	const override = sessionOverrides.get(key)?.lifecycle;
	if (override) return override;
	return getSurfaceFromKey(key) === "browser" ? "persistent" : "ephemeral";
}
function getOwnedWindowRole(key) {
	return getSurfaceFromKey(key) === "browser" ? "interactive" : "automation";
}
function getWindowRole(key, ownership) {
	return ownership === "borrowed" ? "borrowed-user" : getOwnedWindowRole(key);
}
function getWindowMode(key) {
	return sessionOverrides.get(key)?.windowMode ?? (getOwnedWindowRole(key) === "interactive" ? "foreground" : "background");
}
function getTabPlacement(key) {
	return sessionOverrides.get(key)?.tabPlacement ?? automationSessions.get(key)?.tabPlacement ?? "owned-container";
}
function makeAlarmName(leaseKey) {
	return `${LEASE_IDLE_ALARM_PREFIX}${encodeURIComponent(leaseKey)}`;
}
function leaseKeyFromAlarmName(name) {
	if (!name.startsWith(LEASE_IDLE_ALARM_PREFIX)) return null;
	try {
		return decodeURIComponent(name.slice(19));
	} catch {
		return null;
	}
}
function withLeaseMutation(fn) {
	const run = leaseMutationQueue.then(fn, fn);
	leaseMutationQueue = run.then(() => void 0, () => void 0);
	return run;
}
function makeSession(key, session) {
	const ownership = session.owned ? "owned" : "borrowed";
	return {
		...session,
		tabPlacement: session.tabPlacement ?? getTabPlacement(key),
		...session.owned && (session.tabPlacement ?? getTabPlacement(key)) === "existing-window" ? { ownedTabIds: [.../* @__PURE__ */ new Set([...session.ownedTabIds ?? automationSessions.get(key)?.ownedTabIds ?? [], ...session.preferredTabId === null ? [] : [session.preferredTabId]])] } : {},
		contextId: currentContextId,
		ownership,
		lifecycle: getLeaseLifecycle(key, session.kind),
		windowRole: getWindowRole(key, ownership)
	};
}
function emptyRegistry() {
	return {
		version: 2,
		contextId: currentContextId,
		ownedContainers: {
			interactive: {
				windowId: ownedContainers.interactive.windowId,
				groupIds: [...interactiveGroupLedger]
			},
			automation: { windowId: ownedContainers.automation.windowId }
		},
		leases: {}
	};
}
async function readRegistry() {
	try {
		const session = chrome.storage?.session;
		if (!session) return emptyRegistry();
		const stored = (await session.get(REGISTRY_KEY))[REGISTRY_KEY];
		if (!stored || stored.version !== 2 || typeof stored.leases !== "object") return emptyRegistry();
		const storedContainers = stored.ownedContainers && typeof stored.ownedContainers === "object" ? stored.ownedContainers : emptyRegistry().ownedContainers;
		return {
			version: 2,
			contextId: currentContextId,
			ownedContainers: {
				interactive: {
					windowId: typeof storedContainers.interactive?.windowId === "number" ? storedContainers.interactive.windowId : null,
					groupIds: Array.isArray(storedContainers.interactive?.groupIds) ? storedContainers.interactive.groupIds.filter((id) => typeof id === "number") : []
				},
				automation: { windowId: typeof storedContainers.automation?.windowId === "number" ? storedContainers.automation.windowId : null }
			},
			leases: stored.leases
		};
	} catch {
		return emptyRegistry();
	}
}
async function writeRegistry(registry) {
	try {
		await chrome.storage?.session?.set({ [REGISTRY_KEY]: registry });
	} catch {}
}
async function persistRuntimeState() {
	const leases = {};
	for (const [leaseKey, session] of automationSessions.entries()) leases[leaseKey] = {
		session: session.session,
		surface: session.surface,
		kind: session.kind,
		windowId: session.windowId,
		owned: session.owned,
		tabPlacement: session.tabPlacement,
		ownedTabIds: session.ownedTabIds,
		preferredTabId: session.preferredTabId,
		contextId: session.contextId,
		ownership: session.ownership,
		lifecycle: session.lifecycle,
		windowRole: session.windowRole,
		idleDeadlineAt: session.idleDeadlineAt,
		updatedAt: Date.now()
	};
	await writeRegistry({
		version: 2,
		contextId: currentContextId,
		ownedContainers: {
			interactive: {
				windowId: ownedContainers.interactive.windowId,
				groupIds: [...interactiveGroupLedger]
			},
			automation: { windowId: ownedContainers.automation.windowId }
		},
		leases
	});
}
function scheduleIdleAlarm(leaseKey, timeout) {
	const alarmName = makeAlarmName(leaseKey);
	try {
		if (timeout > 0) chrome.alarms?.create?.(alarmName, { when: Date.now() + timeout });
		else chrome.alarms?.clear?.(alarmName);
	} catch {}
}
async function safeDetach(tabId) {
	try {
		const detach$1 = detach;
		if (typeof detach$1 === "function") await detach$1(tabId);
	} catch {}
}
async function removeTabWithDialogProtection(tabId) {
	let tab;
	try {
		tab = await chrome.tabs.get(tabId);
	} catch (error) {
		if (/No tab with id|no longer exists|Unknown tab/.test(error instanceof Error ? error.message : String(error))) return;
		throw error;
	}
	await ensureAttached(tabId, true);
	if ((await chrome.tabs.query({ windowId: tab.windowId })).some((other) => other.id !== tabId)) await chrome.tabs.remove(tabId);
	else {
		await chrome.tabs.update(tabId, {
			url: BLANK_PAGE,
			active: false
		});
		await safeDetach(tabId);
	}
	evictTab(tabId);
}
async function closeExistingLeaseTab(leaseKey, tabId) {
	const lease = automationSessions.get(leaseKey);
	if (!lease?.ownedTabIds?.includes(tabId)) throw new CommandFailure("tab_not_owned", "The target tab does not belong to this session.");
	await removeTabWithDialogProtection(tabId);
	const remaining = lease.ownedTabIds.filter((id) => id !== tabId);
	if (!remaining.length) await removeLeaseSession(leaseKey);
	else setLeaseSession(leaseKey, {
		...lease,
		ownedTabIds: remaining,
		preferredTabId: lease.preferredTabId === tabId ? remaining[remaining.length - 1] : lease.preferredTabId
	});
}
async function removeLeaseSession(leaseKey) {
	const existing = automationSessions.get(leaseKey);
	if (existing?.idleTimer) clearTimeout(existing.idleTimer);
	automationSessions.delete(leaseKey);
	sessionOverrides.delete(leaseKey);
	scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
	await persistRuntimeState();
}
function resetWindowIdleTimer(leaseKey, remainingMs) {
	const session = automationSessions.get(leaseKey);
	if (!session) return;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	const timeout = getIdleTimeout(leaseKey);
	if (timeout <= 0) {
		scheduleIdleAlarm(leaseKey, timeout);
		session.idleTimer = null;
		session.idleDeadlineAt = 0;
		persistRuntimeState();
		return;
	}
	const interval = remainingMs === void 0 ? timeout : Math.max(0, Math.min(remainingMs, timeout));
	scheduleIdleAlarm(leaseKey, interval);
	session.idleDeadlineAt = Date.now() + interval;
	persistRuntimeState();
	session.idleTimer = setTimeout(async () => {
		if ((activeCommandCounts.get(leaseKey) ?? 0) > 0) return;
		await releaseLease(leaseKey, "idle timeout");
	}, interval);
}
async function focusOwnedWindowIfRequested(windowId, mode) {
	if (mode !== "foreground") return;
	const updateWindow = chrome.windows.update;
	if (typeof updateWindow === "function") await updateWindow(windowId, { focused: true }).catch(() => {});
}
async function toOwnedContainerGroupCandidate(group) {
	let chromeWindow;
	try {
		chromeWindow = await chrome.windows.get(group.windowId);
	} catch (err) {
		if (err instanceof Error && classifyExtensionError(err.message) === "tab_gone") return null;
		throw err;
	}
	const reusableTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
	return {
		id: group.id,
		windowId: group.windowId,
		title: group.title,
		focused: !!chromeWindow.focused,
		hasReusableTab: reusableTabId !== void 0
	};
}
function selectOwnedContainerGroupCandidate(candidates) {
	if (candidates.length === 0) return null;
	return [...candidates].sort((a, b) => {
		if (a.focused !== b.focused) return a.focused ? -1 : 1;
		if (a.hasReusableTab !== b.hasReusableTab) return a.hasReusableTab ? -1 : 1;
		if (a.windowId !== b.windowId) return a.windowId - b.windowId;
		return a.id - b.id;
	})[0];
}
function isMissingTabGroupError(err) {
	return err instanceof Error && /No group with id|group no longer exists/i.test(err.message);
}
async function collectOwnedGroupCandidates(role) {
	if (role === "automation") return [];
	const container = ownedContainers[role];
	const groupsById = /* @__PURE__ */ new Map();
	if (container.groupId !== null) try {
		const group = await chrome.tabGroups.get(container.groupId);
		groupsById.set(group.id, group);
	} catch (err) {
		if (!isMissingTabGroupError(err)) throw err;
		container.groupId = null;
	}
	let ledgerPruned = false;
	for (const groupId of [...interactiveGroupLedger]) {
		if (groupsById.has(groupId)) continue;
		try {
			const group = await chrome.tabGroups.get(groupId);
			groupsById.set(group.id, group);
		} catch (err) {
			if (!isMissingTabGroupError(err)) throw err;
			interactiveGroupLedger.delete(groupId);
			ledgerPruned = true;
		}
	}
	if (ledgerPruned) await persistRuntimeState();
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || session.tabPlacement === "existing-window" || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
		let tab;
		try {
			tab = await chrome.tabs.get(session.preferredTabId);
		} catch (err) {
			if (err instanceof Error && classifyExtensionError(err.message) === "tab_gone") continue;
			throw err;
		}
		const groupId = tab.groupId;
		if (typeof groupId !== "number" || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
		try {
			const group = await chrome.tabGroups.get(groupId);
			groupsById.set(group.id, group);
		} catch (err) {
			if (!isMissingTabGroupError(err)) throw err;
		}
	}
	const ownedPreferredTabIds = /* @__PURE__ */ new Set();
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || session.tabPlacement === "existing-window" || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
		ownedPreferredTabIds.add(session.preferredTabId);
	}
	if (ownedPreferredTabIds.size > 0) {
		const allGroups = await chrome.tabGroups.query({});
		for (const group of allGroups) {
			if (group.title) continue;
			if (groupsById.has(group.id)) continue;
			if ((await chrome.tabs.query({ groupId: group.id })).some((tab) => tab.id !== void 0 && ownedPreferredTabIds.has(tab.id))) groupsById.set(group.id, group);
		}
	}
	return (await Promise.all([...groupsById.values()].map(toOwnedContainerGroupCandidate))).filter((candidate) => candidate !== null);
}
function updateOwnedSessionWindowForTabs(role, tabIds, windowId) {
	const moved = new Set(tabIds);
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || session.tabPlacement === "existing-window" || getOwnedWindowRole(leaseKey) !== role) continue;
		if (session.preferredTabId !== null && moved.has(session.preferredTabId)) session.windowId = windowId;
	}
}
async function ensureTabsInWindow(tabIds, windowId) {
	const movedIds = [];
	for (const tabId of tabIds) try {
		if ((await chrome.tabs.get(tabId)).windowId !== windowId) {
			await chrome.tabs.move(tabId, {
				windowId,
				index: -1
			});
			movedIds.push(tabId);
		}
	} catch (err) {
		if (!(err instanceof Error) || classifyExtensionError(err.message) !== "tab_gone") throw err;
	}
	return movedIds;
}
async function ensureCanonicalGroupTitle(role, group) {
	const canonicalTitle = CONTAINER_TAB_GROUP_TITLE[role];
	if (group.title === canonicalTitle) return group;
	const updated = await chrome.tabGroups.update(group.id, {
		title: canonicalTitle,
		color: OWNED_TAB_GROUP_COLOR
	});
	return {
		id: updated.id,
		windowId: updated.windowId,
		title: updated.title
	};
}
async function convergeOwnedGroupDuplicates(role, canonical, candidates) {
	for (const duplicate of candidates) {
		if (duplicate.id === canonical.id) continue;
		const tabIds = (await chrome.tabs.query({ groupId: duplicate.id })).map((tab) => tab.id).filter((id) => id !== void 0);
		if (tabIds.length === 0) continue;
		await ensureTabsInWindow(tabIds, canonical.windowId);
		await chrome.tabs.group({
			groupId: canonical.id,
			tabIds
		});
		updateOwnedSessionWindowForTabs(role, tabIds, canonical.windowId);
	}
	return canonical;
}
async function attachTabsToOwnedGroup(role, group, ids) {
	if (ids.length === 0) return group;
	await ensureTabsInWindow(ids, group.windowId);
	const missing = (await Promise.all(ids.map(async (id) => {
		try {
			return await chrome.tabs.get(id);
		} catch (err) {
			if (err instanceof Error && classifyExtensionError(err.message) === "tab_gone") return null;
			throw err;
		}
	}))).filter((tab) => tab !== null && tab.id !== void 0 && tab.groupId !== group.id).map((tab) => tab.id);
	if (missing.length > 0) await chrome.tabs.group({
		groupId: group.id,
		tabIds: missing
	});
	updateOwnedSessionWindowForTabs(role, ids, group.windowId);
	return group;
}
async function createOwnedGroup(role, windowId, ids) {
	if (ids.length === 0) throw new Error(`Cannot create ${role} tab group without tabs`);
	await ensureTabsInWindow(ids, windowId);
	const groupId = await chrome.tabs.group({
		tabIds: ids,
		createProperties: { windowId }
	});
	ownedContainers[role].groupId = groupId;
	ownedContainers[role].windowId = windowId;
	if (role === "interactive") interactiveGroupLedger.add(groupId);
	await persistRuntimeState();
	const group = await chrome.tabGroups.update(groupId, {
		color: OWNED_TAB_GROUP_COLOR,
		title: CONTAINER_TAB_GROUP_TITLE[role],
		collapsed: false
	});
	updateOwnedSessionWindowForTabs(role, ids, group.windowId);
	return {
		id: group.id,
		windowId: group.windowId,
		title: group.title
	};
}
async function ensureOwnedContainerGroup(role, fallbackWindowId, tabIds) {
	if (role === "automation") return null;
	const ids = [...new Set(tabIds.filter((id) => id !== void 0))];
	const container = ownedContainers[role];
	const trackedGroupPromise = (container.groupPromise ?? Promise.resolve(null)).catch(() => null).then(() => ensureOwnedContainerGroupUnlocked(role, fallbackWindowId, ids)).finally(() => {
		if (container.groupPromise === trackedGroupPromise) container.groupPromise = null;
	});
	container.groupPromise = trackedGroupPromise;
	return trackedGroupPromise;
}
async function ensureOwnedContainerGroupUnlocked(role, fallbackWindowId, ids) {
	try {
		const candidates = await collectOwnedGroupCandidates(role);
		const selected = selectOwnedContainerGroupCandidate(candidates);
		let canonical = selected ? {
			id: selected.id,
			windowId: selected.windowId,
			title: selected.title
		} : null;
		if (canonical) {
			canonical = await convergeOwnedGroupDuplicates(role, canonical, candidates);
			canonical = await ensureCanonicalGroupTitle(role, canonical);
			canonical = await attachTabsToOwnedGroup(role, canonical, ids);
		} else if (fallbackWindowId !== null && ids.length > 0) canonical = await createOwnedGroup(role, fallbackWindowId, ids);
		if (canonical) {
			ownedContainers[role].windowId = canonical.windowId;
			ownedContainers[role].groupId = canonical.id;
			if (!interactiveGroupLedger.has(canonical.id)) {
				interactiveGroupLedger.add(canonical.id);
				await persistRuntimeState();
			}
		} else {
			ownedContainers[role].groupId = null;
			if (fallbackWindowId === null) ownedContainers[role].windowId = null;
		}
		return canonical;
	} catch (err) {
		console.warn(`[opencli] Failed to ensure ${role} tab group: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
}
/**
* Ensure the owned window for the requested role exists.
*
* First-principles model:
* - BrowserContext is the user's default Chrome profile.
* - Session identity maps to a TargetLease (usually a tab), not a window.
* - Browser commands and adapters use separate owned windows so foreground
*   interactive work cannot drag background adapter automation into view.
*/
async function ensureOwnedContainerWindow(role, initialUrl, mode = "background") {
	const container = ownedContainers[role];
	if (container.promise) return container.promise;
	container.promise = ensureOwnedContainerWindowUnlocked(role, initialUrl, mode).finally(() => {
		container.promise = null;
	});
	return container.promise;
}
async function ensureOwnedContainerWindowUnlocked(role, initialUrl, mode = "background") {
	const container = ownedContainers[role];
	if (container.windowId !== null) {
		const windowId = container.windowId;
		try {
			await chrome.windows.get(windowId);
		} catch (err) {
			if (!(err instanceof Error) || classifyExtensionError(err.message) !== "tab_gone") throw err;
			console.warn(`[opencli] Owned ${role} window ${windowId} is unavailable: ${err instanceof Error ? err.message : String(err)}`);
			container.windowId = null;
			container.groupId = null;
		}
		if (container.windowId === windowId) {
			const group = await ensureOwnedContainerGroup(role, windowId, []);
			if (group) {
				await focusOwnedWindowIfRequested(group.windowId, mode);
				const initialTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
				return {
					windowId: group.windowId,
					initialTabId
				};
			}
			if (role === "interactive") {
				container.windowId = null;
				container.groupId = null;
			} else {
				await focusOwnedWindowIfRequested(windowId, mode);
				return {
					windowId,
					initialTabId: await findReusableOwnedContainerTab(windowId, null)
				};
			}
		}
	}
	const existingGroup = await ensureOwnedContainerGroup(role, null, []);
	if (existingGroup) {
		await focusOwnedWindowIfRequested(existingGroup.windowId, mode);
		const initialTabId = await findReusableOwnedContainerTab(existingGroup.windowId, existingGroup.id);
		await persistRuntimeState();
		return {
			windowId: existingGroup.windowId,
			initialTabId
		};
	}
	const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
	const win = await chrome.windows.create({
		url: startUrl,
		focused: mode === "foreground",
		width: 1280,
		height: 900,
		type: "normal"
	});
	container.windowId = win.id;
	await persistRuntimeState();
	console.log(`[opencli] Created owned ${role} window ${container.windowId} (start=${startUrl})`);
	const tabs = await chrome.tabs.query({ windowId: win.id });
	const initialTabId = tabs[0]?.id;
	if (initialTabId) await new Promise((resolve) => {
		const timeout = setTimeout(resolve, 500);
		const listener = (tabId, info) => {
			if (tabId === initialTabId && info.status === "complete") {
				chrome.tabs.onUpdated.removeListener(listener);
				clearTimeout(timeout);
				resolve();
			}
		};
		if (tabs[0].status === "complete") {
			clearTimeout(timeout);
			resolve();
		} else chrome.tabs.onUpdated.addListener(listener);
	});
	const group = await ensureOwnedContainerGroup(role, container.windowId, [initialTabId]);
	await persistRuntimeState();
	return {
		windowId: group?.windowId ?? container.windowId,
		initialTabId
	};
}
async function findReusableOwnedContainerTab(windowId, ownedGroupId) {
	return (await chrome.tabs.query({ windowId })).find((tab) => tab.id !== void 0 && initialTabIsAvailable(tab.id) && isDebuggableUrl(tab.url) && (ownedGroupId === void 0 || ownedGroupId !== null && tab.groupId === ownedGroupId || !isSafeNavigationUrl(tab.url ?? "")))?.id;
}
function initialTabIsAvailable(tabId) {
	if (tabId === void 0) return false;
	for (const session of automationSessions.values()) if (session.owned && session.preferredTabId === tabId) return false;
	return true;
}
async function createOwnedTabLease(leaseKey, initialUrl) {
	return withLeaseMutation(() => createOwnedTabLeaseUnlocked(leaseKey, initialUrl));
}
async function createOwnedTabLeaseUnlocked(leaseKey, initialUrl) {
	if (getTabPlacement(leaseKey) === "existing-window") {
		const window = (await chrome.windows.getAll({ windowTypes: ["normal"] })).filter((w) => w.id !== void 0 && !w.incognito && w.type === "normal").sort((a, b) => Number(!!b.focused) - Number(!!a.focused) || a.id - b.id)[0];
		if (window?.id === void 0) throw new CommandFailure("existing_window_required", "Open the target Chrome profile window first.");
		const tab = await chrome.tabs.create({
			windowId: window.id,
			url: initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE,
			active: false
		});
		if (tab.id === void 0) throw new Error("Failed to create background tab");
		setLeaseSession(leaseKey, {
			session: getSessionFromKey(leaseKey),
			surface: getSurfaceFromKey(leaseKey),
			kind: "owned",
			windowId: tab.windowId,
			owned: true,
			preferredTabId: tab.id,
			tabPlacement: "existing-window"
		});
		resetWindowIdleTimer(leaseKey);
		return {
			tabId: tab.id,
			tab
		};
	}
	const targetUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
	const role = getOwnedWindowRole(leaseKey);
	const { windowId, initialTabId } = await ensureOwnedContainerWindow(role, BLANK_PAGE, getWindowMode(leaseKey));
	let tab;
	if (initialTabIsAvailable(initialTabId)) {
		tab = await chrome.tabs.get(initialTabId);
		if (!isTargetUrl(tab.url, targetUrl)) {
			tab = await chrome.tabs.update(initialTabId, { url: targetUrl });
			await new Promise((resolve) => setTimeout(resolve, 300));
			tab = await chrome.tabs.get(initialTabId);
		}
	} else tab = await chrome.tabs.create({
		windowId,
		url: targetUrl,
		active: true
	});
	const tabId = tab.id;
	if (!tabId) throw new Error("Failed to create tab lease in automation container");
	const sessionWindowId = (await ensureOwnedContainerGroup(role, windowId, [tabId]))?.windowId ?? tab.windowId;
	if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);
	setLeaseSession(leaseKey, {
		session: getSessionFromKey(leaseKey),
		surface: getSurfaceFromKey(leaseKey),
		kind: "owned",
		windowId: sessionWindowId,
		owned: true,
		preferredTabId: tabId
	});
	resetWindowIdleTimer(leaseKey);
	return {
		tabId,
		tab
	};
}
/** Get or create the dedicated automation container window.
*  This compatibility helper returns the shared owned container. Leases
*  lease tabs inside it instead of owning separate windows.
*/
async function getAutomationWindow(leaseKey, initialUrl) {
	const existing = automationSessions.get(leaseKey);
	if (existing) {
		if (!existing.owned) throw new CommandFailure("bound_window_operation_blocked", `Session "${existing.session}" is bound to a user tab and does not own an OpenCLI tab lease.`, "Use page commands on the bound tab, or unbind the session first.");
		try {
			const tabId = existing.preferredTabId;
			if (tabId !== null) {
				const tab = await chrome.tabs.get(tabId);
				if (isDebuggableUrl(tab.url)) return tab.windowId;
			}
			await chrome.windows.get(existing.windowId);
			return existing.windowId;
		} catch {
			await removeLeaseSession(leaseKey);
		}
	}
	return (await ensureOwnedContainerWindow(getOwnedWindowRole(leaseKey), initialUrl, getWindowMode(leaseKey))).windowId;
}
chrome.windows.onRemoved.addListener(async (windowId) => {
	await workerReady;
	for (const container of Object.values(ownedContainers)) if (container.windowId === windowId) {
		container.windowId = null;
		container.groupId = null;
	}
	for (const [leaseKey, session] of automationSessions.entries()) if (session.windowId === windowId) {
		console.log(`[opencli] ${session.surface} container closed (session=${session.session})`);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(leaseKey);
		sessionOverrides.delete(leaseKey);
		scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
	}
	await persistRuntimeState();
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
	await workerReady;
	evictTab(tabId);
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (session.tabPlacement === "existing-window" && session.ownedTabIds?.includes(tabId)) {
			const remaining = session.ownedTabIds.filter((id) => id !== tabId);
			if (remaining.length) {
				setLeaseSession(leaseKey, {
					...session,
					ownedTabIds: remaining,
					preferredTabId: session.preferredTabId === tabId ? remaining[remaining.length - 1] : session.preferredTabId
				});
				continue;
			}
		}
		if (session.preferredTabId === tabId || session.tabPlacement === "existing-window" && session.ownedTabIds?.includes(tabId)) {
			if (session.idleTimer) clearTimeout(session.idleTimer);
			automationSessions.delete(leaseKey);
			sessionOverrides.delete(leaseKey);
			scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
			console.log(`[opencli] Session ${session.session} detached from tab ${tabId} (tab closed)`);
		}
	}
	await persistRuntimeState();
});
var initialized = false;
function initialize() {
	if (initialized) return;
	initialized = true;
	chrome.alarms.create("keepalive", { periodInMinutes: .5 });
	passiveAutofill.registerListeners();
	registerListeners();
	try {
		registerFrameTracking?.();
	} catch {}
	try {
		chrome.storage?.local?.remove?.(REGISTRY_KEY)?.catch?.(() => {});
	} catch {}
	workerRecovered = false;
	workerReady = (async () => {
		await getCurrentContextId();
		await reconcileTargetLeaseRegistry();
	})().catch((err) => {
		console.warn(`[opencli] Startup recovery failed: ${err instanceof Error ? err.message : String(err)}`);
	}).finally(() => {
		workerRecovered = true;
	});
	workerReady.then(async () => {
		await connect();
		await passiveAutofill.scanOpenTabs();
	}).catch(() => {});
	console.log("[opencli] OpenCLI extension initialized");
}
chrome.runtime.onInstalled.addListener(() => {
	initialize();
});
chrome.runtime.onStartup.addListener(() => {
	initialize();
});
initialize();
chrome.alarms.onAlarm.addListener(async (alarm) => {
	await workerReady;
	if (alarm.name === "keepalive") connect();
	const leaseKey = leaseKeyFromAlarmName(alarm.name);
	if (!leaseKey) return;
	if ((activeCommandCounts.get(leaseKey) ?? 0) > 0) {
		resetWindowIdleTimer(leaseKey);
		return;
	}
	await releaseLease(leaseKey, "idle alarm");
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "autofill-page-ready") {
		const tabId = sender.tab?.id;
		if (typeof tabId === "number") passiveAutofill.scheduleForTab(tabId, sender.url ?? sender.tab?.url);
		sendResponse({ ok: true });
		return false;
	}
	if (msg?.type === "getStatus") {
		(async () => {
			const contextId = await getCurrentContextId();
			const connected = ws?.readyState === WebSocket.OPEN;
			const extensionVersion = chrome.runtime.getManifest().version;
			const daemonVersion = connected ? await fetchDaemonVersion() : null;
			sendResponse({
				connected,
				reconnecting: reconnectTimer !== null,
				contextId,
				extensionVersion,
				daemonVersion
			});
		})();
		return true;
	}
	return false;
});
/**
* Best-effort fetch of the daemon's reported version for the popup status panel.
* Resolves to null on any failure — the popup degrades to showing connection
* state without the version label.
*/
async function fetchDaemonVersion() {
	try {
		const res = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/status`, {
			method: "GET",
			headers: { "X-OpenCLI": "1" },
			signal: AbortSignal.timeout(1500)
		});
		if (!res.ok) return null;
		const body = await res.json();
		return typeof body.daemonVersion === "string" ? body.daemonVersion : null;
	} catch {
		return null;
	}
}
async function handleCommand(cmd) {
	if (cmd.action === "profile-rebind") return profileRebinder.prepare(cmd);
	if (profileRebinder.isPending()) return {
		id: cmd.id,
		ok: false,
		errorCode: "profile_rebind_busy",
		error: "Profile rebinding is pending. Wait for reconnection."
	};
	if (cmd.action === "tabs" && cmd.op === "snapshot") {
		await workerReady;
		const owned = new Set([...automationSessions.values()].filter((s) => s.owned && s.preferredTabId !== null).flatMap((s) => s.ownedTabIds ?? [s.preferredTabId]));
		return {
			id: cmd.id,
			ok: true,
			data: await readBrowserSnapshot(owned)
		};
	}
	if (cmd.action === "chrome-describe" || cmd.action === "chrome-call") try {
		if (cmd.action === "chrome-describe") return {
			id: cmd.id,
			ok: true,
			data: await describeChrome(cmd.chromeMethod)
		};
		return await withLeaseMutation(async () => ({
			id: cmd.id,
			ok: true,
			data: await callChrome(cmd.chromeMethod ?? "", cmd.chromeArgs ?? [], new Set([...automationSessions.values()].map((s) => s.preferredTabId).filter((id) => id !== null)), /* @__PURE__ */ new Set([...interactiveGroupLedger, ...Object.values(ownedContainers).map((c) => c.groupId).filter((id) => id !== null)]))
		}));
	} catch (error) {
		return errorResult(cmd.id, error);
	}
	const session = getSessionName(cmd.session);
	const surface = getCommandSurface(cmd);
	const leaseKey = getLeaseKey(session, surface);
	if (closingLeases.has(leaseKey)) return errorResult(cmd.id, new CommandFailure("session_busy", "This session is closing; retry after cleanup finishes."));
	if (cmd.tabPlacement === "existing-window" || cmd.tabPlacement === "owned-container") {
		const lease = automationSessions.get(leaseKey);
		if (lease?.owned && lease.tabPlacement && lease.tabPlacement !== cmd.tabPlacement) return errorResult(cmd.id, new CommandFailure("session_policy_changed", "Use a new session when changing tab placement."));
		setSessionOverride(leaseKey, { tabPlacement: cmd.tabPlacement });
	}
	if (cmd.windowMode === "foreground" || cmd.windowMode === "background") setSessionOverride(leaseKey, { windowMode: cmd.windowMode });
	if (surface === "adapter" && (cmd.siteSession === "persistent" || cmd.siteSession === "ephemeral")) setSessionOverride(leaseKey, { lifecycle: cmd.siteSession });
	if (cmd.idleTimeout != null && cmd.idleTimeout > 0) setSessionOverride(leaseKey, { idleTimeoutMs: cmd.idleTimeout * 1e3 });
	resetWindowIdleTimer(leaseKey);
	activeCommandCounts.set(leaseKey, (activeCommandCounts.get(leaseKey) ?? 0) + 1);
	try {
		switch (cmd.action) {
			case "exec": return await handleExec(cmd, leaseKey);
			case "navigate": return await handleNavigate(cmd, leaseKey);
			case "tabs": return await handleTabs(cmd, leaseKey);
			case "cookies": return await handleCookies(cmd);
			case "screenshot": return await handleScreenshot(cmd, leaseKey);
			case "close-owned-tab":
			case "close-window": return await handleCloseWindow(cmd, leaseKey);
			case "cdp": return await handleCdp(cmd, leaseKey);
			case "set-file-input": return await handleSetFileInput(cmd, leaseKey);
			case "insert-text": return await handleInsertText(cmd, leaseKey);
			case "credential-fill":
			case "credential-autofill": return await handleCredentialFill(cmd, leaseKey, cmd.action === "credential-fill");
			case "bind": return await handleBind(cmd, leaseKey);
			case "network-capture-start": return await handleNetworkCaptureStart(cmd, leaseKey);
			case "network-capture-read": return await handleNetworkCaptureRead(cmd, leaseKey);
			case "wait-download": return await handleWaitDownload(cmd);
			case "frames": return await handleFrames(cmd, leaseKey);
			default: return {
				id: cmd.id,
				ok: false,
				error: `Unknown action: ${cmd.action}`
			};
		}
	} catch (err) {
		return errorResult(cmd.id, err);
	} finally {
		const remaining = (activeCommandCounts.get(leaseKey) ?? 1) - 1;
		if (remaining <= 0) activeCommandCounts.delete(leaseKey);
		else activeCommandCounts.set(leaseKey, remaining);
		resetWindowIdleTimer(leaseKey);
	}
}
/** Internal blank page used when no user URL is provided. */
var BLANK_PAGE = "about:blank";
/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
function isDebuggableUrl(url) {
	if (!url) return true;
	return url.startsWith("http://") || url.startsWith("https://") || url === "about:blank" || url.startsWith("data:");
}
/** Check if a URL is safe for user-facing navigation (http/https only). */
function isSafeNavigationUrl(url) {
	return url.startsWith("http://") || url.startsWith("https://");
}
/** Minimal URL normalization for same-page comparison: root slash + default port only. */
function normalizeUrlForComparison(url) {
	if (!url) return "";
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "https:" && parsed.port === "443" || parsed.protocol === "http:" && parsed.port === "80") parsed.port = "";
		const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
		return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return url;
	}
}
function isTargetUrl(currentUrl, targetUrl) {
	return normalizeUrlForComparison(currentUrl) === normalizeUrlForComparison(targetUrl);
}
function getUrlOrigin(url) {
	if (!url) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}
function enumerateCrossOriginFrames(tree) {
	const frames = [];
	function collect(node, accessibleOrigin) {
		for (const child of node.childFrames || []) {
			const frame = child.frame;
			const frameUrl = frame.url || frame.unreachableUrl || "";
			const frameOrigin = getUrlOrigin(frameUrl);
			if (accessibleOrigin && frameOrigin && frameOrigin === accessibleOrigin) {
				collect(child, frameOrigin);
				continue;
			}
			frames.push({
				index: frames.length,
				frameId: frame.id,
				url: frameUrl,
				name: frame.name || ""
			});
		}
	}
	const rootFrame = tree?.frameTree?.frame;
	const rootUrl = rootFrame?.url || rootFrame?.unreachableUrl || "";
	collect(tree.frameTree, getUrlOrigin(rootUrl));
	return frames;
}
function setLeaseSession(leaseKey, session) {
	if (session.preferredTabId !== null && closingTabs.has(session.preferredTabId)) throw new CommandFailure("session_busy", "This tab is closing; wait for cleanup to finish.");
	const existing = automationSessions.get(leaseKey);
	if (existing?.idleTimer) clearTimeout(existing.idleTimer);
	const timeout = getIdleTimeout(leaseKey);
	automationSessions.set(leaseKey, {
		...makeSession(leaseKey, session),
		idleTimer: null,
		idleDeadlineAt: timeout <= 0 ? 0 : Date.now() + timeout
	});
	persistRuntimeState();
}
/**
* Resolve tabId from command's page (targetId).
* Returns undefined if no page identity is provided.
*/
async function resolveCommandTabId(cmd) {
	if (cmd.page) return resolveTabId$1(cmd.page);
}
/**
* Resolve target tab for the session lease, returning both the tabId and
* the Tab object (when available) so callers can skip a redundant chrome.tabs.get().
*/
async function resolveTab(tabId, leaseKey, initialUrl) {
	const existingSession = automationSessions.get(leaseKey);
	if (tabId !== void 0) try {
		const tab = await chrome.tabs.get(tabId);
		const session = existingSession;
		const matchesSession = session ? session.tabPlacement === "existing-window" ? session.ownedTabIds?.includes(tabId) === true : session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
		if (session?.tabPlacement === "existing-window" && !matchesSession) throw new CommandFailure("tab_not_owned", "The target tab does not belong to this session.");
		if (isDebuggableUrl(tab.url) && matchesSession) return {
			tabId,
			tab
		};
		if (session && !session.owned) throw new CommandFailure(matchesSession ? "bound_tab_not_debuggable" : "bound_tab_mismatch", matchesSession ? `Bound tab for session "${session.session}" is not debuggable (${tab.url ?? "unknown URL"}).` : `Target tab is not the tab bound to session "${session.session}".`, "Run \"opencli browser bind\" again on a debuggable http(s) tab.");
		if (session && !matchesSession && session.preferredTabId === null && isDebuggableUrl(tab.url)) {
			console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId}, moving back to ${session.windowId}`);
			try {
				await chrome.tabs.move(tabId, {
					windowId: session.windowId,
					index: -1
				});
				const moved = await chrome.tabs.get(tabId);
				if (moved.windowId === session.windowId && isDebuggableUrl(moved.url)) return {
					tabId,
					tab: moved
				};
			} catch (moveErr) {
				console.warn(`[opencli] Failed to move tab back: ${moveErr}`);
			}
		} else if (!isDebuggableUrl(tab.url)) console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
	} catch (err) {
		if (err instanceof CommandFailure) throw err;
		if (existingSession && !existingSession.owned) {
			automationSessions.delete(leaseKey);
			throw new CommandFailure("bound_tab_gone", `Bound tab for session "${existingSession.session}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
		}
		console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
	}
	const existingPreferredTabId = existingSession?.preferredTabId ?? null;
	if (existingSession && existingPreferredTabId !== null) {
		const session = existingSession;
		try {
			const preferredTab = await chrome.tabs.get(existingPreferredTabId);
			if (isDebuggableUrl(preferredTab.url)) return {
				tabId: preferredTab.id,
				tab: preferredTab
			};
			if (!session.owned) throw new CommandFailure("bound_tab_not_debuggable", `Bound tab for session "${session.session}" is not debuggable (${preferredTab.url ?? "unknown URL"}).`, "Switch the tab to an http(s) page or run \"opencli browser bind\" on another tab.");
		} catch (err) {
			if (err instanceof CommandFailure) throw err;
			if (session.tabPlacement === "existing-window") throw new CommandFailure("owned_tab_unavailable", "The automation tab could not be resolved. Create a new tab in this session.");
			await removeLeaseSession(leaseKey);
			if (!session.owned) throw new CommandFailure("bound_tab_gone", `Bound tab for session "${session.session}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
			return createOwnedTabLease(leaseKey, initialUrl);
		}
	}
	if (!existingSession || existingSession.owned && existingSession.preferredTabId === null) return createOwnedTabLease(leaseKey, initialUrl);
	if (existingSession?.tabPlacement === "existing-window") throw new CommandFailure("owned_tab_not_debuggable", "The automation tab is not debuggable; close it before creating a replacement.");
	const windowId = await getAutomationWindow(leaseKey, initialUrl);
	const role = getOwnedWindowRole(leaseKey);
	const group = existingSession?.owned ? await ensureOwnedContainerGroup(role, windowId, []) : null;
	const scopedWindowId = group?.windowId ?? windowId;
	const reusableTabId = await findReusableOwnedContainerTab(scopedWindowId, existingSession?.owned ? group?.id ?? null : void 0);
	if (reusableTabId !== void 0) return {
		tabId: reusableTabId,
		tab: await chrome.tabs.get(reusableTabId)
	};
	const tabs = await chrome.tabs.query({ windowId: scopedWindowId });
	const reuseTab = existingSession?.owned ? void 0 : tabs.find((t) => t.id);
	if (reuseTab?.id) {
		await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
		await new Promise((resolve) => setTimeout(resolve, 300));
		try {
			const updated = await chrome.tabs.get(reuseTab.id);
			if (isDebuggableUrl(updated.url)) return {
				tabId: reuseTab.id,
				tab: updated
			};
			console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
		} catch {}
	}
	const newTab = await chrome.tabs.create({
		windowId: scopedWindowId,
		url: BLANK_PAGE,
		active: true
	});
	if (!newTab.id) throw new Error("Failed to create tab in automation container");
	await ensureOwnedContainerGroup(role, scopedWindowId, [newTab.id]);
	return {
		tabId: newTab.id,
		tab: await chrome.tabs.get(newTab.id)
	};
}
/** Build a page-scoped success result with targetId resolved from tabId */
async function pageScopedResult(id, tabId, data) {
	return {
		id,
		ok: true,
		data,
		page: await resolveTargetId(tabId)
	};
}
/** Convenience wrapper returning just the tabId (used by most handlers) */
async function resolveTabId(tabId, leaseKey, initialUrl) {
	return (await resolveTab(tabId, leaseKey, initialUrl)).tabId;
}
async function listAutomationTabs(leaseKey) {
	const session = automationSessions.get(leaseKey);
	if (!session) return [];
	if (session.tabPlacement === "existing-window") return (await Promise.all((session.ownedTabIds ?? []).map((id) => chrome.tabs.get(id).catch(() => null)))).filter((tab) => tab !== null);
	if (session.preferredTabId !== null) try {
		return [await chrome.tabs.get(session.preferredTabId)];
	} catch {
		automationSessions.delete(leaseKey);
		return [];
	}
	try {
		return await chrome.tabs.query({ windowId: session.windowId });
	} catch {
		automationSessions.delete(leaseKey);
		return [];
	}
}
async function listAutomationWebTabs(leaseKey) {
	return (await listAutomationTabs(leaseKey)).filter((tab) => isDebuggableUrl(tab.url));
}
/**
* Derive the per-command CDP deadline from the command's absolute deadline
* (preferred — remaining budget absorbs service-worker wake and queueing
* latency) or the legacy duration field. Undercut by 5s so this (more
* specific) error reaches the CLI before the daemon's generic timer fires.
* Returns undefined when the command carries neither — callers fall back to
* the executor's default deadline.
*/
function commandCdpTimeoutMs(cmd) {
	if (typeof cmd.deadlineAt === "number" && cmd.deadlineAt > 0) return Math.max(1e4, cmd.deadlineAt - Date.now() - 5e3);
	if (typeof cmd.timeout === "number" && cmd.timeout > 0) return Math.max(1e4, cmd.timeout * 1e3 - 5e3);
}
/**
* Map an executor error to a machine-readable code so the CLI can decide
* retry safety without regex-matching message text:
* - `attach_failed` / `tab_gone`: failed BEFORE any page code ran — a new
*   logical attempt is safe;
* - `target_navigated`: the document changed under the command — the page
*   layer decides whether to settle-retry;
* - `detached_mid_command` / `cdp_timeout`: died MID-execution — the outcome
*   is unknown, a blind re-run could double-apply a write.
*/
function classifyExtensionError(message) {
	if (/Inspected target navigated|Target closed/.test(message)) return "target_navigated";
	if (/Detached while handling command/.test(message)) return "detached_mid_command";
	if (/CDP command .* timed out/.test(message)) return "cdp_timeout";
	if (/attach failed|Debugger is not attached/.test(message)) return "attach_failed";
	if (/No tab with id|no longer exists|No window with id/.test(message)) return "tab_gone";
}
function errorResult(id, err) {
	const message = err instanceof Error ? err.message : String(err);
	if (err instanceof CommandFailure || err instanceof ChromeApiError) return {
		id,
		ok: false,
		error: message,
		errorCode: err.code,
		...err.hint ? { errorHint: err.hint } : {}
	};
	const errorCode = classifyExtensionError(message);
	return {
		id,
		ok: false,
		error: message,
		...errorCode ? { errorCode } : {}
	};
}
async function handleExec(cmd, leaseKey) {
	if (!cmd.code) return {
		id: cmd.id,
		ok: false,
		error: "Missing code"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const aggressive = getSurfaceFromKey(leaseKey) === "browser";
		if (cmd.frameIndex != null) {
			const frames = enumerateCrossOriginFrames(await getFrameTree(tabId));
			if (cmd.frameIndex < 0 || cmd.frameIndex >= frames.length) return {
				id: cmd.id,
				ok: false,
				error: `Frame index ${cmd.frameIndex} out of range (${frames.length} cross-origin frames available)`
			};
			const data = await evaluateInFrame(tabId, cmd.code, frames[cmd.frameIndex].frameId, aggressive, commandCdpTimeoutMs(cmd));
			return pageScopedResult(cmd.id, tabId, data);
		}
		const data = await evaluateAsync(tabId, cmd.code, aggressive, commandCdpTimeoutMs(cmd));
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function handleFrames(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const tree = await getFrameTree(tabId);
		return {
			id: cmd.id,
			ok: true,
			data: enumerateCrossOriginFrames(tree)
		};
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
function preferOwnedTab(leaseKey, tabId) {
	const session = automationSessions.get(leaseKey);
	if (!session?.owned) return;
	setLeaseSession(leaseKey, {
		session: session.session,
		surface: session.surface,
		kind: session.kind,
		windowId: session.windowId,
		owned: true,
		preferredTabId: tabId
	});
}
async function handleNavigate(cmd, leaseKey) {
	if (!cmd.url) return {
		id: cmd.id,
		ok: false,
		error: "Missing url"
	};
	if (!isSafeNavigationUrl(cmd.url)) return {
		id: cmd.id,
		ok: false,
		error: "Blocked URL scheme -- only http:// and https:// are allowed"
	};
	const resolved = await resolveTab(await resolveCommandTabId(cmd), leaseKey);
	const tabId = resolved.tabId;
	const beforeTab = resolved.tab ?? await chrome.tabs.get(tabId);
	const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
	const targetUrl = cmd.url;
	if (getTabPlacement(leaseKey) === "existing-window") await ensureAttached(tabId, true);
	if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) return pageScopedResult(cmd.id, tabId, {
		title: beforeTab.title,
		url: beforeTab.url,
		timedOut: false
	});
	if (!hasActiveNetworkCapture(tabId) && getTabPlacement(leaseKey) !== "existing-window") await detach(tabId);
	await chrome.tabs.update(tabId, { url: targetUrl });
	let timedOut = false;
	await new Promise((resolve) => {
		let settled = false;
		let checkTimer = null;
		let timeoutTimer = null;
		const finish = () => {
			if (settled) return;
			settled = true;
			chrome.tabs.onUpdated.removeListener(listener);
			if (checkTimer) clearTimeout(checkTimer);
			if (timeoutTimer) clearTimeout(timeoutTimer);
			resolve();
		};
		const isNavigationDone = (url) => {
			return isTargetUrl(url, targetUrl) || normalizeUrlForComparison(url) !== beforeNormalized;
		};
		const listener = (id, info, tab) => {
			if (id !== tabId) return;
			if (info.status === "complete" && isNavigationDone(tab.url ?? info.url)) finish();
		};
		chrome.tabs.onUpdated.addListener(listener);
		checkTimer = setTimeout(async () => {
			try {
				const currentTab = await chrome.tabs.get(tabId);
				if (currentTab.status === "complete" && isNavigationDone(currentTab.url)) finish();
			} catch {}
		}, 100);
		timeoutTimer = setTimeout(() => {
			timedOut = true;
			console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`);
			finish();
		}, 15e3);
	});
	let tab = await chrome.tabs.get(tabId);
	const postNavigationSession = automationSessions.get(leaseKey);
	if (postNavigationSession?.tabPlacement === "existing-window" && tab.windowId !== postNavigationSession.windowId) {
		postNavigationSession.windowId = tab.windowId;
		await persistRuntimeState();
	} else if (postNavigationSession && tab.windowId !== postNavigationSession.windowId) {
		console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId} during navigation, moving back to ${postNavigationSession.windowId}`);
		try {
			await chrome.tabs.move(tabId, {
				windowId: postNavigationSession.windowId,
				index: -1
			});
			tab = await chrome.tabs.get(tabId);
		} catch (moveErr) {
			console.warn(`[opencli] Failed to recover drifted tab: ${moveErr}`);
		}
	}
	return pageScopedResult(cmd.id, tabId, {
		title: tab.title,
		url: tab.url,
		timedOut
	});
}
async function handleTabs(cmd, leaseKey) {
	const session = automationSessions.get(leaseKey);
	if (session && !session.owned && ![
		"list",
		"retain",
		"borrow",
		"close-retained"
	].includes(cmd.op ?? "")) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_mutation_blocked",
		error: `Session "${session.session}" is bound to a user tab; tab new/select/close requires an owned OpenCLI session.`,
		errorHint: "Unbind the session first, or use a different session for owned OpenCLI tabs."
	};
	switch (cmd.op) {
		case "borrow":
		case "retain": return withLeaseMutation(async () => {
			const tabId = cmd.page ? await resolveCommandTabId(cmd) : Number.isInteger(cmd.tabId) && cmd.tabId > 0 ? cmd.tabId : void 0;
			if (tabId === void 0) throw new CommandFailure("missing_page", "Retaining a challenge requires its exact page ID.");
			const tab = await chrome.tabs.get(tabId);
			const current = automationSessions.get(leaseKey);
			if (cmd.op === "retain" && current?.owned && !(current.ownedTabIds ?? [current.preferredTabId]).includes(tabId)) throw new CommandFailure("tab_not_owned", "The challenge tab does not belong to this session.");
			if (cmd.op === "borrow") {
				if (!isDebuggableUrl(tab.url)) throw new CommandFailure("bound_tab_not_debuggable", "The requested page is not debuggable.");
				if ([...automationSessions.entries()].some(([key, lease]) => key !== leaseKey && (lease.ownedTabIds ?? [lease.preferredTabId]).includes(tabId))) throw new CommandFailure("session_busy", "The requested page is in use by another session.");
				if (current && !(current.ownedTabIds ?? [current.preferredTabId]).includes(tabId)) await releaseLease(leaseKey, "borrow ordinary page");
			}
			if (current?.owned && (current.ownedTabIds ?? [current.preferredTabId]).includes(tabId)) {
				const remaining = (current.ownedTabIds ?? [tabId]).filter((id) => id !== tabId);
				setLeaseSession(leaseKey, {
					...current,
					owned: remaining.length > 0,
					preferredTabId: remaining[0] ?? tabId,
					ownedTabIds: remaining
				});
				await releaseLease(leaseKey, "challenge retained");
			}
			setLeaseSession(leaseKey, {
				session: getSessionFromKey(leaseKey),
				surface: getSurfaceFromKey(leaseKey),
				kind: "bound",
				owned: false,
				windowId: tab.windowId,
				preferredTabId: tabId,
				ownedTabIds: [tabId]
			});
			resetWindowIdleTimer(leaseKey);
			return pageScopedResult(cmd.id, tabId, {
				retained: true,
				title: tab.title,
				url: tab.url
			});
		});
		case "close-retained": return withLeaseMutation(async () => {
			let tabId;
			try {
				tabId = await resolveCommandTabId(cmd);
			} catch {
				return {
					id: cmd.id,
					ok: true,
					data: { missing: true }
				};
			}
			if (tabId === void 0) throw new CommandFailure("missing_page", "Closing a retained challenge requires its exact page ID.");
			if ([...automationSessions.values()].some((s) => s.owned && (s.ownedTabIds ?? [s.preferredTabId]).includes(tabId))) throw new CommandFailure("session_busy", "The retained tab is now in use.");
			await removeTabWithDialogProtection(tabId);
			evictTab(tabId);
			return {
				id: cmd.id,
				ok: true,
				data: { closed: cmd.page }
			};
		});
		case "list": {
			const tabs = await listAutomationWebTabs(leaseKey);
			const data = await Promise.all(tabs.map(async (t, i) => {
				let page;
				try {
					page = t.id ? await resolveTargetId(t.id) : void 0;
				} catch {}
				return {
					index: i,
					page,
					url: t.url,
					title: t.title,
					active: t.active
				};
			}));
			return {
				id: cmd.id,
				ok: true,
				data
			};
		}
		case "new": {
			if (cmd.url && !isSafeNavigationUrl(cmd.url)) return {
				id: cmd.id,
				ok: false,
				error: "Blocked URL scheme -- only http:// and https:// are allowed"
			};
			if (!automationSessions.has(leaseKey) || getTabPlacement(leaseKey) === "existing-window") {
				const created = await createOwnedTabLease(leaseKey, cmd.url);
				return pageScopedResult(cmd.id, created.tabId, { url: created.tab?.url });
			}
			const windowId = await getAutomationWindow(leaseKey);
			let tab = await chrome.tabs.create({
				windowId,
				url: cmd.url ?? BLANK_PAGE,
				active: true
			});
			const tabId = tab.id;
			if (!tabId) return {
				id: cmd.id,
				ok: false,
				error: "Failed to create tab"
			};
			const sessionWindowId = (await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), windowId, [tabId]))?.windowId ?? tab.windowId;
			if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);
			setLeaseSession(leaseKey, {
				session: getSessionFromKey(leaseKey),
				surface: getSurfaceFromKey(leaseKey),
				kind: "owned",
				windowId: sessionWindowId,
				owned: true,
				preferredTabId: tabId
			});
			resetWindowIdleTimer(leaseKey);
			return pageScopedResult(cmd.id, tabId, { url: tab.url });
		}
		case "close": {
			if (cmd.index !== void 0) {
				const target = (await listAutomationWebTabs(leaseKey))[cmd.index];
				if (!target?.id) return {
					id: cmd.id,
					ok: false,
					error: `Tab index ${cmd.index} not found`
				};
				const closedPage = await resolveTargetId(target.id).catch(() => void 0);
				const currentSession = automationSessions.get(leaseKey);
				if (currentSession?.tabPlacement === "existing-window") await closeExistingLeaseTab(leaseKey, target.id);
				else if (currentSession?.preferredTabId === target.id) await releaseLease(leaseKey, "tab close");
				else await removeTabWithDialogProtection(target.id);
				return {
					id: cmd.id,
					ok: true,
					data: { closed: closedPage }
				};
			}
			if (cmd.page !== void 0 && session?.owned) {
				let tabId;
				try {
					tabId = await resolveCommandTabId(cmd);
				} catch {
					return {
						id: cmd.id,
						ok: false,
						error: `Page no longer exists`
					};
				}
				if (tabId === void 0) return {
					id: cmd.id,
					ok: false,
					error: `Page no longer exists`
				};
				let tab;
				try {
					tab = await chrome.tabs.get(tabId);
				} catch {
					return {
						id: cmd.id,
						ok: false,
						error: `Page no longer exists`
					};
				}
				if (tab.windowId !== session.windowId || session.tabPlacement === "existing-window" && !session.ownedTabIds?.includes(tabId)) return {
					id: cmd.id,
					ok: false,
					error: `Page is not in the automation container`
				};
				const closedPage = await resolveTargetId(tabId).catch(() => void 0);
				if (session.tabPlacement === "existing-window") await closeExistingLeaseTab(leaseKey, tabId);
				else if (session.preferredTabId === tabId) await releaseLease(leaseKey, "tab close");
				else await removeTabWithDialogProtection(tabId);
				return {
					id: cmd.id,
					ok: true,
					data: { closed: closedPage }
				};
			}
			const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
			const closedPage = await resolveTargetId(tabId).catch(() => void 0);
			const currentSession = automationSessions.get(leaseKey);
			if (currentSession?.tabPlacement === "existing-window") await closeExistingLeaseTab(leaseKey, tabId);
			else if (currentSession?.preferredTabId === tabId) await releaseLease(leaseKey, "tab close");
			else await removeTabWithDialogProtection(tabId);
			return {
				id: cmd.id,
				ok: true,
				data: { closed: closedPage }
			};
		}
		case "select": {
			if (cmd.index === void 0 && cmd.page === void 0) return {
				id: cmd.id,
				ok: false,
				error: "Missing index or page"
			};
			const cmdTabId = await resolveCommandTabId(cmd);
			if (cmdTabId !== void 0) {
				const session = automationSessions.get(leaseKey);
				let tab;
				try {
					tab = await chrome.tabs.get(cmdTabId);
				} catch {
					return {
						id: cmd.id,
						ok: false,
						error: `Page no longer exists`
					};
				}
				if (!session || tab.windowId !== session.windowId || session.tabPlacement === "existing-window" && !session.ownedTabIds?.includes(cmdTabId)) return {
					id: cmd.id,
					ok: false,
					error: `Page is not in the automation container`
				};
				if (getTabPlacement(leaseKey) !== "existing-window") await chrome.tabs.update(cmdTabId, { active: true });
				preferOwnedTab(leaseKey, cmdTabId);
				return pageScopedResult(cmd.id, cmdTabId, { selected: true });
			}
			const target = (await listAutomationWebTabs(leaseKey))[cmd.index];
			if (!target?.id) return {
				id: cmd.id,
				ok: false,
				error: `Tab index ${cmd.index} not found`
			};
			if (getTabPlacement(leaseKey) !== "existing-window") await chrome.tabs.update(target.id, { active: true });
			preferOwnedTab(leaseKey, target.id);
			return pageScopedResult(cmd.id, target.id, { selected: true });
		}
		default: return {
			id: cmd.id,
			ok: false,
			error: `Unknown tabs op: ${cmd.op}`
		};
	}
}
async function handleCookies(cmd) {
	if (!cmd.domain && !cmd.url) return {
		id: cmd.id,
		ok: false,
		error: "Cookie scope required: provide domain or url to avoid dumping all cookies"
	};
	const details = {};
	if (cmd.domain) details.domain = cmd.domain;
	if (cmd.url) details.url = cmd.url;
	const data = (await chrome.cookies.getAll(details)).map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		secure: c.secure,
		httpOnly: c.httpOnly,
		expirationDate: c.expirationDate
	}));
	return {
		id: cmd.id,
		ok: true,
		data
	};
}
async function handleScreenshot(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const data = await screenshot(tabId, {
			format: cmd.format,
			quality: cmd.quality,
			fullPage: cmd.fullPage,
			width: cmd.width,
			height: cmd.height
		});
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
/** CDP methods permitted via the 'cdp' passthrough action. */
var CDP_ALLOWLIST = /* @__PURE__ */ new Set([
	"Accessibility.enable",
	"Accessibility.getFullAXTree",
	"DOM.enable",
	"DOM.getDocument",
	"DOM.getBoxModel",
	"DOM.getContentQuads",
	"DOM.focus",
	"DOM.querySelector",
	"DOM.querySelectorAll",
	"DOM.scrollIntoViewIfNeeded",
	"DOMSnapshot.captureSnapshot",
	"Input.dispatchMouseEvent",
	"Input.dispatchKeyEvent",
	"Input.insertText",
	"Page.getLayoutMetrics",
	"Page.captureScreenshot",
	"Page.getFrameTree",
	"Page.handleJavaScriptDialog",
	"Runtime.enable",
	"Emulation.setDeviceMetricsOverride",
	"Emulation.clearDeviceMetricsOverride",
	"Emulation.setFocusEmulationEnabled"
]);
async function handleCdp(cmd, leaseKey) {
	if (!cmd.cdpMethod) return {
		id: cmd.id,
		ok: false,
		error: "Missing cdpMethod"
	};
	if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) return {
		id: cmd.id,
		ok: false,
		error: `CDP method not permitted: ${cmd.cdpMethod}`
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const aggressive = getSurfaceFromKey(leaseKey) === "browser";
		await ensureAttached(tabId, aggressive);
		const params = cmd.cdpParams ?? {};
		const routeFrameId = typeof params.frameId === "string" && params.sessionId === "target" ? params.frameId : void 0;
		const routeTargetUrl = typeof params.targetUrl === "string" ? params.targetUrl : void 0;
		const data = routeFrameId ? await sendCommandInFrameTarget(tabId, routeFrameId, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, true), aggressive, commandCdpTimeoutMs(cmd) ?? 3e4, routeTargetUrl) : await sendDebuggerCommand({ tabId }, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, false), commandCdpTimeoutMs(cmd));
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
function stripOpenCliFrameRoutingParams(params, stripFrameId) {
	const { sessionId, frameId, targetUrl, ...rest } = params;
	if (!stripFrameId && frameId !== void 0) return {
		...rest,
		frameId
	};
	return rest;
}
async function handleCloseWindow(cmd, leaseKey) {
	if (cmd.action === "close-owned-tab") return withLeaseMutation(async () => {
		if ((activeCommandCounts.get(leaseKey) ?? 0) > 1) throw new CommandFailure("session_busy", "Cannot close a tab while another command is using this session.");
		closingLeases.add(leaseKey);
		let closingTabId;
		try {
			const session = automationSessions.get(leaseKey);
			if (!session?.owned) {
				await releaseLease(leaseKey, "explicit close");
				return {
					id: cmd.id,
					ok: true,
					data: {
						closed: true,
						session: getSessionFromKey(leaseKey),
						tabCleanup: "no-owned-tab"
					}
				};
			}
			const tabId = session.preferredTabId;
			if (tabId === null) throw new CommandFailure("owned_tab_identity_missing", "Cannot close an owned lease without a tab identity.");
			if ([...automationSessions.entries()].some(([key, lease]) => key !== leaseKey && lease.preferredTabId === tabId)) throw new CommandFailure("session_busy", "Another session also uses this tab; release that session before closing it.");
			closingTabId = tabId;
			closingTabs.add(tabId);
			const tab = await chrome.tabs.get(tabId);
			if (session.tabPlacement !== "existing-window" && tab.groupId !== void 0 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) await chrome.tabs.ungroup(tabId);
			if (session.tabPlacement === "existing-window") await closeExistingLeaseTab(leaseKey, tabId);
			else {
				await safeDetach(tabId);
				await chrome.tabs.remove(tabId);
				evictTab(tabId);
				await removeLeaseSession(leaseKey);
			}
			return {
				id: cmd.id,
				ok: true,
				data: {
					closed: true,
					session: session.session,
					tabCleanup: "closed-owned-tab"
				}
			};
		} finally {
			closingLeases.delete(leaseKey);
			if (closingTabId !== void 0) closingTabs.delete(closingTabId);
		}
	});
	const sessionName = automationSessions.get(leaseKey)?.session ?? getSessionFromKey(leaseKey);
	await releaseLease(leaseKey, "explicit close");
	return {
		id: cmd.id,
		ok: true,
		data: {
			closed: true,
			session: sessionName
		}
	};
}
async function handleSetFileInput(cmd, leaseKey) {
	if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) return {
		id: cmd.id,
		ok: false,
		error: "Missing or empty files array"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		await setFileInputFiles(tabId, cmd.files, cmd.selector);
		return pageScopedResult(cmd.id, tabId, { count: cmd.files.length });
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function handleInsertText(cmd, leaseKey) {
	if (typeof cmd.text !== "string") return {
		id: cmd.id,
		ok: false,
		error: "Missing text payload"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		await insertText(tabId, cmd.text);
		return pageScopedResult(cmd.id, tabId, { inserted: true });
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function handleCredentialFill(cmd, leaseKey, defaultSubmit) {
	try {
		const request = normalizeCredentialFillRequest(cmd, defaultSubmit);
		if (!request) return {
			id: cmd.id,
			ok: false,
			error: "Missing or invalid credential payload"
		};
		if (!defaultSubmit) request.submit = false;
		const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
		const selected = await runCredentialFillOnTab(tabId, request);
		return pageScopedResult(cmd.id, tabId, selected ? {
			...selected.result,
			frameId: selected.frameId
		} : {
			ok: false,
			host: "",
			username_filled: false,
			password_filled: false,
			submitted: false,
			reason: "no_frame_result"
		});
	} catch {
		return {
			id: cmd.id,
			ok: false,
			errorCode: "credential_fill_failed",
			error: "Credential fill failed"
		};
	}
}
async function handleNetworkCaptureStart(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		await startNetworkCapture(tabId, cmd.pattern);
		return pageScopedResult(cmd.id, tabId, { started: true });
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function handleNetworkCaptureRead(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const data = await readNetworkCapture(tabId, cmd.retainIncomplete === true);
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function handleWaitDownload(cmd) {
	try {
		const data = await waitForDownload(cmd.pattern ?? "", cmd.timeoutMs ?? 3e4);
		return {
			id: cmd.id,
			ok: true,
			data
		};
	} catch (err) {
		return errorResult(cmd.id, err);
	}
}
async function releaseLease(leaseKey, reason = "released") {
	const session = automationSessions.get(leaseKey);
	if (!session) {
		sessionOverrides.delete(leaseKey);
		scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
		await persistRuntimeState();
		return;
	}
	if (session.idleTimer) clearTimeout(session.idleTimer);
	scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
	if (session.owned) {
		const tabId = session.preferredTabId;
		if (tabId !== null) {
			const hasOtherOwnedLease = [...automationSessions.entries()].some(([otherLease, otherSession]) => otherLease !== leaseKey && otherSession.owned && otherSession.windowId === session.windowId && otherSession.preferredTabId !== null);
			await safeDetach(tabId);
			evictTab(tabId);
			if (session.tabPlacement === "existing-window") for (const ownedId of session.ownedTabIds ?? [tabId]) await removeTabWithDialogProtection(ownedId);
			else if (hasOtherOwnedLease) {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
			} else try {
				const tab = await chrome.tabs.update(tabId, {
					url: BLANK_PAGE,
					active: true
				});
				const group = await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), session.windowId, [tab.id ?? tabId]);
				if (group) session.windowId = group.windowId;
				console.log(`[opencli] Released owned tab lease ${tabId} as reusable placeholder (session=${session.session}, surface=${session.surface}, ${reason})`);
			} catch {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
			}
		} else console.log(`[opencli] Released legacy owned window lease ${session.windowId} without closing container (session=${session.session}, surface=${session.surface}, ${reason})`);
	} else if (session.preferredTabId !== null) {
		await safeDetach(session.preferredTabId);
		console.log(`[opencli] Detached borrowed tab lease ${session.preferredTabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
	}
	automationSessions.delete(leaseKey);
	sessionOverrides.delete(leaseKey);
	await persistRuntimeState();
}
async function reconcileTargetLeaseRegistry() {
	const registry = await readRegistry();
	interactiveGroupLedger.clear();
	for (const id of registry.ownedContainers.interactive.groupIds) interactiveGroupLedger.add(id);
	for (const role of Object.keys(ownedContainers)) {
		ownedContainers[role].windowId = registry.ownedContainers[role]?.windowId ?? null;
		const windowId = ownedContainers[role].windowId;
		if (windowId !== null) try {
			await chrome.windows.get(windowId);
		} catch {
			ownedContainers[role].windowId = null;
		}
	}
	automationSessions.clear();
	for (const [leaseKey, stored] of Object.entries(registry.leases)) {
		const tabId = stored.preferredTabId;
		if (tabId === null) continue;
		try {
			const tab = await chrome.tabs.get(tabId);
			if (!isDebuggableUrl(tab.url)) continue;
			if (stored.lifecycle === "ephemeral" || stored.lifecycle === "persistent" || stored.lifecycle === "pinned") setSessionOverride(leaseKey, { lifecycle: stored.lifecycle });
			const session = makeSession(leaseKey, {
				session: typeof stored.session === "string" ? stored.session : getSessionFromKey(leaseKey),
				surface: stored.surface === "adapter" ? "adapter" : getSurfaceFromKey(leaseKey),
				kind: stored.kind === "bound" || stored.owned === false ? "bound" : "owned",
				windowId: tab.windowId,
				owned: stored.owned,
				tabPlacement: stored.tabPlacement,
				ownedTabIds: stored.ownedTabIds,
				preferredTabId: tabId
			});
			const timeout = getIdleTimeout(leaseKey);
			automationSessions.set(leaseKey, {
				...session,
				idleTimer: null,
				idleDeadlineAt: stored.idleDeadlineAt
			});
			if (session.owned && session.tabPlacement !== "existing-window") {
				const role = getOwnedWindowRole(leaseKey);
				if (ownedContainers[role].windowId === null) ownedContainers[role].windowId = tab.windowId;
				const group = await ensureOwnedContainerGroup(role, tab.windowId, [tabId]);
				if (group) {
					const current = automationSessions.get(leaseKey);
					if (current) current.windowId = group.windowId;
				}
			}
			const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
			if (timeout > 0) {
				if (remaining <= 0) await releaseLease(leaseKey, "reconciled idle expiry");
				else resetWindowIdleTimer(leaseKey, remaining);
			}
		} catch {}
	}
	try {
		if (interactiveGroupLedger.size || [...automationSessions.values()].some((s) => s.owned && s.tabPlacement !== "existing-window" && s.surface === "browser")) await ensureOwnedContainerGroup("interactive", null, []);
	} catch (err) {
		console.warn(`[opencli] Startup interactive group convergence failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	await persistRuntimeState();
}
async function handleBind(cmd, leaseKey) {
	if (automationSessions.get(leaseKey)?.owned) await releaseLease(leaseKey, "rebind");
	const activeTabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true
	});
	const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
	const boundTab = activeTabs.find((tab) => isDebuggableUrl(tab.url)) ?? fallbackTabs.find((tab) => isDebuggableUrl(tab.url));
	if (!boundTab?.id) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_not_found",
		error: "No debuggable tab found in the current window",
		errorHint: "Focus the target Chrome tab/window, then retry bind."
	};
	const current = automationSessions.get(leaseKey);
	if (current && !current.owned && current.preferredTabId !== null && current.preferredTabId !== boundTab.id) await detach(current.preferredTabId).catch(() => {});
	setLeaseSession(leaseKey, {
		session: getSessionFromKey(leaseKey),
		surface: getSurfaceFromKey(leaseKey),
		kind: "bound",
		windowId: boundTab.windowId,
		owned: false,
		preferredTabId: boundTab.id
	});
	resetWindowIdleTimer(leaseKey);
	console.log(`[opencli] Session ${getSessionFromKey(leaseKey)} explicitly bound to tab ${boundTab.id} (${boundTab.url})`);
	return pageScopedResult(cmd.id, boundTab.id, {
		url: boundTab.url,
		title: boundTab.title,
		session: getSessionFromKey(leaseKey)
	});
}
//#endregion
