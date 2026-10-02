import { expect, test } from "bun:test";
import { passages, pcmWav, SAMPLE_RATE } from "../src/audio/passages";
import { createReports } from "../src/reports";

test("passages preserve every non-silent sample and their recording offsets", () => {
  const samples = new Float32Array(47 * SAMPLE_RATE).fill(0.05);
  samples.fill(0, 6 * SAMPLE_RATE, 7 * SAMPLE_RATE);
  const parts = passages(samples);
  expect(parts.length).toBeGreaterThan(2);
  let total = 0;
  for (const part of parts) {
    expect(part.samples.length).toBeLessThanOrEqual(20 * SAMPLE_RATE);
    expect(part.startMs).toBe(Math.round(total / SAMPLE_RATE * 1000));
    expect([...part.samples]).toEqual([...samples.slice(total, total + part.samples.length)]);
    total += part.samples.length;
  }
  expect(total).toBe(samples.length);
  expect(parts[0].endMs).toBeLessThan(7000);
});

test("only exact digital silence is skipped, not quiet speech", () => {
  expect(passages(new Float32Array(8 * SAMPLE_RATE))).toEqual([]);
  expect(passages(new Float32Array(8 * SAMPLE_RATE).fill(0.00001)).length).toBeGreaterThan(0);
});

test("PCM WAV carries the actual duration and clips out of range samples", () => {
  const wav = pcmWav(new Float32Array([-2, 0, 2]));
  const view = new DataView(wav.buffer);
  expect(wav.length).toBe(50);
  expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(view.getInt16(48, true)).toBe(32767);
});

test("partial hosted reports state that timing is approximate", () => {
  const files = new Map(createReports({ sessionId: "test", startedAt: "2026-10-02T00:00:00Z", title: "Two Sum", language: "python", problemUrl: "https://leetcode.com" }, [],
    [{ startMs: 5000, endMs: 12000, text: "Try a dictionary" }], "Allowance exhausted", "hash", "raw.zip"));
  const timeline = JSON.parse(new TextDecoder().decode(files.get("timeline.json")));
  expect(timeline.transcription.status).toBe("partial");
  expect(timeline.transcription.device).toBe("hosted");
  expect(timeline.transcription.timing).toBe("audio-passage-intervals");
  const readme = new TextDecoder().decode(files.get("README.md"));
  expect(readme).toContain("### 00:05 Speech through 00:12: Try a dictionary");
  expect(readme).toContain("do not infer exact word-to-code ordering");
});
