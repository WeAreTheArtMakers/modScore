import { test, expect } from "@playwright/test";
test("completed scan checkpoints with unequal part counts recover into a playable score", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const payload = await page.evaluate(async () => {
    const { xmlDocument } = await import("/src/music.ts");
    const { exportProject } = await import("/src/storage.ts");
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text(),
      doc = xmlDocument(xml);
    const def = doc.querySelector("score-part")!.cloneNode(true) as Element;
    def.id = "P2";
    def.querySelector("part-name")!.textContent = "Extra staff";
    doc.querySelector("part-list")!.append(def);
    const part = doc.querySelector("part")!.cloneNode(true) as Element;
    part.id = "P2";
    doc.documentElement.append(part);
    const image = await (await fetch("/docs/validation/input.png")).blob();
    return (
      await exportProject({
        id: "old-scan",
        title: "Recovered pages",
        xml: "",
        pages: [image, image],
        originals: [],
        recognizedPages: [xml, new XMLSerializer().serializeToString(doc)],
        reviewed: false,
        created: 1,
        updated: 1,
      })
    ).text();
  });
  await page
    .locator("#files")
    .setInputFiles({
      name: "checkpoint.json",
      mimeType: "application/json",
      buffer: Buffer.from(payload),
    });
  await page
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await expect(page.locator(".score-meta")).toContainText("57 notes");
  await page.locator("#notation svg").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await expect(page.locator(".key.active")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});
