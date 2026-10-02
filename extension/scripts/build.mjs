import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { background: "src/background.ts", content: "src/content.ts", offscreen: "src/offscreen.ts", popup: "src/popup.ts", permission: "src/permission.ts", settings: "src/settings/index.tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: dist,
  entryNames: "[name]"
});
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const buildNumber = process.env.CYCLONE_BUILD_NUMBER;
if (buildNumber) {
  const number = Number(buildNumber);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error("CYCLONE_BUILD_NUMBER must be an integer from 1 to 65535");
  manifest.version = `${manifest.version}.${number}`;
}
await writeFile(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const filename of ["popup.html", "offscreen.html", "permission.html", "settings.html"]) {
  await copyFile(resolve(root, filename), resolve(dist, filename));
}
await mkdir(resolve(dist, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const filename = `icon-${size}.png`;
  await copyFile(resolve(root, "icons", filename), resolve(dist, "icons", filename));
}
for (const filename of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  await copyFile(resolve(root, "node_modules/onnxruntime-web/dist", filename), resolve(dist, filename));
}
