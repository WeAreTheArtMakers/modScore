import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1200 },
  });
  page.on("console", (m) => console.log(m.text().slice(0, 600)));
  page.on("pageerror", (e) => console.log(e.message));
  await page.goto("http://localhost:5173/validate.html");
  await page.waitForFunction(
    () => window.result !== null,
    {},
    { timeout: 600000 },
  );
  const result = await page.evaluate(() => window.result);
  await mkdir("omr-validation", { recursive: true });
  await writeFile(
    "omr-validation/result.json",
    JSON.stringify(result, null, 2),
  );
  const data = await page.evaluate(() => window.printedPage);
  if (data)
    await writeFile(
      "omr-validation/input.png",
      Buffer.from(data.split(",")[1], "base64"),
    );
  if (result.xml)
    await writeFile("omr-validation/recognized.musicxml", result.xml);
  console.log(
    JSON.stringify({ ...result, xml: result.xml?.slice(0, 200) }, null, 2),
  );
  if (result.type === "error") process.exitCode = 1;
} finally {
  await browser.close();
}
