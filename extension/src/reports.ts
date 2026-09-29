import type { CaptureEvent, SessionMetadata } from "./shared";
import { TRANSCRIPTION_MODEL } from "./shared";

export type TranscriptSegment = { startMs: number; endMs: number; text: string };
const encoder = new TextEncoder();

function fmtTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function markdownFence(content: string, language = ""): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function renderTrace(meta: SessionMetadata, events: CaptureEvent[], speech: TranscriptSegment[], sourceHash: string, warning: string | null, model: string): string {
  const out = [
    `# ${meta.title || "Untitled problem"}`, "",
    "This is the main report. Speech and observed actions appear in time order. Code snapshots show the first state and the last state before each editing pause of at least four seconds. The complete captured events and timed transcript are in `timeline.json`; the raw ZIP also contains the original audio.", "",
    `Problem: ${meta.problemUrl || "Not recorded"}`, "",
    `Language: ${meta.language || "Not recorded"}`, "",
    `Source ZIP SHA-256: \`${sourceHash}\``, "",
    warning ? "Speech transcription was unavailable; see the warning below." : `Speech was transcribed locally with ${model}; check the raw audio for exact words.`, "",
    "## Problem statement", "",
    meta.problemStatement?.trim() ? markdownFence(meta.problemStatement) : "Not captured.", "",
    "## Attempt in time order", ""
  ];

  type Item = { tMs: number; order: number; text: string; code?: string; language?: string };
  const items: Item[] = [];
  let previousCode: string | undefined;
  const changed: Array<{ event: CaptureEvent; index: number }> = [];
  events.forEach((event, index) => {
    if (event.type === "code") {
      if (typeof event.code === "string" && event.code !== previousCode) {
        changed.push({ event, index });
        previousCode = event.code;
      }
      return;
    }
    if (event.type === "run" || event.type === "submit") {
      items.push({ tMs: event.tMs, order: index, text: `${event.type === "run" ? "Run" : "Submit"}${event.result !== undefined ? `: ${event.result}` : ""}` });
    }
  });
  changed.forEach(({ event, index }, position) => {
    const next = changed[position + 1]?.event;
    if (position === 0 || !next || next.tMs - event.tMs >= 4000) {
      items.push({ tMs: event.tMs, order: index, text: "Code", code: event.code, language: event.language || meta.language });
    }
  });
  speech.forEach((segment, index) => items.push({ tMs: segment.startMs, order: events.length + index, text: `You said: ${segment.text}` }));
  items.sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  if (!items.length) out.push("No speech, code, or Run/Submit actions were recorded.", "");
  for (const item of items) {
    out.push(`### ${fmtTime(item.tMs)} ${item.text}`, "");
    if (item.code !== undefined) out.push(markdownFence(item.code, item.language || ""), "");
  }
  if (warning) out.push("## Audio warning", "", warning, "");
  return out.join("\n").trimEnd() + "\n";
}

export function createReports(meta: SessionMetadata, events: CaptureEvent[], speech: TranscriptSegment[], warning: string | null, sourceHash: string, sourcePath: string, model = TRANSCRIPTION_MODEL, fallbackReason: string | null = null, requestedModel = model): Array<[string, Uint8Array]> {
  const sortedEvents = [...events].sort((a, b) => a.tMs - b.tMs);
  const sortedSpeech = [...speech].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const timeline = {
    metadata: meta,
    source: { path: sourcePath, sha256: sourceHash },
    events: sortedEvents,
    transcript: sortedSpeech,
    transcription: { requestedModel, model, device: "webgpu", status: warning ? "failed" : "complete", fallbackReason },
    transcriptionWarning: warning
  };
  return [
    ["README.md", encoder.encode(renderTrace(meta, sortedEvents, sortedSpeech, sourceHash, warning, model))],
    ["timeline.json", encoder.encode(JSON.stringify(timeline, null, 2) + "\n")]
  ];
}
