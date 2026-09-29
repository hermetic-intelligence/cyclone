const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#toggle")!;
const errorEl = document.querySelector<HTMLParagraphElement>("#error")!;
const noticeEl = document.querySelector<HTMLParagraphElement>("#notice")!;
const uploadEl = document.querySelector<HTMLParagraphElement>("#upload")!;
const modelEl = document.querySelector<HTMLSelectElement>("#model")!;
const modelHintEl = document.querySelector<HTMLParagraphElement>("#model-hint")!;

function describeModel(): void {
  modelHintEl.textContent = modelEl.value === "onnx-community/whisper-large-v3-turbo"
    ? "Experimental: downloads about 1.5 GB and may need about 6 GB of GPU memory. Falls back to Base if it cannot load. Audio stays here."
    : modelEl.value === "Xenova/whisper-medium.en"
      ? "Experimental: downloads about 1 GB and may need about 5 GB of GPU memory. Falls back to Base if it cannot load. Audio stays here."
    : modelEl.value === "onnx-community/whisper-base.en"
      ? "Fastest local option. Lower accuracy on difficult speech. Audio stays here."
      : "Recommended local option. First use downloads a larger model. Audio stays here.";
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "get-status" });
  const active = Boolean(response?.session);
  const processing = Boolean(response?.pendingReport);
  const needsConsent = !response?.uploadConsent;
  modelEl.value = response?.transcriptionModel ?? "onnx-community/whisper-small.en";
  describeModel();
  modelEl.disabled = active || processing;
  noticeEl.hidden = !needsConsent;
  statusEl.textContent = active ? "Recording this LeetCode attempt" : processing ? "Recording saved; preparing the local report" : "Ready on a LeetCode problem page";
  statusEl.classList.toggle("active", active);
  button.textContent = active ? "Stop and save session" : processing ? "Preparing report…" : needsConsent ? "Agree and start recording" : "Start recording";
  button.classList.toggle("stop", active);
  button.disabled = processing;
  button.dataset.active = String(active);
  button.dataset.needsConsent = String(needsConsent);
  const upload = response?.uploadStatus as { status: string; detail?: string } | undefined;
  uploadEl.hidden = !upload;
  uploadEl.textContent = upload?.status === "saved" ? "Report saved privately to Cyclone." : upload?.status === "retry" ? "Report upload pending; Cyclone will retry automatically." : upload?.status === "uploading" ? "Uploading report privately…" : "";
  if (response?.error && !active) {
    errorEl.textContent = response.error;
    errorEl.hidden = false;
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  if (button.dataset.active === "true") {
    button.textContent = "Saving recording…";
    statusEl.textContent = "Saving the raw session and starting local transcription";
  }
  errorEl.hidden = true;
  try {
    if (button.dataset.needsConsent === "true") {
      const agreed = await chrome.runtime.sendMessage({ type: "agree-upload" });
      if (!agreed?.ok) throw new Error("Could not save your choice.");
    }
    const response = await chrome.runtime.sendMessage({ type: "toggle" });
    if (!response?.ok) {
      errorEl.textContent = response?.error ?? "Could not start or stop the session.";
      errorEl.hidden = false;
    }
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : String(error);
    errorEl.hidden = false;
  } finally {
    await refresh().catch(() => { button.disabled = false; });
  }
});

modelEl.addEventListener("change", async () => {
  modelEl.disabled = true;
  errorEl.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "set-transcription-model", model: modelEl.value });
    if (!response?.ok) throw new Error(response?.error ?? "Could not save the transcription model.");
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : String(error);
    errorEl.hidden = false;
  } finally {
    await refresh().catch(() => { modelEl.disabled = false; });
  }
});

void refresh().catch((error: unknown) => {
  statusEl.textContent = "Extension unavailable";
  errorEl.textContent = String(error);
  errorEl.hidden = false;
  button.disabled = true;
});
