import { test, expect } from "@playwright/test";
test("different page part counts preserve every note and sequential page offsets", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    const doc = m.xmlDocument(xml);
    const def = doc.querySelector("score-part")!.cloneNode(true) as Element;
    def.id = "P2";
    def.querySelector("part-name")!.textContent = "Extra staff";
    doc.querySelector("part-list")!.append(def);
    const part = doc.querySelector("part")!.cloneNode(true) as Element;
    part.id = "P2";
    doc.documentElement.append(part);
    const second = new XMLSerializer().serializeToString(doc);
    const merged = m.mergePages([xml, second], "Mixed pages");
    const t = m.parseMusicXML(merged);
    return {
      notes: t.notes.length,
      duration: t.duration,
      tracks: t.tracks.length,
      first: t.notes.filter((n) => n.beat < 16).length,
      second: t.notes.filter((n) => n.beat >= 16).length,
      warning: t.warnings.some((s) => s.includes("Page layouts differ")),
    };
  });
  expect(result).toEqual({
    notes: 57,
    duration: 32,
    tracks: 3,
    first: 19,
    second: 38,
    warning: true,
  });
});
test("computer keyboard plays chosen instrument polyphonically, ignores text fields and releases on blur", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Virtual piano", exact: true })
    .click();
  await page.keyboard.down("a");
  await page.keyboard.down("s");
  await expect(page.locator(".key.live")).toHaveCount(2);
  await page.keyboard.up("a");
  await expect(page.locator(".key.live")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".key.live")).toHaveCount(0);
  await page.keyboard.up("s");
  await page.locator("#transpose").focus();
  await page.keyboard.press("a");
  await expect(page.locator(".key.live")).toHaveCount(0);
});
test("MIDI note on/off, sustain and disconnect cleanup use the same live engine", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
  const result = await page.evaluate(async () => {
    const { LiveInput } = await import("/src/live-input.ts");
    const starts: any[] = [],
      stops: any[] = [];
    const engine = {
      touch: async (p: number, v: number) => {
        starts.push([p, v]);
        return () => stops.push(p);
      },
    } as any;
    const live = new LiveInput(engine, () => false);
    live.message("port", [144, 60, 100]);
    live.message("port", [176, 64, 127]);
    live.message("port", [128, 60, 0]);
    const sustained = live.pitches();
    live.message("port", [176, 64, 0]);
    await Promise.resolve();
    const released = live.pitches();
    live.message("port", [144, 64, 0]);
    live.message("port", [144, 67, 127]);
    live.panic();
    await Promise.resolve();
    return { starts, stops, sustained, released, final: live.pitches() };
  });
  expect(result.sustained).toEqual([60]);
  expect(result.released).toEqual([]);
  expect(result.starts.map((x: any) => x[0])).toEqual([60, 67]);
  expect(result.stops.sort()).toEqual([60, 67]);
  expect(result.final).toEqual([]);
});
test("page range validation and PDF selection import only chosen pages and save a draft", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("textbox", { name: "Page range" }).fill("2");
  await page
    .getByRole("button", { name: "Import selected pages", exact: true })
    .click();
  await expect(page.locator(".page-strip button")).toHaveCount(1);
  await page.reload();
  await page.locator(".score-open").first().click();
  await expect(page.locator(".page-strip button")).toHaveCount(1);
});
test("password protected PDF unlocks locally and incorrect passwords can be retried", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-encrypted.pdf");
  await page.getByLabel("PDF password").fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page
    .getByRole("heading", { name: "Incorrect password; try again" })
    .waitFor();
  await page.getByLabel("PDF password").fill("modscore-test");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page
    .getByRole("button", { name: "Import selected pages", exact: true })
    .click();
  await expect(page.locator(".page-strip button")).toHaveCount(2);
});
test("authorized output selection routes the shared AudioContext without microphone capture", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).sinkCalls = [];
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: async (id: string) => {
        (window as any).sinkCalls.push(id);
      },
    });
    Object.defineProperty(navigator.mediaDevices, "selectAudioOutput", {
      configurable: true,
      value: async () => ({
        deviceId: "interface-1",
        label: "Test interface",
        kind: "audiooutput",
      }),
    });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        {
          deviceId: "interface-1",
          label: "Test interface",
          kind: "audiooutput",
        },
      ],
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Audio outputs", exact: true })
    .click();
  await expect(page.locator("#audio-output")).toHaveValue("interface-1");
  await expect
    .poll(() => page.evaluate(() => (window as any).sinkCalls))
    .toEqual(["interface-1"]);
});
