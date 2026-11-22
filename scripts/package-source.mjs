import {
  readdir,
  writeFile,
  copyFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
await copyFile("LICENSE", "dist/LICENSE");
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const p = `${path}/${entry.name}`;
    if (entry.isDirectory()) await walk(p);
    else if (!["dist/source.tar.gz", "dist/offline-assets.json"].includes(p)) files.push("/" + p.slice(5));
  }
}
await walk("dist");
files.sort();
const assets = [];
for (const path of files) {
  const data = await readFile("dist" + path);
  assets.push({
    path,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const digest = createHash("sha256")
  .update(JSON.stringify(assets.filter((a) => a.path !== "/sw.js")))
  .digest("hex")
  .slice(0, 12);
const sw = (await readFile("dist/sw.js", "utf8")).replace(
  /modscore-shell-(?:v1|[a-f0-9]{12})/g,
  "modscore-shell-" + digest,
);
await writeFile("dist/sw.js", sw);
const entry = assets.find((a) => a.path === "/sw.js");
entry.sha256 = createHash("sha256").update(sw).digest("hex");
entry.bytes = Buffer.byteLength(sw);
await writeFile(
  "dist/offline-assets.json",
  JSON.stringify(
    files.filter(
      (p) =>
        !p.startsWith("/recognition/models/") &&
        !p.endsWith("source.tar.gz") &&
        !p.endsWith("validate.html"),
    ),
    null,
    2,
  ),
);
await mkdir("docs", { recursive: true });
await writeFile("docs/ASSET_MANIFEST.json", JSON.stringify(assets, null, 2));
execFileSync("tar", [
  "-czf",
  "dist/source.tar.gz",
  "--exclude=node_modules",
  "--exclude=dist",
  "--exclude=.git",
  "--exclude=public/recognition",
  "--exclude=public/lib",
  "--exclude=vendor/partsong/models",
  "--exclude=vendor/pdfjs-legacy",
  "--exclude=vendor/partsong/lib",
  "--exclude=test-results",
  "--exclude=playwright-report",
  "--exclude=omr-validation",
  "--exclude=public/source.tar.gz",
  ".gitignore",
  ".gitattributes",
  ".github",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.tr.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "playwright.config.ts",
  "index.html",
  "src",
  "public",
  "scripts",
  "tests",
  "docs",
  "vendor",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "ARCHITECTURE.md",
]);
console.log(
  `Static app and matching AGPL corresponding-source archive written to dist/. Shell ${digest}.`,
);
