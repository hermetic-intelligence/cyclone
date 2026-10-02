export const MAX_BYTES = 44 + 16000 * 2 * 20;
export type Reservation = { status: "reserved" | "pending" | "complete" | "failed" | "exhausted"; text?: string; error?: string };
export type Dependencies = {
  authenticate: (token: string) => Promise<string | null>;
  reserve: (user: string, id: string, micros: number) => Promise<Reservation>;
  finish: (user: string, id: string, text: string | null, error: string | null) => Promise<void>;
  apiKey: string | undefined;
  upstream?: typeof fetch;
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-session-id, x-segment-index, x-recording-context", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

export function wavSeconds(bytes: Uint8Array): number {
  if (bytes.length < 46 || bytes.length > MAX_BYTES) throw new Error("Audio must be a PCM WAV passage of at most 20 seconds.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end));
  if (str(0, 4) !== "RIFF" || str(8, 12) !== "WAVE" || str(12, 16) !== "fmt " || str(36, 40) !== "data"
    || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000
    || view.getUint32(28, true) !== 32000 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2 !== 0) throw new Error("Invalid mono 16 kHz PCM WAV.");
  return (bytes.length - 44) / 32000;
}

async function boundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new Error("No audio supplied.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Audio exceeds 20 seconds."); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function handler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "Sign in to Cyclone first." }, 401);
    let user: string | null;
    try { user = await deps.authenticate(token); } catch { return json({ error: "Could not verify your session." }, 503); }
    if (!user) return json({ error: "Your Cyclone session expired." }, 401);
    if (!deps.apiKey) return json({ error: "Hosted transcription is not configured yet." }, 503);
    const session = request.headers.get("x-session-id") ?? "";
    const index = request.headers.get("x-segment-index") ?? "";
    if (!/^[a-f0-9-]{36}$/i.test(session) || !/^\d{1,5}$/.test(index) || request.headers.get("content-type") !== "audio/wav") return json({ error: "Invalid audio request." }, 400);
    let bytes: Uint8Array; let seconds: number; let context: string;
    try { bytes = await boundedBody(request); seconds = wavSeconds(bytes); context = decodeURIComponent(request.headers.get("x-recording-context") ?? "").slice(0, 200); }
    catch (error) { return json({ error: String(error) }, 400); }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer));
    const id = `${session}:${index}:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    // Twice the published duration estimate, rounded up, with a minimum per-call
    // reservation. This is a conservative experiment allowance, not an invoice.
    const micros = Math.max(1000, (Math.ceil(seconds) + 1) * 150);
    let reservation: Reservation;
    try { reservation = await deps.reserve(user, id, micros); } catch { return json({ error: "Could not reserve transcription allowance." }, 503); }
    if (reservation.status === "exhausted") return json({ error: "Cyclone's transcription experiment allowance is exhausted. Your raw recording is still saved locally." }, 402);
    if (reservation.status === "complete") return json({ text: reservation.text ?? "", model: "gpt-transcribe", reused: true });
    if (reservation.status === "pending") return json({ error: "This passage is already being transcribed. Try again shortly." }, 409);
    if (reservation.status === "failed") return json({ error: reservation.error ?? "The previous transcription failed." }, 502);
    let text: string;
    try {
      const form = new FormData();
      form.set("file", new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }), "passage.wav");
      form.set("model", "gpt-transcribe"); form.set("response_format", "json"); form.append("languages[]", "en");
      form.set("prompt", `A person explaining their own programming approach during a LeetCode attempt. Problem: ${context}. Transcribe what was actually said, without solving or rewriting their explanation.`);
      for (const keyword of ["LeetCode", "hash map", "two pointers", "time complexity", "space complexity"]) form.append("keywords[]", keyword);
      const response = await (deps.upstream ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${deps.apiKey}` }, body: form, signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status}).`);
      const body = await response.json();
      if (typeof body.text !== "string" || body.text.length > 20000) throw new Error("OpenAI returned an invalid transcript.");
      text = body.text;
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI transcription failed.";
      try { await deps.finish(user, id, null, message); } catch { /* Keep reservation on uncertain completion. */ }
      return json({ error: message }, 502);
    }
    try { await deps.finish(user, id, text, null); }
    catch {
      // Preserve paid output even if caching fails. The pending reservation prevents
      // a retry from initiating another upstream request.
      return json({ text, model: "gpt-transcribe", cacheWarning: "Transcript cache unavailable; keep this result." });
    }
    return json({ text, model: "gpt-transcribe" });
  };
}
