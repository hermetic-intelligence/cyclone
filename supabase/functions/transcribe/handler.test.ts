import { expect, test } from "bun:test";
import { handler, wavSeconds, type Dependencies, type Reservation } from "./handler";
import { pcmWav, SAMPLE_RATE } from "../../../extension/src/audio/passages";
const wav = pcmWav(new Float32Array(2 * SAMPLE_RATE).fill(0.1));
const request = (bytes = wav) => new Request("https://test/transcribe", { method: "POST", headers: {
  Authorization: "Bearer test", "Content-Type": "audio/wav", "x-session-id": "00000000-0000-0000-0000-000000000001", "x-segment-index": "0", "x-recording-context": "Two%20Sum"
}, body: bytes });
function fixture(status: Reservation = { status: "reserved" }) {
  let called = 0; const saved: unknown[] = []; const reservations: unknown[] = [];
  const deps: Dependencies = { apiKey: "fake", authenticate: async () => "user", reserve: async (...args) => { reservations.push(args); return status; },
    finish: async (...args) => { saved.push(args); }, upstream: (async (_url, init) => {
      called++;
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("gpt-transcribe");
      expect(form.get("prompt")).toContain("Two Sum");
      expect(form.getAll("keywords[]")).toContain("LeetCode");
      return Response.json({ text: "Try a hash map" });
    }) as typeof fetch };
  return { deps, called: () => called, saved, reservations };
}
test("invalid authentication and missing configuration cannot reach OpenAI", async () => {
  const f = fixture(); f.deps.authenticate = async () => null;
  expect((await handler(f.deps)(request())).status).toBe(401); expect(f.called()).toBe(0);
  f.deps.authenticate = async () => "user"; f.deps.apiKey = undefined;
  expect((await handler(f.deps)(request())).status).toBe(503); expect(f.reservations).toEqual([]);
});
test("duration comes from validated PCM bytes, not caller claims", async () => {
  expect(wavSeconds(wav)).toBe(2);
  const corrupt = wav.slice(); new DataView(corrupt.buffer).setUint32(24, 8000, true);
  const f = fixture(); expect((await handler(f.deps)(request(corrupt))).status).toBe(400); expect(f.called()).toBe(0);
  expect((await handler(f.deps)(request(new Uint8Array(700000)))).status).toBe(400);
});
test("exhausted, pending and completed reservations never make a paid request", async () => {
  for (const [status, code] of [[{ status: "exhausted" }, 402], [{ status: "pending" }, 409], [{ status: "complete", text: "cached" }, 200]] as const) {
    const f = fixture(status); expect((await handler(f.deps)(request())).status).toBe(code); expect(f.called()).toBe(0);
  }
});
test("valid requests reserve first, transcribe once and persist the result", async () => {
  const f = fixture(); const response = await handler(f.deps)(request()); expect(response.status).toBe(200);
  expect(f.called()).toBe(1); expect(f.reservations.length).toBe(1); expect(f.saved.length).toBe(1);
  expect(f.reservations[0][2]).toBe(1000);
  expect(await response.json()).toEqual({ text: "Try a hash map", model: "gpt-transcribe" });
});
test("uncertain upstream failures keep the reservation instead of refunding it", async () => {
  const f = fixture(); f.deps.upstream = (async () => { throw new Error("timeout"); }) as typeof fetch;
  expect((await handler(f.deps)(request())).status).toBe(502);
  expect(f.saved[0]).toEqual(["user", expect.any(String), null, "timeout"]);
});
test("a cache failure still returns the paid transcript", async () => {
  const f = fixture(); f.deps.finish = async () => { throw new Error("database unavailable"); };
  const response = await handler(f.deps)(request());
  expect(response.status).toBe(200);
  expect((await response.json()).text).toBe("Try a hash map");
  expect(f.called()).toBe(1);
});
