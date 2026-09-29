import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const outputDir = resolve(root, ".outputs");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
if (manifest.version !== sourceManifest.version || manifest.manifest_version !== 3) {
  throw new Error("The built manifest is stale or is not Manifest V3.");
}

const files = (await readdir(dist)).filter((name) => name !== "FRIENDS.md" && name !== "icons");
files.push(...(await readdir(resolve(dist, "icons"))).map((name) => `icons/${name}`));
files.sort();
for (const name of files) {
  if (!(await stat(resolve(dist, name))).isFile()) throw new Error(`Unexpected non-file in dist: ${name}`);
}
for (const required of ["background.js", "content.js", "manifest.json", "offscreen.js", "popup.js",
  "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "icons/icon-128.png"]) {
  if (!files.includes(required)) throw new Error(`Missing extension file: ${required}`);
}

await mkdir(outputDir, { recursive: true });
const output = resolve(outputDir, `Cyclone-${manifest.version}-store.zip`);
await rm(output, { force: true });
execFileSync("zip", ["-q", "-X", "-9", output, ...files], { cwd: dist });
const size = (await stat(output)).size;
console.log(`${output} (${size.toLocaleString()} bytes)`);
