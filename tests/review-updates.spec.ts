import { test, expect } from "@playwright/test";
test("tempo correction persists exact numeric tempo without interpreting prose", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const data = await page.evaluate(async () => {
    const { setScoreTempo, reviewEncoding } = await import("/src/review.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    const corrected = setScoreTempo(xml, 72, "Slowly, steady tempo");
    const t = parseMusicXML(corrected);
    return {
      tempo: t.tempos[0].bpm,
      notes: t.notes.length,
      words: corrected.includes("Slowly, steady tempo"),
      issues: reviewEncoding(corrected).flatMap((r) => r.issues),
    };
  });
  expect(data).toEqual({ tempo: 72, notes: 19, words: true, issues: [] });
});
test("update prompt is unique and applying saves before activation", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    const { watchUpdates } = await import("/src/updates.ts");
    const reg = new EventTarget() as any,
      container = new EventTarget() as any;
    container.controller = {};
    let saves = 0;
    reg.waiting = {
      postMessage: () => {
        if (!saves) throw Error("Not saved");
        (window as any).activated = true;
      },
    };
    reg.installing = new EventTarget();
    reg.installing.state = "installing";
    (window as any).cleanup = watchUpdates(reg, container, async () => {
      saves++;
    });
    reg.dispatchEvent(new Event("updatefound"));
    reg.installing.dispatchEvent(new Event("statechange"));
    reg.installing.dispatchEvent(new Event("statechange"));
  });
  await expect(page.locator(".update-banner")).toHaveCount(1);
  await page.getByRole("button", { name: "Update app", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).activated))
    .toBe(true);
  await page.evaluate(() => (window as any).cleanup());
  await expect(page.locator(".update-banner")).toHaveCount(0);
});
test("first service-worker installation does not prompt an update", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    const { watchUpdates } = await import("/src/updates.ts");
    const reg = new EventTarget() as any,
      container = new EventTarget() as any;
    reg.waiting = {};
    container.controller = null;
    watchUpdates(reg, container, async () => {});
  });
  await expect(page.locator(".update-banner")).toHaveCount(0);
});
test("missing tie can be corrected explicitly without inventing rhythm", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    const { tieNext, untie } = await import("/src/review.ts");
    const xml = (await (await fetch("/fixtures/grand-staff.musicxml")).text())
      .replace(/<tie\b[^>]*\/>/g, "")
      .replace(/<tied\b[^>]*\/>/g, "");
    const before = parseMusicXML(xml);
    const n = before.notes.find((n) => n.beat === 8 && n.pitch === 64)!;
    const fixed = tieNext(xml, n);
    const t = parseMusicXML(fixed);
    const held = t.notes.find((n) => n.beat === 8 && n.pitch === 64)!;
    return {
      before: before.notes.length,
      after: t.notes.length,
      duration: held.duration,
      removed: parseMusicXML(untie(fixed, held)).notes.length,
    };
  });
  expect(result).toEqual({ before: 20, after: 19, duration: 3, removed: 20 });
});
test('missing model HTML response fails immediately instead of download retries',async({page})=>{await page.route('**/recognition/models/*.onnx',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html>missing model</html>'}));await page.goto('/');await page.locator('h1').waitFor();const message=await page.evaluate(async()=>{const{Recognizer}=await import('/src/omr.ts');const r=new Recognizer();try{await r.init();return 'unexpected success';}catch(e){return(e as Error).message;}finally{r.dispose();}});expect(message).toContain('Model asset is missing');});
