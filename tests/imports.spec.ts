import { test, expect } from "@playwright/test";
test("PDF import works when new Map and WeakMap methods are absent in both realms", async ({
  page,
}) => {
  const remove = `delete Map.prototype.getOrInsertComputed;delete Map.prototype.getOrInsert;delete WeakMap.prototype.getOrInsertComputed;delete WeakMap.prototype.getOrInsert;`;
  await page.addInitScript(remove);
  await page.route("**/legacy/build/pdf.worker.min.mjs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: remove + "\n" + (await response.text()),
    });
  });
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("button",{name:"Import selected pages",exact:true}).click();
  await expect(page.locator(".page-strip button")).toHaveCount(2, {
    timeout: 30000,
  });
  await expect(page.locator(".scan-preview img")).toBeVisible();
  expect(workers.some((url) => url.includes("/legacy/build/"))).toBe(true);
  expect(
    await page.evaluate(
      () => typeof (Map.prototype as any).getOrInsertComputed,
    ),
  ).toBe("function");
});
test("content classification handles extensionless PDF/MIDI and rejects mixed imports", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { classifyImport, planImport } = await import("/src/imports.ts");
    const kinds = await Promise.all(
      [
        new File(["%PDF-1.7\n"], "no-extension"),
        new File(["MThd123"], "sound.bin"),
        new File(['<?xml version="1.0"?><score-partwise/>'], "notes.data"),
      ].map(classifyImport),
    );
    let mixed = "";
    try {
      await planImport([
        new File(["%PDF-1.7\n"], "a.pdf"),
        new File(["<score-partwise/>"], "b.xml"),
      ]);
    } catch (e) {
      mixed = (e as Error).message;
    }
    let damaged = "";
    try {
      await classifyImport(new File(["not PDF"], "broken.pdf"));
    } catch (e) {
      damaged = (e as Error).message;
    }
    return { kinds, mixed, damaged };
  });
  expect(result.kinds).toEqual(["pdf", "midi", "xml"]);
  expect(result.mixed).toContain("one MusicXML");
  expect(result.damaged).toContain("PDF header");
});
test("a failed appended PDF preserves previously imported pages and allows retry", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("button",{name:"Import selected pages",exact:true}).click();
  await expect(page.locator(".page-strip button")).toHaveCount(2);
  await page.locator("#files").setInputFiles({
    name: "damaged.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nnot a valid document"),
  });
  await expect(page.locator("#scan-status")).toContainText("Import failed");
  await expect(page.locator(".page-strip button")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Recognize locally", exact: true }),
  ).toBeVisible();
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("button",{name:"Import selected pages",exact:true}).click();
  await expect(page.locator(".page-strip button")).toHaveCount(4);
});
test("PDF cancellation releases the loading task and reports AbortError", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { pdfImages } = await import("/src/omr.ts");
    const controller = new AbortController();
    controller.abort();
    try {
      for await (const image of pdfImages(
        new File(["%PDF-1.7"], "cancel.pdf"),
        controller.signal,
      ))
        void image;
      return "not cancelled";
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(result).toBe("AbortError");
});
test("cancelling a loaded multi-page PDF stops the next page and keeps the completed image", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { pdfImages } = await import("/src/omr.ts");
    const bytes = await (
      await fetch("/tests/fixtures/study-two-pages.pdf")
    ).arrayBuffer();
    const controller = new AbortController(),
      iterator = pdfImages(new File([bytes], "study.pdf"), controller.signal);
    const first = await iterator.next();
    controller.abort();
    let error = "";
    try {
      await iterator.next();
    } catch (e) {
      error = (e as Error).name;
    }
    return { bytes: first.value?.size || 0, error };
  });
  expect(result.bytes).toBeGreaterThan(1000);
  expect(result.error).toBe("AbortError");
});
test("project imports preserve recognized page checkpoints", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { exportProject, validateProject } = await import("/src/storage.ts");
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    const project = {
      id: "checkpoint",
      title: "Scan",
      xml: "",
      pages: [new Blob(["image"])],
      originals: [],
      created: 1,
      updated: 1,
      reviewed: false,
      recognizedPages: [xml],
    };
    const restored = validateProject(
      JSON.parse(await (await exportProject(project)).text()),
    );
    return restored.recognizedPages;
  });
  expect(result).toHaveLength(1);
  expect(result![0]).toContain("score-partwise");
});
test('binary WebP and HEIC size fields do not corrupt content detection',async({page})=>{await page.goto('/');await page.locator('h1').waitFor();const kinds=await page.evaluate(async()=>{const{classifyImport}=await import('/src/imports.ts');const webp=new Uint8Array([82,73,70,70,194,160,0,0,87,69,66,80]);const heic=new Uint8Array([194,160,0,0,102,116,121,112,104,101,105,99]);return Promise.all([new File([webp],'picture'),new File([heic],'photo')].map(classifyImport));});expect(kinds).toEqual(['image','image']);});
