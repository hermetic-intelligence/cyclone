export const TRANSCRIPTION_MODEL = "onnx-community/whisper-small.en";
export const TRANSCRIPTION_FALLBACK_MODEL = "onnx-community/whisper-base.en";
export const TRANSCRIPTION_MODELS = [TRANSCRIPTION_FALLBACK_MODEL, TRANSCRIPTION_MODEL,
  "Xenova/whisper-medium.en",
  "onnx-community/whisper-large-v3-turbo"] as const;
export type TranscriptionModel = typeof TRANSCRIPTION_MODELS[number];
export function isTranscriptionModel(value: unknown): value is TranscriptionModel {
  return typeof value === "string" && TRANSCRIPTION_MODELS.some((model) => model === value);
}

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
