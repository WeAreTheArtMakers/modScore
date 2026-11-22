import { cp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "vendor/partsong";
for (const path of ["omr", "lib", "models"]) {
  try {
    await access(`${root}/${path}`);
  } catch {
    throw Error(
      `Missing ${path}. Run bash vendor/partsong/scripts/fetch-libs.sh and fetch-models.sh first.`,
    );
  }
}
const lock = JSON.parse(await readFile("docs/UPSTREAM.lock.json", "utf8"));
const pdfLock = JSON.parse(await readFile("docs/PDFJS.lock.json", "utf8"));
const audioLock = JSON.parse(await readFile("docs/AUDIO.lock.json", "utf8"));
for (const file of [...lock.files, ...pdfLock.files, ...audioLock.files]) {
  const data = await readFile(file.path);
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== file.sha256)
    throw Error(`Asset integrity mismatch: ${file.path}`);
}
// These directories are generated, never authored source.
for (const dir of ["public/recognition", "public/lib"])
  await rm(dir, { recursive: true, force: true });
await mkdir("public/recognition/lib", { recursive: true });
await mkdir("public/lib", { recursive: true });
for (const path of ["omr", "models"])
  await cp(`${root}/${path}`, `public/recognition/${path}`, {
    recursive: true,
  });
await cp(
  `${root}/lib/onnxruntime-web@1.30.0`,
  "public/recognition/lib/onnxruntime-web@1.30.0",
  { recursive: true },
);
for (const name of ["opensheetmusicdisplay@2.2.0"])
  await cp(`${root}/lib/${name}`, `public/lib/${name}`, { recursive: true });
await cp("vendor/pdfjs-legacy", "public/lib/pdfjs-dist@6.4.299", {
  recursive: true,
});
const worker = await readFile(`${root}/omr-worker.js`, "utf8");
const generated = worker
  .replace(
    "if (res.status !== 200 && res.status !== 206)",
    `if ((res.headers.get("content-type") || "").includes("text/html")) throw new Error("Model asset is missing on this host (received HTML). Restore the model files and rebuild.");
    if (res.status !== 200 && res.status !== 206)`,
  )
  .replace(
    "if (attempt >= 8) {",
    `if (e.message.includes("Model asset is missing")) throw e;
          if (attempt >= 8) {`,
  )
  .replace(
    'post({ type: "result", id: data.id, xml, ms });',
    'post({ type: "result", id: data.id, xml, ms, memory: { pageWasmBytes: pageReader?.memory.buffer.byteLength ?? 0, decoderWasmBytes: decoderInstance?.rs.memory.buffer.byteLength ?? 0 } });',
  )
  .replace(
    /ort.env.wasm.numThreads = self.crossOriginIsolated[\s\S]*?: 1;/,
    "ort.env.wasm.numThreads = 1; // modScore modified 2026-11-20: bound CPU memory on mobile.",
  );
if (generated === worker) throw Error("Worker patch did not apply");
await writeFile("public/recognition/omr-worker.js", generated);
await cp(`${root}/LICENSE`, "LICENSE");
await cp("LICENSE", "public/LICENSE");
await cp("docs/licenses", "public/licenses", { recursive: true });
await cp(
  "docs/licenses/osmd-bundled-NOTICES.txt",
  "public/lib/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js.LICENSE.txt",
);
console.log(
  "Verified pinned assets; prepared local OMR and notation/PDF libraries.",
);

await mkdir("public/audio-pitch", {recursive:true});
await cp("vendor/basic-pitch/nmp.onnx","public/audio-pitch/nmp.onnx");
