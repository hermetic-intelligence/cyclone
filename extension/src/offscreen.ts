import type { CaptureEvent, Message, SessionMetadata } from "./shared";

type StoredSession = { metadata: SessionMetadata; events: CaptureEvent[] };
let session: StoredSession | undefined;
let recorder: MediaRecorder | undefined;
let stream: MediaStream | undefined;
let stopping: Promise<{ ok: boolean; url?: string; error?: string }> | undefined;
let dbPromise: Promise<IDBDatabase> | undefined;
let persistQueue = Promise.resolve();
let stopRequested = false;
let microphoneTrackEnded = false;
let lastAudioChunkAtMs = 0;

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "offscreen-start") {
    void start(message.metadata).then((started) => sendResponse({ ok: true, ...started })).catch((error: unknown) => sendResponse({
      ok: false,
      error: error && typeof error === "object" && "message" in error ? String(error.message) : String(error),
      errorName: error && typeof error === "object" && "name" in error ? String(error.name) : "UnknownError"
    }));
    return true;
  }
  if (message.type === "offscreen-event") {
    if (session) {
      session.events.push(message.event);
      const current = session;
      persistQueue = persistQueue.then(async () => {
        const db = await database();
        await request(db.transaction("sessions", "readwrite").objectStore("sessions").put({ sessionId: current.metadata.sessionId, metadata: current.metadata, events: current.events }));
      });
      void persistQueue.then(() => sendResponse({ ok: true })).catch((error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
      return true;
    }
    sendResponse({ ok: Boolean(session) });
  }
  if (message.type === "offscreen-stop") {
    stopping = stop(message.endedAt);
    void stopping.then(sendResponse);
    return true;
  }
  if (message.type === "offscreen-revoke") {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
  }
});

async function start(metadata: SessionMetadata): Promise<{ startedAt: string; startedAtMs: number }> {
  if (session) throw new Error("A session is already recording.");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this browser.");
  const db = await database();
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  session = { metadata, events: [] };
  stopRequested = false;
  microphoneTrackEnded = false;
  lastAudioChunkAtMs = 0;
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => { microphoneTrackEnded = true; });
  }
  recorder.addEventListener("stop", () => {
    if (!stopRequested && session) {
      const failedSessionId = session.metadata.sessionId;
      const reason = microphoneTrackEnded
        ? "The microphone stream ended before you stopped recording."
        : "Chrome stopped the audio recorder before you stopped the session.";
      stream?.getTracks().forEach((track) => track.stop());
      session = undefined;
      recorder = undefined;
      stream = undefined;
      void chrome.runtime.sendMessage({ type: "offscreen-failed", sessionId: failedSessionId, reason } satisfies Message);
    }
  });
  let chunkIndex = 0;
  let firstChunk: (() => void) | undefined;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size && session) {
      lastAudioChunkAtMs = Date.now();
      const current = session;
      const index = chunkIndex++;
      persistQueue = persistQueue.then(async () => {
        const db = await database();
        await request(db.transaction("chunks", "readwrite").objectStore("chunks").put({ id: `${current.metadata.sessionId}:${index}`, sessionId: current.metadata.sessionId, chunkIndex: index, blob: event.data }));
      });
      firstChunk?.();
    }
  });
  // This is the shared origin for audio and page events. Set it immediately
  // before start(), then keep it unchanged while waiting for the first chunk.
  let startedAtMs = 0;
  let startedAt = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The microphone produced no audio data within 6 seconds. Check Chrome and macOS microphone access.")), 6000);
      firstChunk = () => { clearTimeout(timeout); resolve(); };
      recorder!.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Audio recording failed to start.")); }, { once: true });
      recorder!.addEventListener("stop", () => { clearTimeout(timeout); reject(new Error("Audio recording stopped before it produced data.")); }, { once: true });
      startedAtMs = Date.now();
      startedAt = new Date(startedAtMs).toISOString();
      metadata.startedAt = startedAt;
      recorder!.start(1000);
    });
    await persistQueue;
    if (!session || recorder?.state !== "recording") throw new Error("The microphone recorder stopped during startup.");
  } catch (error) {
    stopRequested = true;
    if (recorder?.state !== "inactive") recorder?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    session = undefined;
    recorder = undefined;
    stream = undefined;
    throw error;
  } finally {
    firstChunk = undefined;
  }
  await request(db.transaction("sessions", "readwrite").objectStore("sessions").put({ sessionId: metadata.sessionId, metadata, events: [] }));
  return { startedAt, startedAtMs };
}

async function stop(endedAt: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!session || !recorder) return { ok: false, error: "No active recording was found." };
  const current = session;
  try {
    if (recorder.state === "inactive") {
      throw new Error(microphoneTrackEnded
        ? "The microphone stream ended before the session stopped. No complete recording was saved."
        : "Chrome stopped the audio recorder early. No complete recording was saved.");
    }
    stopRequested = true;
    const lastAudioChunkBeforeStop = lastAudioChunkAtMs;
    await new Promise<void>((resolve, reject) => {
      recorder!.addEventListener("stop", () => resolve(), { once: true });
      recorder!.addEventListener("error", () => reject(new Error("Audio recording failed.")), { once: true });
      recorder!.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    await persistQueue;
    const db = await database();
    const allChunks = await request<{ sessionId: string; chunkIndex: number; blob: Blob }[]>(db.transaction("chunks", "readonly").objectStore("chunks").getAll());
    const savedChunks = allChunks.filter((item) => item.sessionId === current.metadata.sessionId).sort((a, b) => a.chunkIndex - b.chunkIndex);
    const elapsedMs = Date.parse(endedAt) - Date.parse(current.metadata.startedAt);
    if (elapsedMs > 6000 && Date.parse(endedAt) - lastAudioChunkBeforeStop > 4000) {
      throw new Error("The microphone stopped producing audio before the session ended. No incomplete recording was exported.");
    }
    if (elapsedMs > 4000 && savedChunks.length < 2) {
      throw new Error(`Only ${savedChunks.length} microphone audio chunk was saved during a ${Math.round(elapsedMs / 1000)} second session. No complete recording was exported.`);
    }
    if (!savedChunks.some((item) => item.blob.size > 0)) {
      throw new Error("No microphone audio was captured. The session was not exported as a recording.");
    }
    current.metadata.endedAt = endedAt;
    const audio = new Blob(savedChunks.map((item) => item.blob), { type: recorder.mimeType || "audio/webm" });
    const audioBytes = new Uint8Array(await audio.arrayBuffer());
    if (audioBytes.length < 4 || audioBytes[0] !== 0x1a || audioBytes[1] !== 0x45 || audioBytes[2] !== 0xdf || audioBytes[3] !== 0xa3) {
      throw new Error("The microphone did not produce a valid WebM recording. The session was not exported.");
    }
    const events = current.events.map((event) => JSON.stringify(event)).join("\n") + (current.events.length ? "\n" : "");
    const zip = makeZip([
      ["session.json", new TextEncoder().encode(JSON.stringify(current.metadata, null, 2) + "\n")],
      ["events.jsonl", new TextEncoder().encode(events)],
      ["audio.webm", audioBytes]
    ]);
    const url = URL.createObjectURL(zip);
    const tx = db.transaction(["sessions", "chunks"], "readwrite");
    tx.objectStore("sessions").delete(current.metadata.sessionId);
    for (const item of savedChunks) tx.objectStore("chunks").delete(`${current.metadata.sessionId}:${item.chunkIndex}`);
    session = undefined;
    recorder = undefined;
    stream = undefined;
    return { ok: true, url };
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    session = undefined;
    recorder = undefined;
    stream = undefined;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const opening = indexedDB.open("cyclone-capture", 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("sessions", { keyPath: "sessionId" });
      db.createObjectStore("chunks", { keyPath: "id" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Could not open session storage."));
  });
  return dbPromise;
}

function request<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Session storage operation failed."));
  });
}

function makeZip(entries: Array<[string, Uint8Array]>): Blob {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true); header.set(nameBytes, 30);
    local.push(header, data);
    const record = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
    c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true); record.set(nameBytes, 46);
    central.push(record);
    offset += header.length + data.length;
  }
  const centralLength = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(4, 0, true); endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralLength, true); endView.setUint32(16, offset, true); endView.setUint16(20, 0, true);
  return new Blob([...local, ...central, end].map((bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), { type: "application/zip" });
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
