import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.stack));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE", m.text());
  });
  await page.goto("http://localhost:5173");
  await page.getByRole("heading", { name: "Your music, in motion." }).waitFor();
  await page.screenshot({ path: "/tmp/modscore-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Original test score (CC0)", exact: true })
    .click();
  await page.locator("#notation svg").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/modscore-player.png", fullPage: true });
  const metrics = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    const input = parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    return {
      notes: input.notes,
      tempos: input.tempos,
      measures: input.measures,
      warnings: input.warnings,
    };
  });
  console.log(JSON.stringify(metrics));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1500);
  console.log(
    "Active keys",
    await page.locator(".key.active").count(),
    "Clock",
    await page.locator("#clock").textContent(),
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "/tmp/modscore-mobile.png", fullPage: true });
} finally {
  await browser.close();
}
