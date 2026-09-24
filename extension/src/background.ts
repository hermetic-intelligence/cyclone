import type { ActiveSession, Message, SessionMetadata } from "./shared";

const SESSION_KEY = "activeSession";
const ERROR_KEY = "lastCaptureError";
const OFFSCREEN_URL = "offscreen.html";
const AUTO_STOP_ALARM_PREFIX = "cyclone-submit-";
const AUTO_STOP_DELAY_MINUTES = 0.5;

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
  if (!tab.id) {
    throw new Error("Open a LeetCode problem page before recording.");
  }
  const sessionId = crypto.randomUUID();
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
  await chrome.storage.local.set({ [SESSION_KEY]: { sessionId, tabId: tab.id, startedAtMs, startedAt } satisfies ActiveSession });
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
  await chrome.action.setBadgeText({ text: "" });
  if (!response?.ok) throw new Error(response?.error ?? "Could not finish the session export.");
  const download = await chrome.downloads.download({
    url: response.url,
    filename: `Cyclone/cyclone-${session.startedAt.slice(0, 10)}-${session.sessionId.slice(0, 8)}.zip`,
    saveAs: false,
    conflictAction: "uniquify"
  });
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id === download && (delta.state?.current === "complete" || delta.state?.current === "interrupted")) {
      chrome.downloads.onChanged.removeListener(listener);
      void chrome.runtime.sendMessage({ type: "offscreen-revoke", url: response.url });
    }
  };
  chrome.downloads.onChanged.addListener(listener);
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
  if (!alarm.name.startsWith(AUTO_STOP_ALARM_PREFIX)) return;
  const sessionId = alarm.name.slice(AUTO_STOP_ALARM_PREFIX.length);
  void activeSession().then(async (session) => {
    if (!session || session.sessionId !== sessionId) return;
    await end(session);
  }).catch(showError);
});

void activeSession().then((session) => {
  if (session) {
    void chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    void chrome.action.setBadgeText({ text: "REC" });
  }
});

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
  if (message.type === "toggle") {
    void toggle().then(() => sendResponse({ ok: true })).catch((error: unknown) => {
      void showError(error).then(() => sendResponse({ ok: false, error: String(error) }));
    });
    return true;
  }
  if (message.type === "get-status") {
    void Promise.all([activeSession(), chrome.storage.local.get(ERROR_KEY)])
      .then(([session, stored]) => sendResponse({ session, error: stored[ERROR_KEY] }))
      .catch(() => sendResponse({}));
    return true;
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
