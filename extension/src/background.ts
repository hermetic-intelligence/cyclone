import type { ActiveSession, Message, SessionMetadata } from "./shared";

const SESSION_KEY = "activeSession";
const OFFSCREEN_URL = "offscreen.html";

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

async function begin(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url || !/^https:\/\/(?:[^/]+\.)?leetcode\.com\/problems\//.test(tab.url)) {
    throw new Error("Open a LeetCode problem page before recording.");
  }
  const sessionId = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  await ensureOffscreen();
  const response = await chrome.tabs.sendMessage(tab.id, { type: "capture-start" });
  if (!response?.ok) throw new Error(response?.error ?? "Could not read the LeetCode editor. Reload the problem page and try again.");

  const metadata: SessionMetadata = { sessionId, startedAt: requestedAt, problemUrl: tab.url, ...response.metadata };
  const mic = await chrome.runtime.sendMessage({ type: "offscreen-start", metadata } satisfies Message);
  if (!mic?.ok) throw new Error(mic?.error ?? "Microphone recording could not start.");

  const startedAtMs = mic.startedAtMs as number;
  const startedAt = mic.startedAt as string;
  metadata.startedAt = startedAt;
  await chrome.storage.local.set({ [SESSION_KEY]: { sessionId, tabId: tab.id, startedAtMs, startedAt } satisfies ActiveSession });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.tabs.sendMessage(tab.id, { type: "capture-recording", recording: true });
}

async function end(session: ActiveSession): Promise<void> {
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
  const download = await chrome.downloads.download({ url: response.url, filename: `cyclone-${session.startedAt.slice(0, 10)}-${session.sessionId.slice(0, 8)}.zip`, saveAs: true });
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id === download && (delta.state?.current === "complete" || delta.state?.current === "interrupted")) {
      chrome.downloads.onChanged.removeListener(listener);
      void chrome.runtime.sendMessage({ type: "offscreen-revoke", url: response.url });
    }
  };
  chrome.downloads.onChanged.addListener(listener);
}

async function toggle(): Promise<void> {
  const current = await activeSession();
  if (current) return end(current);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return begin(tab);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-recording") void toggle().catch((error: unknown) => console.error("Cyclone capture:", error));
});

void activeSession().then((session) => {
  if (session) {
    void chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    void chrome.action.setBadgeText({ text: "REC" });
  }
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === "toggle") {
    void toggle().then(() => sendResponse({ ok: true })).catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "get-status") {
    void activeSession().then((session) => sendResponse({ session })).catch(() => sendResponse({}));
    return true;
  }
  if (message.type === "page-start" || message.type === "page-event") {
    void activeSession().then(async (session) => {
      if (!session || sender.tab?.id !== session.tabId) return;
      const event = message.type === "page-start"
        ? { type: "code" as const, code: message.initialCode, language: message.metadata.language }
        : message.event;
      await chrome.runtime.sendMessage({ type: "offscreen-event", event: { ...event, tMs: Date.now() - session.startedAtMs } } satisfies Message);
    }).catch((error) => console.error("Cyclone event:", error));
    return false;
  }
});
