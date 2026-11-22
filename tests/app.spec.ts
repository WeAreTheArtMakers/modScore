import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function importXml(page: any) {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("public/fixtures/grand-staff.musicxml");
  await page.locator("#notation svg").waitFor();
}
test("score import, sample playback, piano synchronization, seek and MIDI export", async ({
  page,
}) => {
  await importXml(page);
  await expect(page.locator(".key")).toHaveCount(88);
  await expect(page.locator(".key.active")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".key.active")).not.toHaveCount(0);
  await expect(page.locator("#clock")).not.toHaveText("0:00 / 0:10", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".key.active")).toHaveCount(0);
  await page.locator('[data-measure="2"]').click();
  await expect(page.locator("#seek")).toHaveValue("8");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI (.mid)", exact: true }).click();
  const download = await downloading;
  const content = await readFile((await download.path())!);
  expect(content.subarray(0, 4).toString()).toBe("MThd");
});
test("note correction, saved library search, rename and reload", async ({
  page,
}) => {
  await importXml(page);
  await page.getByRole("tab", { name: "Review notes", exact: true }).click();
  await page.locator("#edit-pitch").selectOption("61");
  await page
    .getByRole("button", { name: "Apply correction", exact: true })
    .click();
  await expect(page.locator("#edit-pitch")).toHaveValue("61");
  await page.locator(".score-actions summary").click();
  await page.locator("#rename-title").fill("Local étude ♯");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Local étude ♯");
  await page.reload();
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  await page.locator("#search").fill("étude");
  await expect(page.locator(".score-open")).toHaveCount(1);
  await page.locator(".score-open").click();
  await expect(page.locator("h1")).toHaveText("Local étude ♯");
});
test("mobile layout, light theme, Turkish labels, keyboard and falling notes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#theme").selectOption("light");
  await page.locator("#language").selectOption("tr");
  await expect(page.locator("h1")).toHaveText("Ayarlar");
  await page.getByRole("button", { name: "Sanal piyano", exact: true }).click();
  await expect(page.locator(".key")).toHaveCount(88);
  await page
    .getByRole("button", { name: "Piyano rulosu", exact: true })
    .click();
  await expect(page.locator(".roll")).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
test("real printed image is recognized through the application without uploads", async ({
  page,
}) => {
  test.setTimeout(240000);
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://localhost:5173") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      outbound.push(r.method() + " " + r.url());
  });
  await page.goto("/");
  await page.locator("#files").setInputFiles("docs/validation/input.png");
  await page
    .getByRole("button", { name: "Recognize locally", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await expect(page.locator(".score-meta")).toContainText("19 notes", {
    timeout: 210000,
  });
  await expect(page.locator("#notation svg")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".key.active")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(outbound).toEqual([]);
});
test("two-page PDF imports sequentially into editable scan pages", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("button",{name:"Import selected pages",exact:true}).click();
  await expect(page.locator(".page-strip button")).toHaveCount(2, {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Recognize locally", exact: true }),
  ).toBeVisible();
  await page.locator('[data-page="1"]').click();
  await expect(page.locator(".scan-preview img")).toBeVisible();
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(page.locator(".scan-preview img")).toBeVisible();
});
test('two real images recognize sequentially and combine into one score', async ({page},testInfo)=>{
 test.skip(testInfo.project.name!=='chrome','The mobile profile covers the single-page real engine; this check covers per-page Worker disposal.');
 test.setTimeout(180000);
 await page.goto('/');
 await page.locator('#files').setInputFiles(['docs/validation/input.png','docs/validation/input.png']);
 await expect(page.locator('.page-strip button')).toHaveCount(2);
 await page.getByRole('button',{name:'Recognize locally',exact:true}).click();
 await expect(page.locator('.score-meta')).toContainText('8 measures · 38 notes',{timeout:150000});
 await expect(page.locator('#notation svg')).toBeVisible();
});
