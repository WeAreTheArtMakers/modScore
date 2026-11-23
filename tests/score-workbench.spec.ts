import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("an exact chord head can be auditioned, edited and deleted with undo and redo across restarts", async ({page}) => {
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      (window as any).previewStarts = ((window as any).previewStarts ?? 0) + 1;
      return start.apply(this, args);
    };
  });
  await page.goto("/");
  await page.locator("#files").setInputFiles("public/fixtures/grand-staff.musicxml");
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page.getByRole("button", {name: "Edit on score", exact: true}).click();
  const heads = page.locator("#notation [data-score-note-source]");
  const chord = heads.filter({has: page.locator("path")}).and(page.locator('[aria-label="E3"]')).first();
  await chord.click();
  await expect(page.locator("#inline-step")).toHaveValue("E");
  await expect.poll(() => page.evaluate(() => (window as any).previewStarts ?? 0)).toBeGreaterThan(0);
  await page.locator("#inline-step").selectOption("F");
  await page.getByRole("button", {name: "Save pitch", exact: true}).click();
  await expect(page.locator("#notation [aria-pressed='true']")).toHaveAttribute("aria-label", "F3");
  await page.getByRole("button", {name: "Delete note", exact: true}).click();
  const state = () => page.evaluate(async () => {
    const {listScores} = await import("/src/storage.ts");
    const {parseMusicXML} = await import("/src/music.ts");
    return parseMusicXML((await listScores()).find((p) => p.title === "grand-staff")!.xml)
      .notes.filter((n) => n.beat === 0 && n.staff === 2).map((n) => n.pitch);
  });
  await expect.poll(state).toEqual([48]);
  async function reopen() {
    await page.reload();
    await page.getByRole("button", {name: "My scores", exact: true}).first().click();
    await page.locator(".score-open").filter({hasText: "grand-staff"}).click();
    await page.getByRole("button", {name: "Edit on score", exact: true}).click();
  }
  await reopen();
  const undo = page.getByRole("button", {name: "Undo last note edit", exact: true});
  const redo = page.getByRole("button", {name: "Redo note edit", exact: true});
  await undo.click();
  await expect.poll(state).toEqual([48,53]);
  await reopen();
  await expect(redo).toBeEnabled();
  await undo.click();
  await expect.poll(state).toEqual([48,52]);
  await redo.click();
  await expect.poll(state).toEqual([48,53]);
  await redo.click();
  await expect.poll(state).toEqual([48]);
  const history = await page.evaluate(async () => {
    const { listScores, exportProject, validateProject } = await import("/src/storage.ts");
    const score = (await listScores()).find((p) => p.title === "grand-staff")!;
    const restored = validateProject(JSON.parse(await (await exportProject(score)).text()));
    return restored.editHistory;
  });
  expect(history?.past).toHaveLength(2);
  expect(history?.future).toHaveLength(0);
});

test("saved recording points interpolate from the selected score measure and survive backup", async ({page}) => {
  await page.goto("/");
  await page.locator('[data-demo="basic"]').click();
  await page.getByText("Attach and align recording", {exact: true}).click();
  const save = page.getByRole("button", {name: "Save alignment point", exact: true});
  for (const [measure, seconds] of [["0","10"],["4","22"]]) {
    await page.locator("#mark-measure").selectOption({value: measure});
    await page.locator("#mark-seconds").fill(seconds);
    await save.click();
    await expect(page.locator(`[data-remove-mark="${measure}"]`)).toBeVisible();
  }
  await page.locator('[data-measure="2"]').click();
  await page.getByRole("button", {name: "A · Listen to source", exact: true}).click();
  const source = page.locator<HTMLAudioElement>("#original-audio");
  await expect.poll(() => source.evaluate((a) => a.currentTime)).toBeGreaterThan(15.95);
  expect(await source.evaluate((a) => a.currentTime)).toBeLessThan(16.8);
  const points = await page.evaluate(async () => {
    const { listScores, exportProject, validateProject } = await import("/src/storage.ts");
    const p = (await listScores()).find((p) => p.id === "modscore-demo-basic-v4")!;
    return validateProject(JSON.parse(await (await exportProject(p)).text())).sourceAlignment?.points;
  });
  expect(points).toEqual([{measure: 0, seconds: 10}, {measure: 4, seconds: 22}]);
  await page.locator('[data-remove-mark="4"]').click();
  await expect(page.locator("[data-remove-mark]")).toHaveCount(1);
});

test("the three recognition cues and pitch, onset and duration metrics are independent", async ({page}) => {
  const xml = await readFile("tests/fixtures/recognition-study.musicxml", "utf8");
  await page.goto("/");
  const r = await page.evaluate(async (xml) => {
    const { reviewEncoding } = await import("/src/review.ts");
    const { measureRecognition } = await import("/src/recognition-metrics.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const {saveScore} = await import("/src/storage.ts");
    const t = parseMusicXML(xml);
    const altered = t.notes.map((n) => ({...n}));
    altered.find((n) => n.staff === 1 && n.measure === 0)!.pitch--;
    altered.find((n) => n.staff === 1 && n.measure === 1)!.beat += 0.08;
    altered.find((n) => n.staff === 1 && n.measure === 2)!.duration -= 0.2;
    await saveScore({id:"recognition-cues", title:"Recognition cues", xml, created:1, updated:1,
      reviewed:false, originals:[], pages:[new Blob(["mock page"], {type:"image/png"})]});
    return {
      sizes: reviewEncoding(xml).map((m) => [m.shortNotes, m.tuplets, m.cluster]),
      metrics: measureRecognition(t, {...t, notes: altered}).measures,
    };
  }, xml);
  expect(r.sizes).toEqual([[16,0,1],[0,12,1],[0,0,4]]);
  expect(r.metrics.map((m) => [m.wrongPitch, m.onsetErrors, m.durationErrors, m.missing]))
    .toEqual([[1,0,0,0],[0,1,0,0],[0,0,1,0]]);
  await page.getByRole("button", {name:"My scores",exact:true}).first().click();
  await page.locator('.score-open').filter({hasText:"Recognition cues"}).click();
  await expect(page.locator(".measure-review-mark")).toHaveCount(3);
  await page.getByText("Measures to review · 3", {exact:true}).click();
  await page.locator('[data-review-measure="1"]').click();
  await expect(page.locator("#edit-select option:checked")).toContainText("Measure 2");
});

test("an ambiguous tie across recognized pages is flagged without joining two attacks", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { saveScore } = await import("/src/storage.ts");
    const { mergePages } = await import("/src/music.ts");
    const fragment = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
    await saveScore({
      id: "cross-page-tie", title: "Cross-page tie", xml: mergePages([fragment, fragment], "Cross-page tie"),
      pages: [new Blob(), new Blob()], originals: [], reviewed: false, created: 1, updated: 1,
    });
  });
  await page.getByRole("button", { name: "My scores", exact: true }).first().click();
  await page.locator(".score-open").filter({ hasText: "Cross-page tie" }).click();
  await expect(page.locator(".score-meta")).toContainText("2 measures · 2 notes");
  await expect(page.locator(".measure-review-mark[title*='Check ties across the page break']")).toHaveCount(2);
});
