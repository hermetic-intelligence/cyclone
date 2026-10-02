import type { TranscriptionModel } from "./models/catalog";
export { TRANSCRIPTION_MODEL, TRANSCRIPTION_FALLBACK_MODEL, TRANSCRIPTION_MODELS, isTranscriptionModel } from "./models/catalog";
export type { TranscriptionModel } from "./models/catalog";

export type CaptureEvent = {
  tMs: number;
  type: "code" | "run" | "submit";
  code?: string;
  language?: string;
  result?: string;
};

export type SessionMetadata = {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  problemUrl: string;
  title: string;
  problemStatement?: string | null;
  language: string;
};

export type ActiveSession = {
  sessionId: string;
  tabId: number;
  startedAtMs: number;
  startedAt: string;
  transcriptionModel?: TranscriptionModel;
};

export type PageEvent = Omit<CaptureEvent, "tMs">;

export type Message =
  | { type: "toggle" }
  | { type: "get-status" }
  | { type: "set-transcription-model"; model: TranscriptionModel }
  | { type: "get-model-cache" }
  | { type: "remove-model-cache"; model: string | null }
  | { type: "agree-upload" }
  | { type: "page-start"; metadata: Omit<SessionMetadata, "sessionId" | "startedAt" | "endedAt">; initialCode: string }
  | { type: "page-event"; event: PageEvent }
  | { type: "offscreen-start"; metadata: SessionMetadata }
  | { type: "offscreen-event"; event: CaptureEvent }
  | { type: "offscreen-stop"; endedAt: string }
  | { type: "offscreen-raw"; sessionId: string; sourceHash: string }
  | { type: "offscreen-failed"; sessionId: string; reason: string }
  | { type: "offscreen-process"; sessionId: string; sourceHash: string; sourcePath: string; model: TranscriptionModel }
  | { type: "offscreen-report-ready"; sessionId: string; url: string }
  | { type: "offscreen-report-failed"; sessionId: string; reason: string }
  | { type: "offscreen-cleanup"; sessionId: string; url?: string }
  | { type: "offscreen-upload-pending" }
  | { type: "upload-status"; status: "uploading" | "saved" | "retry"; detail?: string }
  | { type: "offscreen-revoke"; url: string }
  | { type: "mic-permission-granted"; tabId: number };
