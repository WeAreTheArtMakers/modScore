import { mkdtemp, writeFile, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const lock = JSON.parse(await readFile("docs/PDFJS.lock.json", "utf8"));
const response = await fetch(lock.url);
if (!response.ok) throw Error("PDF.js download: " + response.status);
const data = Buffer.from(await response.arrayBuffer());
if (
  "sha512-" + createHash("sha512").update(data).digest("base64") !==
  lock.integrity
)
  throw Error("PDF.js package integrity mismatch");
const temp = await mkdtemp(join(tmpdir(), "modscore-pdf-"));
try {
  const archive = join(temp, "pdf.tgz");
  await writeFile(archive, data);
  execFileSync("tar", [
    "-xzf",
    archive,
    "-C",
    temp,
    "package/legacy/build/pdf.min.mjs",
    "package/legacy/build/pdf.worker.min.mjs",
    "package/standard_fonts",
    "package/wasm",
    "package/cmaps",
  ]);
  await cp(join(temp, "package"), "vendor/pdfjs-legacy", { recursive: true });
  console.log("Verified PDF.js legacy package downloaded.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
