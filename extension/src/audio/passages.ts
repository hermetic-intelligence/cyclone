export const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 20;
export type Passage = { startMs: number; endMs: number; samples: Float32Array };

// Preserve all samples. Prefer a quiet boundary after five seconds, and cap passages
// at twenty seconds. These are audio intervals, not inferred word timestamps.
export function passages(samples: Float32Array): Passage[] {
  const out: Passage[] = [];
  let start = 0;
  while (start < samples.length) {
    const limit = Math.min(samples.length, start + MAX_SECONDS * SAMPLE_RATE);
    let end = limit;
    let quiet = 0;
    for (let i = start; i < limit; i += 320) {
      const stop = Math.min(i + 320, limit);
      let power = 0;
      for (let j = i; j < stop; j++) power += samples[j] ** 2;
      quiet = Math.sqrt(power / (stop - i)) < 0.006 ? quiet + stop - i : 0;
      if (stop - start >= 5 * SAMPLE_RATE && quiet >= 0.6 * SAMPLE_RATE) { end = stop; break; }
    }
    const section = samples.slice(start, end);
    // Only skip exact digital silence; quiet speech must never be discarded.
    if (section.some(sample => sample !== 0)) out.push({ startMs: Math.round(start / SAMPLE_RATE * 1000), endMs: Math.round(end / SAMPLE_RATE * 1000), samples: section });
    start = end;
  }
  return out;
}

export function pcmWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const sample = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return bytes;
}
