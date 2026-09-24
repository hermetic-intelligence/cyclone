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
};

export type PageEvent = Omit<CaptureEvent, "tMs">;

export type Message =
  | { type: "toggle" }
  | { type: "get-status" }
  | { type: "page-start"; metadata: Omit<SessionMetadata, "sessionId" | "startedAt" | "endedAt">; initialCode: string }
  | { type: "page-event"; event: PageEvent }
  | { type: "offscreen-start"; metadata: SessionMetadata }
  | { type: "offscreen-event"; event: CaptureEvent }
  | { type: "offscreen-stop"; endedAt: string }
  | { type: "offscreen-failed"; sessionId: string; reason: string }
  | { type: "offscreen-export" }
  | { type: "offscreen-revoke"; url: string }
  | { type: "mic-permission-granted"; tabId: number };
