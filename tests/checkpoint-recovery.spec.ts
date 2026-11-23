import { readFile } from "node:fs/promises";
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

test("an invalid recognition result is retried without losing the preceding page", async ({page}) => {
  const valid = await readFile("public/fixtures/grand-staff.musicxml", "utf8");
  let calls = 0;
  await page.route("**/recognition/omr-worker.js*", (route) => {
    const xml = ++calls === 2 ? "<score-partwise/>" : valid;
    return route.fulfill({
      contentType: "text/javascript",
      headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
      body: `self.onmessage = ({data}) => {
        if (data.type === "init") postMessage({type: "ready"});
        else if (data.type === "layout")
          postMessage({type: "result", id: data.id, classes: new Uint8Array(1)});
        else postMessage({type: "result", id: data.id, xml: ${JSON.stringify(xml)}});
      };`,
    });
  });
  await page.goto("/");
  const images = Array(2).fill("tests/fixtures/treble-clef-piano.png");
  await page.locator("#files").setInputFiles(images);
  await expect(page.locator("#scan-status")).toContainText("Review the pages");
  const recognize = page.getByRole("button", { name: "Recognize locally", exact: true });
  await recognize.click();
  await expect(page.locator("#scan-status")).toContainText("No measures were recognized on page 2");
  const checkpoint = async () => page.evaluate(async () => {
    const { listScores } = await import("/src/storage.ts");
    const score = (await listScores()).find((p) => p.pages.length === 2);
    return { count: score?.recognizedPages?.length, complete: !!score?.xml };
  });
  expect(await checkpoint()).toEqual({ count: 1, complete: false });
  await recognize.click();
  await expect(page.locator(".score-meta")).toContainText("38 notes");
  expect(await checkpoint()).toEqual({ count: 2, complete: true });
});

test("a draft saves page edits and can be backed up before recognition", async ({page}) => {
  await page.goto("/");
  const saved = await page.evaluate(async () => {
    const {saveScore} = await import("/src/storage.ts");
    const original = await (await fetch("/tests/fixtures/treble-clef-piano.png")).blob();
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    await saveScore({id: "scan-audit", title: "Draft audit", pages: [original, original],
      originals: [original], recognizedPages: [xml, xml], xml: "", reviewed: false,
      created: 1, updated: 1});
    return original.size;
  });
  await page.getByRole("button", {name: "My scores", exact: true}).first().click();
  await page.locator(".score-row").filter({hasText: "Draft audit"}).getByRole("button", {name: "Export", exact: true}).click();
  await expect(page.getByRole("button", {name: "MIDI (.mid)", exact: true})).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "Project backup (.modscore.json)", exact: true}).click();
  const backup = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(backup.recognizedPages).toHaveLength(2);
  await page.keyboard.press("Escape");
  await page.locator('[data-page="1"]').click();
  await page.getByRole("button", {name: "Rotate", exact: true}).click();
  await expect(page.locator("#scan-status")).toHaveText("Draft changes saved.");
  await page.reload();
  await page.getByRole("button", {name: "My scores", exact: true}).first().click();
  await page.locator(".score-open").filter({hasText: "Draft audit"}).click();
  await expect(page.getByText("1 / 2 pages recognized.")).toBeVisible();
  const draft = await page.evaluate(async () => {
    const {listScores} = await import("/src/storage.ts");
    const p = (await listScores()).find(({id}) => id === "scan-audit")!;
    return {sizes: p.pages.map((b) => b.size), checkpoints: p.recognizedPages?.length};
  });
  expect(draft.checkpoints).toBe(1);
  expect(draft.sizes[0]).toBe(saved);
  expect(draft.sizes[1]).not.toBe(saved);
});
