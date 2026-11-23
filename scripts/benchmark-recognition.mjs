// Start the development server first. Each case runs the real local OMR importer.
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const study = "tests/fixtures/recognition-study";
const cases = [
  { id: "clean", input: study + ".pdf", reference: study + ".musicxml" },
  { id: "skewed", input: study + "-skewed.jpg", reference: study + ".musicxml" },
  { id: "low-contrast", input: study + "-low-contrast.png", reference: study + ".musicxml" },
  {
    id: "dense",
    input: "public/demos/sources/bach-invention-01-a4.pdf",
    reference: "public/demos/bach-invention-01.musicxml",
    selectPages: true,
  },
];
const requested = process.argv.slice(2);
if (requested.some((id) => !cases.some((entry) => entry.id === id)))
  throw Error("Choose clean, skewed, low-contrast, or dense.");

const browser = await chromium.launch({ channel: "chrome" });
const results = [];
try {
  for (const { id, input, reference, selectPages } of cases) {
    if (requested.length && !requested.includes(id)) continue;
    const page = await browser.newPage({ storageState: "tests/fixtures/returning-user.json" });
    try {
      // Keep a file save on the development server from reloading a score mid-test.
      await page.routeWebSocket("**", (socket) => socket.close());
      console.error("Importing", id);
      const xml = await readFile(reference, "utf8");
      await page.goto(process.env.MODSCORE_BENCHMARK_URL || "http://localhost:5173/");
      await page.locator("#files").setInputFiles(input);
      if (selectPages) await page.getByRole("button", { name: "Import selected pages", exact: true }).click();
      await expect(page.locator("#scan-status")).toContainText("Review the pages", { timeout: 60000 });
      await page.getByRole("button", { name: "Recognize locally", exact: true }).click();
      console.error("Running the model for", id);
      await page.waitForFunction(() => {
        const status = document.querySelector("#scan-status")?.textContent ?? "";
        return document.querySelector("#notation svg") ||
          (document.querySelector('[data-action="recognize"]') && !status.includes("Recognizing"));
      }, undefined, { timeout: 240000 });
      const { encoded, report } = await page.evaluate(async ({ id, input, reference, xml }) => {
        const { listScores } = await import("/src/storage.ts");
        const { parseMusicXML } = await import("/src/music.ts");
        const { measureRecognition } = await import("/src/recognition-metrics.ts");
        const score = (await listScores()).find((p) => p.xml && p.pages.length);
        if (!score) throw Error(document.querySelector("#scan-status")?.textContent || "No score was stored.");
        const candidate = parseMusicXML(score.xml);
        return {
          encoded: score.xml,
          report: {
            id, input, reference, pages: score.pages.length,
            ...measureRecognition(parseMusicXML(xml), candidate),
            warnings: candidate.warnings,
          },
        };
      }, { id, input, reference, xml });
      if (process.env.MODSCORE_BENCHMARK_XML_DIR)
        await writeFile(join(process.env.MODSCORE_BENCHMARK_XML_DIR, id + ".musicxml"), encoded);
      results.push(report);
      console.error("Recognized", id);
    } catch (error) {
      results.push({ id, input, reference, error: error.message });
      console.error("Recognition failed", id, error.message);
    } finally {
      await page.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.error)) process.exitCode = 1;
} finally {
  await browser.close();
}
