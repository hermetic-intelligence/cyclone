export const TRANSCRIPTION_MODEL = "onnx-community/whisper-small.en";
export const TRANSCRIPTION_FALLBACK_MODEL = "onnx-community/whisper-base.en";
export const TRANSCRIPTION_MODELS = [TRANSCRIPTION_FALLBACK_MODEL, TRANSCRIPTION_MODEL,
  "Xenova/whisper-medium.en", "onnx-community/whisper-large-v3-turbo"] as const;
export type TranscriptionModel = typeof TRANSCRIPTION_MODELS[number];
export function isTranscriptionModel(value: unknown): value is TranscriptionModel {
  return typeof value === "string" && TRANSCRIPTION_MODELS.some((model) => model === value);
}

export const MODEL_DETAILS: Record<TranscriptionModel, { label: string; hint: string }> = {
  "onnx-community/whisper-base.en": {
    label: "Base — fastest",
    hint: "Fastest local option. Lower accuracy on difficult speech. Audio stays here."
  },
  "onnx-community/whisper-small.en": {
    label: "Small — recommended",
    hint: "Recommended local option. First use downloads a larger model. Audio stays here."
  },
  "Xenova/whisper-medium.en": {
    label: "Medium English — experimental",
    hint: "Experimental: downloads about 1 GB and may need about 5 GB of GPU memory. Falls back to Base if it cannot load. Audio stays here."
  },
  "onnx-community/whisper-large-v3-turbo": {
    label: "Large V3 Turbo — experimental",
    hint: "Experimental: downloads about 1.5 GB and may need about 6 GB of GPU memory. Falls back to Base if it cannot load. Audio stays here."
  }
};
