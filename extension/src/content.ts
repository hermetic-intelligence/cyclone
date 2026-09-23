import type { Message } from "./shared";

let recording = false;
let timer: number | undefined;
let lastCode: string | undefined;
let resultObserver: MutationObserver | undefined;
let statusElement: HTMLDivElement | undefined;

function showStatus(text: string, error = false) {
  if (!statusElement) {
    statusElement = document.createElement("div");
    statusElement.id = "cyclone-capture-status";
    statusElement.setAttribute("role", "status");
    document.documentElement.append(statusElement);
  }
  statusElement.textContent = text;
  statusElement.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:10px 14px;border-radius:8px;background:${error ? "#991b1b" : "#b42318"};color:white;font:600 14px system-ui,sans-serif;box-shadow:0 2px 12px #0004;pointer-events:none;max-width:360px`;
}

function clearStatus() {
  statusElement?.remove();
  statusElement = undefined;
}
function visibleEditor(): HTMLTextAreaElement | null {
  const candidates = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Code editor"], .monaco-editor textarea.inputarea')];
  return candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0] ?? null;
}

function currentLanguage(): string {
  const mode = document.querySelector<HTMLElement>(".monaco-editor")?.parentElement?.getAttribute("data-mode-id");
  if (mode) return mode;
  const candidates = [...document.querySelectorAll<HTMLElement>("button,[role=button]")];
  const language = candidates.map((el) => el.innerText.trim()).find((text) => /^(python|python3|java|javascript|typescript|cpp|c\+\+|c|go|rust|ruby|swift|kotlin|c#|php|scala|dart|elixir)$/i.test(text));
  return language?.toLowerCase() ?? "unknown";
}

function metadata() {
  const title = document.querySelector("[data-cy=question-title], [data-e2e-locator=question-title], h1")?.textContent?.trim() ?? document.title;
  return { problemUrl: location.href, title, language: currentLanguage() };
}

function emit(type: "code" | "run" | "submit", extra: { code?: string; language?: string; result?: string } = {}) {
  void chrome.runtime.sendMessage({ type: "page-event", event: { type, ...extra } } satisfies Message);
}

function pollCode() {
  if (!recording) return;
  const code = visibleEditor()?.value;
  if (code !== undefined && code !== lastCode) {
    lastCode = code;
    emit("code", { code, language: currentLanguage() });
  }
}

function visibleResult(): string | undefined {
  // The problem description and discussion may mention outcomes; inspect only
  // result-specific UI so a quoted "Wrong Answer" is not recorded as our run.
  const text = [...document.querySelectorAll<HTMLElement>('[data-e2e-locator*="result"], [data-e2e-locator*="submission"]')]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.innerText)
    .join("\n");
  const matches = [...text.matchAll(/\b(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error|Output Limit Exceeded)\b/gi)];
  return matches.at(-1)?.[0];
}

function onAction(event: MouseEvent) {
  if (!recording) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button,[role=button]") : null;
  if (!target) return;
  const locator = target.getAttribute("data-e2e-locator");
  const text = target.innerText.trim();
  const type = locator === "console-submit-button" || /^submit$/i.test(text) ? "submit" : /^run(?: code)?$/i.test(text) ? "run" : undefined;
  if (!type) return;
  emit(type);
  resultObserver?.disconnect();
  const before = visibleResult();
  const observer = new MutationObserver(() => {
    const result = visibleResult();
    if (result && result !== before) {
      emit(type, { result });
      observer.disconnect();
      window.clearTimeout(timeout);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  const timeout = window.setTimeout(() => observer.disconnect(), 30_000);
  resultObserver = observer;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture-start") {
    const editor = visibleEditor();
    if (!editor) {
      sendResponse({ ok: false, error: "LeetCode's code editor is not ready. Wait for it to load and try again." });
      return;
    }
    sendResponse({ ok: true, metadata: metadata(), initialCode: editor.value });
  } else if (message?.type === "capture-final") {
    const editor = visibleEditor();
    sendResponse(editor ? { code: editor.value, language: currentLanguage() } : {});
  } else if (message?.type === "capture-error") {
    showStatus(`Cyclone could not start: ${message.message}`, true);
  } else if (message?.type === "capture-recording") {
    if (message.recording) {
      recording = true;
      showStatus("● Cyclone recording");
      lastCode = undefined;
      document.addEventListener("click", onAction, true);
      timer = window.setInterval(pollCode, 750);
      pollCode();
    } else {
      recording = false;
      clearStatus();
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      document.removeEventListener("click", onAction, true);
      resultObserver?.disconnect();
    }
  }
});
