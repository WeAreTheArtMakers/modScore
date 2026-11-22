import { test, expect } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("first launch opens Basic Music once, plays score and piano, and keeps both 32-bar demos editable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Basic Music");
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await expect(page.locator("[data-measure]")).toHaveCount(32);
  await expect(page.locator(".demo-banner")).toContainText(
    "automatic transcription",
  );
  await page
    .getByRole("button", { name: "Start guided demo", exact: true })
    .click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  await expect(page.locator("#demo-banner")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await page.getByRole("button", { name: "Stop tour", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Loop 1–4", exact: true }).click();
  await expect(page.locator("#loop-on")).toBeChecked();
  await page.locator('.demo-features [data-action="demo-metronome"]').click();
  await expect(page.locator("#metronome")).toBeChecked();
  await page
    .getByRole("button", { name: "Try Beethoven", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("Ode to Joy");
  await expect(page.locator("[data-measure]")).toHaveCount(32);
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page.reload();
  await expect(page.locator("#demo-banner")).toHaveCount(0);
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  await expect(page.locator(".score-open")).toHaveCount(2);
  const result = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    return Promise.all(
      ["basic-music-32", "beethoven-ode-to-joy-32"].map(async (name) => {
        const t = parseMusicXML(
          await (await fetch(`/demos/${name}.musicxml`)).text(),
        );
        return {
          bars: t.measures.length,
          beats: t.duration,
          notes: t.notes.length,
          tempo: t.tempos[0].bpm,
          warnings: t.warnings,
        };
      }),
    );
  });
  expect(result[0]).toMatchObject({
    bars: 32,
    beats: 128,
    notes: 566,
    tempo: 112,
  });
  expect(result[1]).toMatchObject({
    bars: 32,
    beats: 128,
    notes: 348,
    tempo: 96,
    warnings: [],
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("returning library is preserved and a deleted demo is not silently re-added", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Basic Music");
  await page.evaluate(async () => {
    const { deleteScore } = await import("/src/storage.ts");
    await deleteScore("modscore-demo-basic-v1");
  });
  await page.reload();
  await expect(page.locator("#demo-banner")).toHaveCount(0);
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  await expect(page.locator(".score-open")).toHaveCount(0);
});
test("audio source workflow produces real MIDI from a locally inferred piano recording", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Real inference is covered in desktop Chrome; responsive source controls are checked separately.",
  );
  test.setTimeout(180000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Audio & YouTube", exact: true })
    .click();
  // Original authored A-minor arpeggio: real PCM, no mocked network/model/results.
  const wav = await page.evaluate(() => {
    const rate = 22050,
      seconds = 5,
      data = new ArrayBuffer(44 + rate * seconds * 2),
      v = new DataView(data);
    const text = (at: number, s: string) =>
      [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF");
    v.setUint32(4, data.byteLength - 8, true);
    text(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    text(36, "data");
    v.setUint32(40, rate * seconds * 2, true);
    const pitches = [57, 60, 64, 69];
    for (let i = 0; i < rate * seconds; i++) {
      const t = i / rate,
        j = Math.floor(t),
        age = t - j;
      let x = 0;
      if (j < 4) {
        const f = 440 * 2 ** ((pitches[j] - 69) / 12);
        x =
          0.45 *
          Math.exp(-age * 3) *
          Math.min(1, age * 150) *
          (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
      }
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true);
    }
    return Array.from(new Uint8Array(data));
  });
  await page.locator("#audio-file").setInputFiles({
    name: "Original arpeggio.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(wav),
  });
  await page.locator("#audio-title").fill("Local arpeggio");
  await page.locator("#audio-bpm").fill("60");
  await page.locator("#audio-bars").selectOption("8");
  await page
    .getByRole("button", { name: "Create piano score", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("Local arpeggio", {
    timeout: 120000,
  });
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await expect(page.locator(".warnings")).toContainText(
    "Automatic audio transcription",
  );
  const notes = await page.evaluate(async () => {
    const { listScores } = await import("/src/storage.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const p = (await listScores()).find((p) => p.title === "Local arpeggio")!;
    return parseMusicXML(p.xml).notes.map((n) => n.pitch);
  });
  for (const pitch of [57, 60, 64, 69]) expect(notes).toContain(pitch);
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(page.locator("audio[controls]")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI (.mid)", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.mid$/);
});
test("YouTube links are validated before network and helper failure offers the audio fallback", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Audio & YouTube", exact: true })
    .click();
  await page
    .locator("#youtube-url")
    .fill("https://example.org/watch?v=AN0wGBUxkIk");
  await page
    .getByRole("button", { name: "Create piano score", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("not a supported YouTube");
  await page.route("http://127.0.0.1:8790/**", (r) =>
    r.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Another video is being prepared." }),
    }),
  );
  await page.locator("#youtube-url").fill("https://youtu.be/AN0wGBUxkIk");
  await page
    .getByRole("button", { name: "Create piano score", exact: true })
    .click();
  await expect(page.locator(".toast").last()).toContainText(
    "Another video is being prepared",
  );
  await page.unroute("http://127.0.0.1:8790/**");
  await page.route("http://127.0.0.1:8790/**", (r) => r.abort());
  await page
    .getByRole("button", { name: "Create piano score", exact: true })
    .click();
  await expect(page.locator(".toast").last()).toContainText("local helper");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("guided tour advances through loop, metronome and keyboard with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Basic Music");
  await page
    .getByRole("button", { name: "Start guided demo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.runFor(9000);
  await expect(page.locator("#loop-on")).toBeChecked();
  await page.clock.runFor(20000);
  await expect(page.locator("#metronome")).toBeChecked();
  await page.clock.runFor(12000);
  await expect(page.locator("#loop-on")).not.toBeChecked();
  await expect(page.locator("#typing-help")).toHaveAttribute("open", "");
  expect(
    await page
      .locator(".demo-bars i")
      .first()
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
  await page.getByRole("button", { name: "Stop tour", exact: true }).click();
});
