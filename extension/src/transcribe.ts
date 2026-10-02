import { env, pipeline } from "@huggingface/transformers";
import type { TranscriptSegment } from "./reports";
import { TRANSCRIPTION_MODEL } from "./shared";
import { MODEL_CACHE_LOCK, MODEL_CACHE_NAME } from "./models/cache";

export async function transcribeLocal(audio: Blob, model = TRANSCRIPTION_MODEL): Promise<TranscriptSegment[]> {
  return navigator.locks.request(MODEL_CACHE_LOCK, { mode: "shared" }, () => transcribeWithCache(audio, model));
}

async function transcribeWithCache(audio: Blob, model: string): Promise<TranscriptSegment[]> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (!gpu || !await gpu.requestAdapter()) throw new Error("WebGPU is unavailable on this device or in this Chrome profile.");

  // ONNX Runtime uses a local WebAssembly helper even when the model runs on WebGPU.
  // Keeping both files in the extension avoids fetching executable code remotely.
  env.backends.onnx.wasm!.wasmPaths = {
    mjs: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.mjs"),
    wasm: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.wasm")
  };
  env.useWasmCache = false;
  env.useBrowserCache = true;
  env.cacheKey = MODEL_CACHE_NAME;

  const transcriber = await pipeline("automatic-speech-recognition", model, {
    device: "webgpu",
    dtype: model === "onnx-community/whisper-large-v3-turbo" || model === "Xenova/whisper-medium.en"
      ? { encoder_model: "fp16", decoder_model_merged: "q4f16" }
      : { encoder_model: "fp32", decoder_model_merged: "q4" }
  });
  const url = URL.createObjectURL(audio);
  try {
    const result = await transcriber(url, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
      ...(model === "onnx-community/whisper-large-v3-turbo" ? { language: "english", task: "transcribe" } : {}) });
    if (!result.chunks?.length && result.text.trim()) throw new Error("The speech model returned text without timestamps.");
    return (result.chunks ?? []).map((chunk) => {
      const [start, end] = chunk.timestamp;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new Error("The speech model returned an invalid timestamp.");
      }
      return { startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), text: chunk.text.trim() };
    }).filter((segment) => segment.text);
  } finally {
    URL.revokeObjectURL(url);
    await transcriber.dispose();
  }
}
