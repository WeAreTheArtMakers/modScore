// First-run setup for macOS, Windows and Linux. No Bash, curl or Rust required.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
const lock = JSON.parse(await readFile("docs/UPSTREAM.lock.json", "utf8"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function valid(file) {
  try { return sha(await readFile(file.path)) === file.sha256; }
  catch { return false; }
}
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw new Error(`Download failed: ${url}`, { cause: error });
      console.log(`Retrying download (${attempt}/3)…`);
    }
  }
}
async function store(file, data) {
  if (sha(data) !== file.sha256) throw Error(`Integrity mismatch: ${file.path}`);
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, data);
}
for (const file of lock.files.filter((f) => f.path.startsWith("vendor/partsong/lib/"))) {
  if (await valid(file)) continue;
  console.log(`Downloading ${file.path}`);
  await store(file, await download("https://cdn.jsdelivr.net/npm/" + file.path.replace("vendor/partsong/lib/", "")));
}
for (const file of lock.files.filter((f) => f.path.startsWith("vendor/partsong/models/"))) {
  if (await valid(file)) continue;
  const name = basename(file.path);
  console.log(`Downloading recognition model ${name}…`);
  const zip = await download("https://github.com/liebharc/homr/releases/download/onnx_checkpoints/" + name.replace(/\.onnx$/, ".zip"));
  const matches = Object.values(unzipSync(zip, { filter: (entry) => entry.name.split("/").pop() === name && entry.originalSize === file.bytes }));
  if (matches.length !== 1) throw Error(`Expected one pinned model in archive: ${name}`);
  await store(file, matches[0]);
}
const pdf = JSON.parse(await readFile("docs/PDFJS.lock.json", "utf8"));
let pdfReady = true;
for (const file of pdf.files) if (!(await valid(file))) { pdfReady = false; break; }
if (!pdfReady) execFileSync(process.execPath, ["scripts/fetch-pdf.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/prepare-assets.mjs"], { stdio: "inherit" });
console.log("modScore is ready. Run npm run dev, then open http://localhost:5173.");
