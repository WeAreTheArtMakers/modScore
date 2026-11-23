import { test, expect } from "@playwright/test";
import { parseMidi } from "midi-file";
test("Basic Music matches the supplied opening, three flats, 35 written bars and the complete repeat", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { parseMusicXML, beatToSeconds } = await import("/src/music.ts");
    const { writtenBeat } = await import("/src/repeats.ts");
    const { exportMidi } = await import("/src/midi.ts");
    const xml = await (await fetch("/demos/basic-music.musicxml")).text(),
      t = parseMusicXML(xml);
    return {
      key: t.key,
      written: t.writtenMeasures,
      beats: t.duration,
      seconds: beatToSeconds(t.duration, t.tempos),
      notes: t.notes.length,
      warnings: t.warnings,
      first: t.notes
        .filter((n) => n.staff === 1 && n.beat < 4)
        .map((n) => [n.pitch, n.beat, n.duration]),
      firstBass: t.notes
        .filter((n) => n.staff === 2 && n.beat < 4)
        .map((n) => n.pitch),
      second: t.notes
        .filter((n) => n.staff === 1 && n.beat >= 136 && n.beat < 140)
        .map((n) => [n.pitch, n.beat - 136, n.duration]),
      sourceAtRepeat: writtenBeat(t, 136),
      high: t.notes
        .filter((n) => n.staff === 1 && n.beat >= 28 && n.beat < 32)
        .map((n) => n.pitch),
      midi: Array.from(new Uint8Array(await exportMidi(t).arrayBuffer())),
      falseArticulations: (xml.match(/<articulations>/g) || []).length,
    };
  });
  expect(r.key).toEqual({ fifths: -3, mode: "minor" });
  expect(r.written).toBe(35);
  expect(r.beats).toBe(272);
  expect(r.seconds).toBeCloseTo(148.363636, 5);
  expect(r.notes).toBe(1236);
  expect(r.warnings).toEqual([]);
  expect(r.sourceAtRepeat).toBe(0);
  expect(r.first).toEqual([
    [60, 0, 0.5],
    [65, 0.5, 0.25],
    [67, 0.75, 0.25],
    [65, 1, 0.5],
    [62, 1.5, 0.5],
    [59, 2, 0.5],
    [63, 2.5, 0.25],
    [65, 2.75, 0.25],
    [63, 3, 0.5],
    [60, 3.5, 0.5],
  ]);
  expect(r.firstBass).toEqual([48, 53, 55, 53, 50, 47, 51, 53, 51, 48]);
  expect(r.second).toEqual(r.first);
  expect(r.high).toContain(95);
  expect(r.falseArticulations).toBe(0);
  const midi = parseMidi(Uint8Array.from(r.midi));
  expect(midi.tracks.flat().filter((e) => e.type === "keySignature")).toEqual([
    expect.objectContaining({ key: -3, scale: 1 }),
  ]);
  expect(midi.tracks.flat().filter((e) => e.type === "noteOn")).toHaveLength(
    1236
  );
});
test("notation retains chromatic pitches, chosen key/meter and independent unquantized performance", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { audioNotesToScore } = await import("/src/piano-score.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const notes = [
      {
        pitchMidi: 60,
        startTimeSeconds: 0,
        durationSeconds: 0.9,
        amplitude: 0.8,
      },
      {
        pitchMidi: 63,
        startTimeSeconds: 0.137,
        durationSeconds: 0.29,
        amplitude: 0.7,
      },
      {
        pitchMidi: 59,
        startTimeSeconds: 0.831,
        durationSeconds: 0.31,
        amplitude: 0.7,
      },
    ];
    const out = audioNotesToScore(notes, {
      title: "C minor",
      bpm: 60,
      bars: 8,
      key: { fifths: -3, mode: "minor" },
      meter: { beats: 6, beatType: 8 },
      grid: 0.25,
      trimStart: false,
    });
    const t = parseMusicXML(out.xml);
    const dom = new DOMParser().parseFromString(out.xml, "application/xml");
    return {
      performance: out.performance,
      notes: t.notes.map((n) => ({ pitch: n.pitch, beat: n.beat })),
      key: t.key,
      duration: t.duration,
      warning: t.warnings,
      spelling: Array.from(dom.querySelectorAll("note > pitch")).map((n) => [
        n.querySelector("step")?.textContent,
        n.querySelector("alter")?.textContent,
      ]),
      meter: t.measures[0].meter,
    };
  });
  expect(r.performance[1].beat).toBe(0.137);
  expect(r.notes.find((n) => n.pitch === 63)?.beat).toBe(0.25);
  expect(r.notes.some((n) => n.pitch === 59)).toBe(true);
  expect(r.key).toEqual({ fifths: -3, mode: "minor" });
  expect(r.spelling).toContainEqual(["E", "-1"]);
  expect(r.meter).toEqual({ beats: 6, beatType: 8 });
  expect(r.duration).toBe(24);
  expect(r.warning).toHaveLength(1);
});
test("explicit detection profiles remove weak short noise and preserve stronger repeated attacks and chromatic notes", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { cleanDetections } = await import("/src/audio-analysis.ts");
    const input = [
      {
        pitchMidi: 60,
        startTimeSeconds: 0,
        durationSeconds: 1,
        amplitude: 0.8,
      },
      {
        pitchMidi: 60,
        startTimeSeconds: 0.5,
        durationSeconds: 0.3,
        amplitude: 0.9,
      },
      {
        pitchMidi: 59,
        startTimeSeconds: 1,
        durationSeconds: 0.3,
        amplitude: 0.7,
      },
      {
        pitchMidi: 91,
        startTimeSeconds: 1.2,
        durationSeconds: 0.045,
        amplitude: 0.21,
      },
    ];
    return {
      clean: cleanDetections(input, "clean"),
      detailed: cleanDetections(input, "detailed"),
    };
  });
  expect(r.clean.map((n) => n.pitchMidi)).toEqual([60, 60, 59]);
  expect(r.clean[0].durationSeconds).toBe(0.5);
  expect(r.detailed.map((n) => n.pitchMidi)).toContain(91);
});
test("articulations alter performed release and accents without rewriting notation, and signed MIDI keys round-trip", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { pianoScore } = await import("/src/piano-score.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const { exportMidi, midiToXml } = await import("/src/midi.ts");
    const xml = pianoScore(
      [
        {
          pitch: 63,
          beat: 0,
          duration: 1,
          velocity: 0.7,
          articulation: "staccato",
        },
        {
          pitch: 59,
          beat: 1,
          duration: 1,
          velocity: 0.7,
          articulation: "accent",
        },
      ],
      {
        title: "Articulation",
        composer: "Test",
        bars: 1,
        bpm: 60,
        key: { fifths: -3, mode: "minor" },
      }
    );
    const t = parseMusicXML(xml),
      bytes = await exportMidi(t).arrayBuffer(),
      round = parseMusicXML(midiToXml(bytes, "Roundtrip"));
    return {
      notation: t.notes.map((n) => [n.duration, n.soundDuration, n.velocity]),
      round: round.notes.map((n) => [n.pitch, n.duration]),
      key: round.key,
      bytes: Array.from(new Uint8Array(bytes)),
    };
  });
  expect(r.notation[0][0]).toBe(1);
  expect(r.notation[0][1]).toBeCloseTo(0.55);
  expect(r.notation[1][2]).toBeCloseTo(0.805);
  expect(r.round.find((n) => n[0] === 63)?.[1]).toBeCloseTo(0.55);
  expect(r.key).toEqual({ fifths: -3, mode: "minor" });
  expect(
    parseMidi(Uint8Array.from(r.bytes))
      .tracks.flat()
      .find((e) => e.type === "keySignature")
  ).toMatchObject({ key: -3, scale: 1 });
});
test("manual browsing releases follow permanently and following scrolls only the notation pane", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-demo="basic"]').click();
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await expect(page.locator("#follow")).not.toBeChecked();
  await page.locator("#follow").check();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('[data-measure="20"]')!.click();
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(
    await page.locator(".score-workspace").evaluate((n) => n.scrollTop)
  ).toBeGreaterThan(0);
  await page
    .locator(".score-workspace")
    .dispatchEvent("wheel", { deltaY: 300 });
  await expect(page.locator("#follow")).not.toBeChecked();
  await page.locator(".score-workspace").evaluate((n) => (n.scrollTop = 100));
  await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-measure="30"]')!.click()
  );
  await page.waitForTimeout(800);
  expect(
    await page.locator(".score-workspace").evaluate((n) => n.scrollTop)
  ).toBe(100);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator("#auto-keys").check();
  await page.locator("#piano").dispatchEvent("touchmove");
  await expect(page.locator("#auto-keys")).not.toBeChecked();
});
for (const edition of ["v1", "v2"]) test(`earlier ${edition} demo edits are preserved while opening the corrected edition`, async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async (edition) => {
    const { saveScore } = await import("/src/storage.ts");
    await saveScore({
      id: `modscore-demo-basic-${edition}`,
      title: "Basic Music edited",
      xml: await (await fetch("/fixtures/grand-staff.musicxml")).text(),
      pages: [],
      originals: [],
      created: 1,
      updated: 1,
      reviewed: false,
    });
  }, edition);
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  await page.locator(".score-open").click();
  await expect(page.locator(".demo-banner")).toContainText(
    "earlier demo edition"
  );
  await page
    .getByRole("button", { name: "Open corrected score", exact: true })
    .click();
  await expect(page.locator(".demo-banner")).toContainText("three flats");
  await expect(page.locator("h1")).toHaveText("Basic Music");
  await expect(page.locator("#demo-banner")).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { listScores } = await import("/src/storage.ts");
    return (await listScores()).map((p) => ({ id: p.id, title: p.title }));
  });
  expect(saved).toContainEqual({
    id: `modscore-demo-basic-${edition}`,
    title: "Basic Music edited",
  });
  expect(saved).toContainEqual({
    id: "modscore-demo-basic-v3",
    title: "Basic Music",
  });
});

test("notation grid collapses identical simultaneous strikes while performance retains close re-attacks", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { audioNotesToScore } = await import("/src/piano-score.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const out = audioNotesToScore(
      [
        {
          pitchMidi: 60,
          startTimeSeconds: 0.51,
          durationSeconds: 0.09,
          amplitude: 0.7,
        },
        {
          pitchMidi: 60,
          startTimeSeconds: 0.6,
          durationSeconds: 0.29,
          amplitude: 0.8,
        },
      ],
      { title: "Reattacks", bpm: 60, bars: 8, trimStart: false, grid: 0.25 }
    );
    return { raw: out.performance, score: parseMusicXML(out.xml).notes };
  });
  expect(r.raw).toHaveLength(2);
  expect(r.raw[1].beat - r.raw[0].beat).toBeCloseTo(0.09);
  expect(r.score).toHaveLength(1);
  expect(r.score[0].beat).toBe(0.5);
  expect(r.score[0].duration).toBe(0.5);
});
