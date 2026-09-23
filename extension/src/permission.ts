import type { Message } from "./shared";

const button = document.querySelector<HTMLButtonElement>("#allow")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const tabId = Number(new URL(location.href).searchParams.get("tabId"));

if (!Number.isInteger(tabId) || tabId <= 0) {
  button.disabled = true;
  status.textContent = "The LeetCode tab was not found. Return to the problem and start Cyclone again.";
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Waiting for Chrome’s microphone prompt…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = "Microphone allowed. Closing this tab and starting your recording…";
    const result = await chrome.runtime.sendMessage({ type: "mic-permission-granted", tabId } satisfies Message);
    if (!result?.ok) throw new Error(result?.error ?? "Recording could not start.");
  } catch (error) {
    button.disabled = false;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    status.textContent = `Microphone access is still unavailable (${detail}). Check Chrome’s microphone site settings and macOS System Settings, then try again.`;
  }
});
