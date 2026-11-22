import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const started = Date.now();
const errors = [];
const steps = [];
const record = (step) => {
  steps.push({ step, ms: Date.now() - started });
  console.log(step);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("http://localhost:4173");
  await page
    .getByRole("heading", { name: "Your music, in motion.", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  record("Production service worker activated");
  const image = await readFile("docs/validation/input.png");
  await page
    .locator("#files")
    .setInputFiles({
      name: "printed-score.png",
      mimeType: "image/png",
      buffer: image,
    });
  await page
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".score-meta")?.textContent?.includes("19 notes"),
    {},
    { timeout: 180000 },
  );
  await page.locator("#notation svg").waitFor();
  record("Online actual image recognition completed and saved");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare offline use", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Offline assets downloaded." })
    .waitFor({ timeout: 180000 });
  record("Offline asset preparation completed");
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("heading", { name: "Your music, in motion.", exact: true })
    .waitFor();
  record("App shell reopened with network disconnected");
  await page.locator(".score-open").first().click();
  await page.locator("#notation svg").waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".key.active").length > 0,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  record("Saved score and sampled audio played offline");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Audio WAV (.wav)", exact: true })
    .click();
  const file = await downloading;
  const wav = await readFile(await file.path());
  if (wav.subarray(0, 4).toString() !== "RIFF")
    throw Error("Invalid WAV export");
  let energy = 0;
  for (let i = 44; i < wav.length; i += 2)
    energy += Math.abs(wav.readInt16LE(i));
  if (energy < 1000) throw Error("Rendered WAV is silent");
  record(`Offline WAV export produced ${wav.length} bytes of non-silent audio`);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page
    .locator("#files")
    .setInputFiles({
      name: "second-offline-score.png",
      mimeType: "image/png",
      buffer: image,
    });
  await page
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".score-meta")?.textContent?.includes("19 notes"),
    {},
    { timeout: 180000 },
  );
  record("New printed image recognized offline with real cached models");
  await page.screenshot({
    path: "docs/validation/offline-player.png",
    fullPage: true,
  });
  const caches = await page.evaluate(async () => await window.caches.keys());
  const result = {
    passed: true,
    date: "2026-11-20",
    browser: browser.version(),
    steps,
    errors,
    caches,
    offlineWavBytes: wav.length,
    physicalIPhoneTest: false,
  };
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    "docs/validation/offline-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
