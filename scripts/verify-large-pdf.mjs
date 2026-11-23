// Build a large vector PDF in a temporary folder and measure a selective import.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
const dir = await mkdtemp(join(tmpdir(), "modscore-large-pdf-"));
const pdf = join(dir, "forty-page-study.pdf");
let browser;
try {
  const pieces = Array(40).fill("tests/fixtures/recognition-study.pdf");
  let joined = spawnSync("pdfunite", [...pieces, pdf], { encoding: "utf-8" });
  if (joined.error?.code === "ENOENT") {
    joined = spawnSync("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
      `-sOutputFile=${pdf}`, ...pieces], { encoding: "utf-8" });
  }
  if (joined.status !== 0) throw Error(joined.stderr || "Install Poppler pdfunite or Ghostscript.");
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true,
    storageState: "tests/fixtures/returning-user.json",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto("http://localhost:5173/");
  const before = await cdp.send("Runtime.getHeapUsage");
  let peak = before.usedSize;
  const sampler = setInterval(() => {
    void cdp.send("Runtime.getHeapUsage").then(({usedSize}) => { peak = Math.max(peak, usedSize); }).catch(() => {});
  }, 100);
  try {
    await page.locator("#files").setInputFiles(pdf);
    await page.getByRole("textbox", { name: "Page range" }).fill("1-2,40");
    const start = performance.now();
    await page.getByRole("button", { name: "Import selected pages", exact: true }).click();
    await expect(page.locator("#scan-status")).toContainText("Review the pages", { timeout: 50000 });
    await expect(page.locator("[data-page]")).toHaveCount(3);
    const pages = await page.evaluate(async () => {
      const { listScores } = await import("/src/storage.ts");
      return (await listScores()).find((p) => p.title === "forty-page-study").pages.map((b) => b.size);
    });
    expect(pages).toHaveLength(3);
    console.log(JSON.stringify({ pagesInPdf: 40, selected: [1, 2, 40], retainedPages: pages.length,
      pdfBytes: (await stat(pdf)).size, retainedImageBytes: pages.reduce((a, b) => a + b, 0),
      elapsedMs: Math.round(performance.now() - start), rendererJsHeapBeforeBytes: before.usedSize,
      rendererJsHeapPeakBytes: peak }, null, 2));
  } finally {
    clearInterval(sampler);
  }
} finally {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
}
