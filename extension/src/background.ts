import { isTranscriptionModel, TRANSCRIPTION_MODEL } from "./shared";
import type { ActiveSession, Message, SessionMetadata, TranscriptionModel } from "./shared";

const SESSION_KEY = "activeSession";
const ERROR_KEY = "lastCaptureError";
const PENDING_REPORT_KEY = "pendingReport";
const OFFSCREEN_URL = "offscreen.html";
const AUTO_STOP_ALARM_PREFIX = "cyclone-submit-";
const AUTO_STOP_DELAY_MINUTES = 0.5;
const UPLOAD_ALARM = "cyclone-upload-retry";
const UPLOAD_CONSENT_KEY = "hostedTranscriptionConsentV1";
const UPLOAD_STATUS_KEY = "reportUploadStatus";
const TRANSCRIPTION_MODEL_KEY = "transcriptionModel";

type PendingReport = {
  sessionId: string;
  sourceHash: string;
  sourcePath: string;
  transcriptionModel?: TranscriptionModel;
  rawUrl?: string;
  rawDownloadId?: number;
  rawComplete?: boolean;
  rawRetries?: number;
  reportUrl?: string;
  reportDownloadId?: number;
  reportComplete?: boolean;
  reportFailed?: boolean;
};

function autoStopAlarmName(sessionId: string): string {
  return `${AUTO_STOP_ALARM_PREFIX}${sessionId}`;
}

async function showError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await chrome.storage.local.set({ [ERROR_KEY]: message });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  await chrome.action.setBadgeText({ text: "!" });
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "capture-error", message }).catch(() => undefined);
  console.error("Cyclone capture:", error);
}

async function activeSession(): Promise<ActiveSession | undefined> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return stored[SESSION_KEY] as ActiveSession | undefined;
}

async function pendingReport(): Promise<PendingReport | undefined> {
  const stored = await chrome.storage.local.get(PENDING_REPORT_KEY);
  return stored[PENDING_REPORT_KEY] as PendingReport | undefined;
}

async function requestReport(pending: PendingReport): Promise<void> {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    type: "offscreen-process", sessionId: pending.sessionId, sourceHash: pending.sourceHash, sourcePath: pending.sourcePath,
    model: pending.transcriptionModel ?? TRANSCRIPTION_MODEL
  } satisfies Message);
  if (!response?.ok) throw new Error(response?.error ?? "Could not start local report creation.");
}

async function finishReport(pending: PendingReport): Promise<void> {
  if (!pending.reportUrl || !pending.rawComplete) return;
  const response = await chrome.runtime.sendMessage({ type: "offscreen-cleanup", sessionId: pending.sessionId, url: pending.reportUrl } satisfies Message);
  if (!response?.ok) throw new Error(response?.error ?? "Could not clean up the saved session after report download.");
  await chrome.storage.local.remove(PENDING_REPORT_KEY);
  await chrome.action.setBadgeText({ text: "" });
  await chrome.storage.local.remove(ERROR_KEY);
}

async function abandonReport(pending: PendingReport, reason: string): Promise<void> {
  if (pending.rawComplete) {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({ type: "offscreen-cleanup", sessionId: pending.sessionId, url: pending.reportUrl } satisfies Message);
    if (!response?.ok) throw new Error(response?.error ?? "Could not clean up the failed report.");
    await chrome.storage.local.remove(PENDING_REPORT_KEY);
  }
  await showError(new Error(reason));
}

async function handleDownloadChange(delta: chrome.downloads.DownloadDelta): Promise<void> {
  let retryId: number | undefined;
  await navigator.locks.request("cyclone-report-download", async () => {
    const pending = await pendingReport();
    if (!pending) return;
    if (delta.id === pending.rawDownloadId && delta.state?.current && pending.rawUrl) {
      if (delta.state.current === "complete") {
        await chrome.runtime.sendMessage({ type: "offscreen-revoke", url: pending.rawUrl } satisfies Message);
        const updated = { ...pending, rawUrl: undefined, rawComplete: true } satisfies PendingReport;
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: updated });
        if (updated.reportComplete) await finishReport(updated);
        else if (updated.reportFailed) await abandonReport(updated, "The local report was not saved. The raw session ZIP remains available.");
      } else if ((pending.rawRetries ?? 0) < 1) {
        await ensureOffscreen();
        const restored = await chrome.runtime.sendMessage({ type: "offscreen-raw", sessionId: pending.sessionId, sourceHash: pending.sourceHash } satisfies Message);
        if (!restored?.ok) throw new Error(restored?.error ?? "Could not restore the raw session ZIP for retry.");
        await chrome.runtime.sendMessage({ type: "offscreen-revoke", url: pending.rawUrl } satisfies Message).catch(() => undefined);
        retryId = await chrome.downloads.download({ url: restored.url, filename: pending.sourcePath, saveAs: false, conflictAction: "uniquify" });
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: { ...pending, rawUrl: restored.url, rawDownloadId: retryId, rawRetries: 1 } satisfies PendingReport });
      } else {
        await showError(new Error("The raw session ZIP download failed twice. Cyclone has kept the recording in browser storage; reload the extension to retry saving it."));
      }
    }
    if (delta.id === pending.reportDownloadId && delta.state?.current) {
      if (delta.state.current === "complete") {
        const updated = { ...pending, reportComplete: true } satisfies PendingReport;
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: updated });
        await finishReport(updated);
      } else {
        const updated = { ...pending, reportFailed: true } satisfies PendingReport;
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: updated });
        await abandonReport(updated, "The local report download was interrupted; its raw session ZIP remains available.");
      }
    }
  });
  if (retryId !== undefined) {
    const [retry] = await chrome.downloads.search({ id: retryId });
    if (retry?.state === "complete") await handleDownloadChange({ id: retryId, state: { current: "complete" } });
  }
}

async function resumePendingReport(): Promise<void> {
  let pending = await pendingReport();
  if (!pending) return;
  if (!pending.rawComplete && pending.rawDownloadId !== undefined) {
    const rawId = pending.rawDownloadId;
    const [raw] = await chrome.downloads.search({ id: rawId });
    if (raw?.state === "complete" || raw?.state === "interrupted") {
      if (raw.state === "interrupted" && (pending.rawRetries ?? 0) >= 1) {
        pending = { ...pending, rawRetries: 0 };
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: pending });
      }
      await handleDownloadChange({ id: rawId, state: { current: raw.state } });
      pending = await pendingReport();
      if (!pending) return;
    }
  }
  if (pending.reportFailed) {
    await abandonReport(pending, "The local report was not saved. The raw session ZIP remains available.");
    return;
  }
  if (pending.reportDownloadId !== undefined) {
    const [download] = await chrome.downloads.search({ id: pending.reportDownloadId });
    if (download?.state === "complete") {
      await handleDownloadChange({ id: pending.reportDownloadId, state: { current: "complete" } });
      return;
    }
    if (download?.state === "in_progress") return;
    if (pending.reportFailed || download?.state === "interrupted") {
      const updated = { ...pending, reportFailed: true } satisfies PendingReport;
      await chrome.storage.local.set({ [PENDING_REPORT_KEY]: updated });
      await abandonReport(updated, "The local report download was interrupted; its raw session ZIP remains available.");
      return;
    }
    if (pending.reportUrl) await chrome.runtime.sendMessage({ type: "offscreen-revoke", url: pending.reportUrl } satisfies Message).catch(() => undefined);
    await chrome.storage.local.set({ [PENDING_REPORT_KEY]: { ...pending, reportUrl: undefined, reportDownloadId: undefined } satisfies PendingReport });
  }
  await requestReport(pending);
}

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const runtimeApi = chrome.runtime as typeof chrome.runtime & { getContexts(options: object): Promise<unknown[]> };
  const contexts = await runtimeApi.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length === 0) {
    await (chrome.offscreen as typeof chrome.offscreen & { createDocument(options: object): Promise<void> }).createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "BLOBS"],
      justification: "Record the user's microphone and assemble a local session export."
    });
  }
}

async function begin(tab: chrome.tabs.Tab, openPermissionTab = true): Promise<void> {
  const consent = await chrome.storage.local.get(UPLOAD_CONSENT_KEY);
  if (consent[UPLOAD_CONSENT_KEY] !== true) throw new Error("Open Cyclone and agree to hosted audio transcription and private report upload before recording.");
  if (await pendingReport()) throw new Error("Cyclone is still preparing the previous session report. Try again when the ASR badge clears.");
  if (!tab.id) {
    throw new Error("Open a LeetCode problem page before recording.");
  }
  const sessionId = crypto.randomUUID();
  const savedModel = (await chrome.storage.local.get(TRANSCRIPTION_MODEL_KEY))[TRANSCRIPTION_MODEL_KEY];
  const transcriptionModel = isTranscriptionModel(savedModel) ? savedModel : TRANSCRIPTION_MODEL;
  const requestedAt = new Date().toISOString();
  await ensureOffscreen();
  const response = await chrome.tabs.sendMessage(tab.id, { type: "capture-start" }).catch(() => {
    throw new Error("Cyclone is not attached to this page. Reload the LeetCode problem tab once, then try again.");
  });
  if (!response?.ok) throw new Error(response?.error ?? "Could not read the LeetCode editor. Reload the problem page and try again.");
  if (!/^https:\/\/(?:[^/]+\.)?leetcode\.com\/problems\//.test(response.metadata?.problemUrl ?? "")) {
    throw new Error("Open a LeetCode problem page before recording.");
  }

  const metadata: SessionMetadata = { sessionId, startedAt: requestedAt, ...response.metadata };
  const mic = await chrome.runtime.sendMessage({ type: "offscreen-start", metadata } satisfies Message);
  if (!mic?.ok) {
    const permissionFailure = ["NotAllowedError", "PermissionDismissedError", "SecurityError"].includes(mic?.errorName) ||
      /permission (?:denied|dismissed)|notallowederror/i.test(String(mic?.error ?? ""));
    if (permissionFailure) {
      if (!openPermissionTab) {
        throw new Error("Cyclone needs lasting microphone access to record without an open tab. Start again and choose 'Allow while visiting the site' in Chrome's prompt.");
      }
      await chrome.storage.local.remove(ERROR_KEY);
      await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
      await chrome.action.setBadgeText({ text: "MIC" });
      await chrome.tabs.create({ url: `${chrome.runtime.getURL("permission.html")}?tabId=${tab.id}`, active: true });
      return;
    }
    throw new Error(mic?.error ?? "Microphone recording could not start.");
  }

  const startedAtMs = mic.startedAtMs as number;
  const startedAt = mic.startedAt as string;
  metadata.startedAt = startedAt;
  await chrome.storage.local.set({ [SESSION_KEY]: { sessionId, tabId: tab.id, startedAtMs, startedAt, transcriptionModel } satisfies ActiveSession });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.storage.local.remove(ERROR_KEY);
  await chrome.tabs.sendMessage(tab.id, { type: "capture-recording", recording: true });
}

async function endOnce(session: ActiveSession): Promise<void> {
  await chrome.alarms.clear(autoStopAlarmName(session.sessionId));
  await chrome.tabs.sendMessage(session.tabId, { type: "capture-recording", recording: false }).catch(() => undefined);
  const final = await chrome.tabs.sendMessage(session.tabId, { type: "capture-final" }).catch(() => undefined);
  if (typeof final?.code === "string") {
    const saved = await chrome.runtime.sendMessage({
      type: "offscreen-event",
      event: { type: "code", code: final.code, language: final.language, tMs: Date.now() - session.startedAtMs }
    } satisfies Message);
    if (!saved?.ok) throw new Error("Could not save the final code state.");
  }
  const endedAt = new Date().toISOString();
  const response = await chrome.runtime.sendMessage({ type: "offscreen-stop", endedAt } satisfies Message);
  await chrome.storage.local.remove(SESSION_KEY);
  if (!response?.ok) throw new Error(response?.error ?? "Could not finish the session export.");
  const sourcePath = `Cyclone/Sessions/cyclone-${session.startedAt.slice(0, 10)}-${session.sessionId.slice(0, 8)}.zip`;
  const download = await chrome.downloads.download({
    url: response.url,
    filename: sourcePath,
    saveAs: false,
    conflictAction: "uniquify"
  });
  const pending: PendingReport = { sessionId: session.sessionId, sourceHash: response.sourceHash, sourcePath,
    transcriptionModel: session.transcriptionModel ?? TRANSCRIPTION_MODEL,
    rawUrl: response.url, rawDownloadId: download };
  await chrome.storage.local.set({ [PENDING_REPORT_KEY]: pending });
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setBadgeText({ text: "ASR" });
  const [rawDownload] = await chrome.downloads.search({ id: download });
  if (rawDownload?.state === "complete") await handleDownloadChange({ id: download, state: { current: "complete" } });
  await requestReport(pending);
}

async function end(session: ActiveSession): Promise<void> {
  return navigator.locks.request("cyclone-session-end", async () => {
    const current = await activeSession();
    if (!current || current.sessionId !== session.sessionId) return;
    await endOnce(current);
  });
}

async function toggle(): Promise<void> {
  const current = await activeSession();
  if (current) return end(current);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return begin(tab);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-recording") void toggle().catch(showError);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_ALARM) { void retryUploads().catch(showError); return; }
  if (!alarm.name.startsWith(AUTO_STOP_ALARM_PREFIX)) return;
  const sessionId = alarm.name.slice(AUTO_STOP_ALARM_PREFIX.length);
  void activeSession().then(async (session) => {
    if (!session || session.sessionId !== sessionId) return;
    await end(session);
  }).catch(showError);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current) void handleDownloadChange(delta).catch(showError);
});

void activeSession().then((session) => {
  if (session) {
    void chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    void chrome.action.setBadgeText({ text: "REC" });
  }
});
void resumePendingReport().catch(showError);
void chrome.alarms.create(UPLOAD_ALARM, { periodInMinutes: 5 });
void retryUploads().catch(showError);

async function retryUploads(): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: "offscreen-upload-pending" } satisfies Message);
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === "offscreen-failed") {
    void (async () => {
      const session = await activeSession();
      if (!session || session.sessionId !== message.sessionId) return;
      await chrome.storage.local.remove(SESSION_KEY);
      await chrome.tabs.sendMessage(session.tabId, { type: "capture-recording", recording: false }).catch(() => undefined);
      await showError(new Error(message.reason));
    })();
    return false;
  }
  if (message.type === "clear-legacy-models") {
    void (async () => {
      if (await activeSession() || await pendingReport()) throw new Error("Wait for the current attempt to finish.");
      if (!await caches.has("transformers-cache")) { sendResponse({ ok: true, removed: 0 }); return; }
      const cache = await caches.open("transformers-cache"); let removed = 0;
      for (const key of await cache.keys()) {
        const url = new URL(key.url);
        if (url.origin === "https://huggingface.co" && /^\/[^/]+\/[^/]+\/resolve\//.test(url.pathname) && await cache.delete(key)) removed++;
      }
      sendResponse({ ok: true, removed });
    })().catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "toggle") {
    void toggle().then(() => sendResponse({ ok: true })).catch((error: unknown) => {
      void showError(error).then(() => sendResponse({ ok: false, error: String(error) }));
    });
    return true;
  }
  if (message.type === "get-status") {
    void Promise.all([activeSession(), pendingReport(), chrome.storage.local.get([ERROR_KEY, UPLOAD_CONSENT_KEY, UPLOAD_STATUS_KEY, TRANSCRIPTION_MODEL_KEY])])
      .then(([session, pending, stored]) => sendResponse({ session, pendingReport: Boolean(pending), error: stored[ERROR_KEY], uploadConsent: stored[UPLOAD_CONSENT_KEY] === true, uploadStatus: stored[UPLOAD_STATUS_KEY], transcriptionModel: isTranscriptionModel(stored[TRANSCRIPTION_MODEL_KEY]) ? stored[TRANSCRIPTION_MODEL_KEY] : TRANSCRIPTION_MODEL }))
      .catch(() => sendResponse({}));
    return true;
  }
  if (message.type === "set-transcription-model") {
    void (async () => {
      if (!isTranscriptionModel(message.model)) throw new Error("Unsupported transcription model.");
      if (await activeSession() || await pendingReport()) throw new Error("Change the model between sessions.");
      await chrome.storage.local.set({ [TRANSCRIPTION_MODEL_KEY]: message.model });
      sendResponse({ ok: true });
    })().catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "upload-status") {
    void chrome.storage.local.set({ [UPLOAD_STATUS_KEY]: { status: message.status, detail: message.detail } }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "agree-upload") {
    void chrome.storage.local.set({ [UPLOAD_CONSENT_KEY]: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "offscreen-report-ready") {
    void (async () => {
      const downloadId = await navigator.locks.request("cyclone-report-download", async () => {
        const pending = await pendingReport();
        if (!pending || pending.sessionId !== message.sessionId || pending.reportDownloadId !== undefined) return undefined;
        const filename = `Cyclone/Reports/${pending.sourcePath.split("/").at(-1)!.replace(/\.zip$/, "")}-report.zip`;
        const id = await chrome.downloads.download({ url: message.url, filename, saveAs: false, conflictAction: "uniquify" });
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: { ...pending, reportUrl: message.url, reportDownloadId: id } satisfies PendingReport });
        return id;
      });
      if (downloadId === undefined) { sendResponse({ ok: false, error: "This report is no longer pending." }); return; }
      sendResponse({ ok: true });
      const [download] = await chrome.downloads.search({ id: downloadId });
      if (download?.state === "complete") await handleDownloadChange({ id: downloadId, state: { current: "complete" } });
    })().catch((error) => { sendResponse({ ok: false, error: String(error) }); void showError(error); });
    return true;
  }
  if (message.type === "offscreen-report-failed") {
    void (async () => {
      await navigator.locks.request("cyclone-report-download", async () => {
        const pending = await pendingReport();
        if (!pending || pending.sessionId !== message.sessionId) return;
        const updated = { ...pending, reportFailed: true } satisfies PendingReport;
        await chrome.storage.local.set({ [PENDING_REPORT_KEY]: updated });
        await abandonReport(updated, `Could not create the local report: ${message.reason}. The raw session ZIP remains available.`);
      });
    })().catch(showError);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "mic-permission-granted") {
    sendResponse({ ok: true });
    void (async () => {
      if (await activeSession()) throw new Error("A Cyclone session is already recording.");
      const tab = await chrome.tabs.get(message.tabId);
      if (sender.tab?.id) await chrome.tabs.remove(sender.tab.id);
      await chrome.tabs.update(message.tabId, { active: true });
      await begin(tab, false);
    })().catch(showError);
    return false;
  }
  if (message.type === "page-start" || message.type === "page-event") {
    void activeSession().then(async (session) => {
      if (!session || sender.tab?.id !== session.tabId) return;
      const event = message.type === "page-start"
        ? { type: "code" as const, code: message.initialCode, language: message.metadata.language }
        : message.event;
      const saved = await chrome.runtime.sendMessage({ type: "offscreen-event", event: { ...event, tMs: Date.now() - session.startedAtMs } } satisfies Message);
      if (!saved?.ok) throw new Error(saved?.error ?? "Could not save the LeetCode page event.");
      if (message.type !== "page-event" || message.event.type !== "submit") return;
      if (message.event.result) {
        await end(session);
      } else {
        const alarmName = autoStopAlarmName(session.sessionId);
        await chrome.alarms.create(alarmName, { delayInMinutes: AUTO_STOP_DELAY_MINUTES });
        const stillActive = await activeSession();
        if (!stillActive || stillActive.sessionId !== session.sessionId) await chrome.alarms.clear(alarmName);
      }
    }).then(() => sendResponse({ ok: true })).catch((error) => {
      void showError(error);
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
});
