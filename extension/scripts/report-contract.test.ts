import { expect, test } from "bun:test";
import { createReports } from "../src/reports";
import type { CaptureEvent, SessionMetadata } from "../src/shared";

test("a report has one readable interwoven trace and one complete record", () => {
  const meta: SessionMetadata = { sessionId: "s1", startedAt: "2026-09-24T00:00:00Z", endedAt: "2026-09-24T00:00:32Z",
    title: "Two Sum", problemUrl: "https://leetcode.com/problems/two-sum/", language: "python3",
    problemStatement: "Return two indices." };
  const events: CaptureEvent[] = [
    { type: "code", tMs: 0, code: "a" },
    { type: "code", tMs: 2500, code: "b" },
    { type: "code", tMs: 2600, code: "b" },
    { type: "code", tMs: 2700, code: "c" },
    { type: "code", tMs: 16000, code: "d" },
    { type: "run", tMs: 16500, result: "Wrong Answer" }
  ];
  const speech = [{ startMs: 1000, endMs: 2000, text: "Try a dictionary" },
    { startMs: 15000, endMs: 15800, text: "That index is wrong" }];
  const files = new Map(createReports(meta, events, speech, null, "abc123", "cyclone-s1.zip"));
  expect([...files.keys()]).toEqual(["README.md", "timeline.json"]);
  const decode = (name: string) => new TextDecoder().decode(files.get(name));
  const timeline = JSON.parse(decode("timeline.json"));
  expect(timeline.events).toEqual(events);
  expect(timeline.transcript).toEqual(speech);
  expect(timeline.source).toEqual({ path: "cyclone-s1.zip", sha256: "abc123" });
  const report = decode("README.md");
  expect(report).toContain("Return two indices.");
  expect(report.indexOf("### 00:00 Code")).toBeLessThan(report.indexOf("### 00:01 Speech"));
  expect(report.indexOf("### 00:01 Speech")).toBeLessThan(report.indexOf("### 00:02 Code"));
  expect(report.indexOf("### 00:16 Code")).toBeLessThan(report.indexOf("### 00:16 Run: Wrong Answer"));
});

test("the report records a fallback and transcription warning", () => {
  const meta: SessionMetadata = { sessionId: "s2", startedAt: "2026-09-29T00:00:00Z", endedAt: "2026-09-29T00:00:05Z",
    title: "Two Sum", problemUrl: "https://leetcode.com/problems/two-sum/", language: "python3" };
  const files = new Map(createReports(meta, [], [], "WebGPU unavailable", "abc123", "cyclone-s2.zip",
    "onnx-community/whisper-base.en", "small model unavailable", "onnx-community/whisper-small.en"));
  const timeline = JSON.parse(new TextDecoder().decode(files.get("timeline.json")));
  expect(timeline.transcription).toEqual({ requestedModel: "onnx-community/whisper-small.en",
    model: "onnx-community/whisper-base.en", device: "webgpu",
    status: "failed", fallbackReason: "small model unavailable" });
  expect(new TextDecoder().decode(files.get("README.md"))).toContain("WebGPU unavailable");
});
