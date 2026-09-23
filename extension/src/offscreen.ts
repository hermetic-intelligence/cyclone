import type { CaptureEvent, Message, SessionMetadata } from "./shared";

type StoredSession = { metadata: SessionMetadata; events: CaptureEvent[] };
let session: StoredSession | undefined;
let recorder: MediaRecorder | undefined;
let stream: MediaStream | undefined;
let stopping: Promise<{ ok: boolean; url?: string; error?: string }> | undefined;
let dbPromise: Promise<IDBDatabase> | undefined;
let persistQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "offscreen-start") {
    void start(message.metadata).then((started) => sendResponse({ ok: true, ...started })).catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
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
  let chunkIndex = 0;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size && session) {
      const current = session;
      const index = chunkIndex++;
      persistQueue = persistQueue.then(async () => {
        const db = await database();
        await request(db.transaction("chunks", "readwrite").objectStore("chunks").put({ id: `${current.metadata.sessionId}:${index}`, sessionId: current.metadata.sessionId, chunkIndex: index, blob: event.data }));
      });
    }
  });
  recorder.start(1000);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  metadata.startedAt = startedAt;
  await request(db.transaction("sessions", "readwrite").objectStore("sessions").put({ sessionId: metadata.sessionId, metadata, events: [] }));
  return { startedAt, startedAtMs };
}

async function stop(endedAt: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!session || !recorder) return { ok: false, error: "No active recording was found." };
  const current = session;
  try {
    if (recorder.state !== "inactive") await new Promise<void>((resolve, reject) => {
      recorder!.addEventListener("stop", () => resolve(), { once: true });
      recorder!.addEventListener("error", () => reject(new Error("Audio recording failed.")), { once: true });
      recorder!.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    await persistQueue;
    const db = await database();
    const allChunks = await request<{ sessionId: string; chunkIndex: number; blob: Blob }[]>(db.transaction("chunks", "readonly").objectStore("chunks").getAll());
    const savedChunks = allChunks.filter((item) => item.sessionId === current.metadata.sessionId).sort((a, b) => a.chunkIndex - b.chunkIndex);
    current.metadata.endedAt = endedAt;
    const audio = new Blob(savedChunks.map((item) => item.blob), { type: recorder.mimeType || "audio/webm" });
    const events = current.events.map((event) => JSON.stringify(event)).join("\n") + (current.events.length ? "\n" : "");
    const zip = makeZip([
      ["session.json", new TextEncoder().encode(JSON.stringify(current.metadata, null, 2) + "\n")],
      ["events.jsonl", new TextEncoder().encode(events)],
      ["audio.webm", new Uint8Array(await audio.arrayBuffer())]
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
