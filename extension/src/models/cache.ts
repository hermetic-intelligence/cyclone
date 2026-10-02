// Keep the library's existing cache name so upgrades can manage earlier downloads.
export const MODEL_CACHE_NAME = "transformers-cache";
export const MODEL_CACHE_LOCK = "cyclone-model-cache";
export type CachedModel = { model: string; files: number; bytes: number; unknownSizeFiles: number };

export function modelForCacheURL(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://huggingface.co") return null;
    const match = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/resolve\/[^/]+\/.+/);
    return match?.[1] ?? null;
  } catch { return null; }
}

export async function cachedModels(): Promise<CachedModel[]> {
  if (!await caches.has(MODEL_CACHE_NAME)) return [];
  const cache = await caches.open(MODEL_CACHE_NAME);
  const models = new Map<string, CachedModel>();
  for (const key of await cache.keys()) {
    const model = modelForCacheURL(key.url);
    if (!model) continue;
    const response = await cache.match(key);
    if (!response) continue;
    const entry = models.get(model) ?? { model, files: 0, bytes: 0, unknownSizeFiles: 0 };
    const length = response.headers.get("content-length");
    const bytes = length === null ? NaN : Number(length);
    entry.files++;
    if (Number.isFinite(bytes) && bytes >= 0) entry.bytes += bytes;
    else entry.unknownSizeFiles++;
    models.set(model, entry);
  }
  return [...models.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export async function removeCachedModels(model: string | null): Promise<number> {
  if (!await caches.has(MODEL_CACHE_NAME)) return 0;
  const cache = await caches.open(MODEL_CACHE_NAME);
  let removed = 0;
  for (const key of await cache.keys()) {
    const cachedModel = modelForCacheURL(key.url);
    if (cachedModel && (model === null || model === cachedModel)) {
      if (await cache.delete(key)) removed++;
    }
  }
  return removed;
}
