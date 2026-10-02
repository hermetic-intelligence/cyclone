import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { isTranscriptionModel, MODEL_DETAILS, TRANSCRIPTION_MODELS, TRANSCRIPTION_MODEL } from "../models/catalog";
import type { TranscriptionModel } from "../models/catalog";
import type { CachedModel } from "../models/cache";

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function Settings() {
  const [selected, setSelected] = useState<TranscriptionModel>(TRANSCRIPTION_MODEL);
  const [models, setModels] = useState<CachedModel[]>([]);
  const [activity, setActivity] = useState("Loading settings…");
  const [locked, setLocked] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<number | undefined>();

  async function refresh() {
    const [status, cache, estimate] = await Promise.all([
      chrome.runtime.sendMessage({ type: "get-status" }),
      chrome.runtime.sendMessage({ type: "get-model-cache" }),
      navigator.storage.estimate().catch(() => ({} as StorageEstimate))
    ]);
    if (!isTranscriptionModel(status?.transcriptionModel)) throw new Error("Cyclone is unavailable or was updated. Reopen settings after the extension reloads.");
    if (!cache?.ok) throw new Error(cache?.error ?? "Could not read cached model files.");
    setSelected(status.transcriptionModel);
    setModels(cache.models);
    setUsage(estimate.usage);
    setLocked(Boolean(status.session || status.pendingReport));
    setActivity(status.session ? "Recording: model changes and deletion are paused." : status.pendingReport
      ? "Preparing a report: model changes and deletion are paused." : "Ready. Model changes apply to your next attempt.");
  }

  useEffect(() => {
    const load = () => { void refresh().catch((e) => { setError(String(e)); setLocked(true); }); };
    load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && ["activeSession", "pendingReport", "transcriptionModel"].some((key) => key in changes)) load();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  async function action(task: () => Promise<void>) {
    setWorking(true); setError(""); setNotice("");
    try { await task(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }

  const ids = [...TRANSCRIPTION_MODELS, ...models.filter((entry) => !isTranscriptionModel(entry.model)).map((entry) => entry.model)];
  const disabled = locked || working;
  const total = models.reduce((sum, entry) => sum + entry.bytes, 0);
  const unknown = models.reduce((sum, entry) => sum + entry.unknownSizeFiles, 0);
  async function remove(model: string | null) {
    const response = await chrome.runtime.sendMessage({ type: "remove-model-cache", model });
    if (!response?.ok) throw new Error(response?.error ?? "Could not remove cached model files.");
    setNotice(`Removed ${response.removed} cached ${response.removed === 1 ? "file" : "files"}. These models will download again if used. Your recordings and reports were kept.`);
  }

  return <main>
    <header><p className="brand">Cyclone</p><h1>Models and storage</h1><p>Speech recognition runs locally in this Chrome profile. Audio stays on your computer.</p></header>
    <p role="status">{activity}</p>
    <section aria-labelledby="selection"><h2 id="selection">Model for the next attempt</h2>
      <label htmlFor="model">Transcription model</label>
      <select id="model" value={selected} disabled={disabled} onChange={(event) => {
        const model = event.target.value;
        if (!isTranscriptionModel(model)) return;
        void action(async () => {
          const response = await chrome.runtime.sendMessage({ type: "set-transcription-model", model });
          if (!response?.ok) throw new Error(response?.error ?? "Could not save the model choice.");
          setNotice("Model choice saved for your next attempt.");
        });
      }}>{TRANSCRIPTION_MODELS.map((model) => <option key={model} value={model}>{MODEL_DETAILS[model].label}</option>)}</select>
      <p>{MODEL_DETAILS[selected].hint}</p>
      <p>Selection does not download a model. The first transcription downloads its files; later attempts reuse them. Larger models are experimental, and there is no guaranteed completion time.</p>
    </section>
    <section aria-labelledby="storage"><h2 id="storage">Cached model files</h2>
      <p>About {size(total)} in files with a known size{unknown ? `; ${unknown} ${unknown === 1 ? "file has" : "files have"} no size header` : ""}. Chrome manages these files in its browser cache, rather than a folder you select. Cached files may be partial downloads; their presence does not prove a model can run.</p>
      <div className="models">{ids.map((model) => {
        const cached = models.find((entry) => entry.model === model);
        return <article key={model}>
          <div><h3>{isTranscriptionModel(model) ? MODEL_DETAILS[model].label : model}</h3><code>{model}</code>
            <p>{cached ? `${cached.files} cached ${cached.files === 1 ? "file" : "files"} · about ${size(cached.bytes)}${cached.unknownSizeFiles ? ` + ${cached.unknownSizeFiles} with unknown size` : ""}` : "No cached files"}</p>
          </div>
          <button disabled={disabled || !cached} onClick={() => { void action(() => remove(model)); }}>Remove cached files</button>
        </article>;
      })}</div>
      <div className="actions"><button disabled={disabled || models.length === 0} onClick={() => { void action(() => remove(null)); }}>Remove all model files</button>
        <button disabled={working} onClick={() => { void action(async () => {}); }}>Refresh storage</button></div>
      <p>Removing files does not change your selected model. It frees their cache space; Chrome may take time to update its storage estimate. The next use needs internet access to download them again.</p>
      {usage !== undefined && <p className="muted">Chrome estimates {size(usage)} for all Cyclone browser storage, including model files, temporary recordings, and pending reports.</p>}
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <footer>Cyclone {chrome.runtime.getManifest().version}</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Settings />);
