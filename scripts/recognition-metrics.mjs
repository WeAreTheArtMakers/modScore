import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
const result = JSON.parse(await readFile("omr-validation/result.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:5173");
  await page.locator("h1").waitFor();
  const metrics = await page.evaluate(async (xml) => {
    const { parseMusicXML } = await import("/src/music.ts");
    const expected = parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    const actual = parseMusicXML(xml);
    const pool = [...actual.notes];
    const missing = [];
    let matched = 0;
    for (const n of expected.notes) {
      const i = pool.findIndex(
        (a) =>
          a.pitch === n.pitch &&
          a.staff === n.staff &&
          Math.abs(a.beat - n.beat) < 0.001 &&
          Math.abs(a.duration - n.duration) < 0.001,
      );
      if (i >= 0) {
        pool.splice(i, 1);
        matched++;
      } else missing.push(n);
    }
    return {
      expected: expected.notes.length,
      recognized: actual.notes.length,
      matched,
      precision: matched / actual.notes.length,
      recall: matched / expected.notes.length,
      missing,
      extraOrIncorrect: pool,
      expectedTempos: expected.tempos,
      recognizedTempos: actual.tempos,
      warnings: actual.warnings,
    };
  }, result.xml);
  await mkdir("docs/validation", { recursive: true });
  await writeFile(
    "docs/validation/metrics.json",
    JSON.stringify(
      {
        ...metrics,
        recognitionMs: result.ms,
        wallMs: result.wallMs,
        memory: result.memory,
        host: {
          platform: os.platform(),
          arch: os.arch(),
          cpu: os.cpus()[0].model,
          memoryBytes: os.totalmem(),
        },
        browser: browser.version(),
        path: "CPU WASM, 1 thread; ios resource-disposal flag enabled; desktop Chrome, not iPhone",
        date: "2026-11-20",
      },
      null,
      2,
    ),
  );
  await writeFile("docs/validation/recognized.musicxml", result.xml);
  await writeFile(
    "docs/validation/log.json",
    JSON.stringify(
      result.logs.map(({ xml, ...r }) => r),
      null,
      2,
    ),
  );
  const { copyFile } = await import("node:fs/promises");
  await copyFile("omr-validation/input.png", "docs/validation/input.png");
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
