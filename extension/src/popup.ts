const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#toggle")!;
const errorEl = document.querySelector<HTMLParagraphElement>("#error")!;

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "get-status" });
  const active = Boolean(response?.session);
  statusEl.textContent = active ? "Recording this LeetCode attempt" : "Ready on a LeetCode problem page";
  statusEl.classList.toggle("active", active);
  button.textContent = active ? "Stop and export session" : "Start recording";
  button.classList.toggle("stop", active);
  button.disabled = false;
  button.dataset.active = String(active);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  errorEl.hidden = true;
  const response = await chrome.runtime.sendMessage({ type: "toggle" });
  if (!response?.ok) {
    errorEl.textContent = response?.error ?? "Could not start or stop the session.";
    errorEl.hidden = false;
  }
  await refresh();
});

void refresh().catch((error: unknown) => {
  statusEl.textContent = "Extension unavailable";
  errorEl.textContent = String(error);
  errorEl.hidden = false;
  button.disabled = true;
});
