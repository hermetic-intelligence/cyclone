import { CLOUD_KEY, CLOUD_URL, cloudSession } from "./cloud";
import { passages, pcmWav, SAMPLE_RATE } from "./audio/passages";
import type { TranscriptSegment } from "./reports";

export async function transcribeHosted(audio: Blob, sessionId: string, title: string, onPassage: (segment: TranscriptSegment) => void): Promise<void> {
  const consent = await chrome.runtime.sendMessage({ type: "get-status" });
  if (!consent?.uploadConsent) throw new Error("Agree to hosted audio transcription in the Cyclone popup first.");
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await audio.arrayBuffer()); }
  finally { await context.close(); }
  const resampler = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = resampler.createBufferSource(); source.buffer = decoded; source.connect(resampler.destination); source.start();
  const mono = (await resampler.startRendering()).getChannelData(0);
  const parts = passages(mono);
  if (!parts.length) return;
  const session = await cloudSession();
  for (const [index, part] of parts.entries()) {
    const wav = pcmWav(part.samples);
    const headers = { Authorization: `Bearer ${session.access_token}`, apikey: CLOUD_KEY,
      "Content-Type": "audio/wav", "x-session-id": sessionId, "x-segment-index": String(index),
      "x-recording-context": encodeURIComponent(title.slice(0, 200)) };
    // Retries use the same audio and identity. The server never bills a repeated
    // request twice; uncertain upstream failures remain charged to the allowance.
    let result: { text?: string; error?: string } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${CLOUD_URL}/functions/v1/transcribe`, { method: "POST", headers,
          body: wav.buffer as ArrayBuffer, signal: AbortSignal.timeout(90000) });
        result = await response.json();
        if (response.ok) break;
        if (response.status === 409 && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
        throw new Error(result?.error ?? `Transcription failed (${response.status}).`);
      } catch (error) {
        if (error instanceof TypeError && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
        throw error;
      }
    }
    if (typeof result?.text !== "string") throw new Error("The transcription endpoint returned no text.");
    if (result.text.trim()) onPassage({ startMs: part.startMs, endMs: part.endMs, text: result.text.trim() });
  }
}
