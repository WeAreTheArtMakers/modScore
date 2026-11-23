import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import MidiPackage from "@tonejs/midi";
const { Midi } = MidiPackage;

test("Basic Music recurring melody holds ties, preserves rests and agrees with downloadable MIDI", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    const xml = await (await fetch("/demos/basic-music.musicxml")).text();
    const t = parseMusicXML(xml);
    const shape = (start: number, end: number) =>
      t.notes
        .filter((n) => n.staff === 1 && n.beat >= start && n.beat < end)
        .map((n) => [n.pitch, n.beat - start, n.duration]);
    const d = new DOMParser().parseFromString(xml, "text/xml");
    return {
      phrase: shape(48, 52),
      again: shape(106, 110),
      rest: shape(52, 56),
      full: t.notes.map((n) => [n.pitch, n.beat, n.duration]),
      clef13:
        d.querySelector(
          'measure[number="13"] > attributes > clef[number="1"] > clef-octave-change'
        )?.textContent ?? "0",
      warnings: t.warnings,
    };
  });
  const phrase = [
    [60, 0, 0.5],
    [65, 0.5, 0.25],
    [67, 0.75, 0.25],
    [65, 1, 0.5],
    [62, 1.5, 0.5],
    [67, 2, 0.5],
    [72, 2.5, 0.25],
    [74, 2.75, 0.25],
    [72, 3, 0.5],
    [71, 3.5, 0.5],
  ];
  expect(r.phrase).toEqual(phrase);
  expect(r.again).toEqual(phrase);
  expect(r.rest).toEqual([
    [60, 0.75, 0.25],
    [62, 1, 0.25],
    [60, 1.25, 0.25],
    [62, 1.5, 0.25],
    [63, 1.75, 0.25],
  ]);
  expect(r.clef13).toBe("0");
  expect(r.warnings).toEqual([]);
  const midi = new Midi(await readFile("public/demos/basic-music.mid"));
  const key = (n: number[]) =>
    n.map((v) => Math.round(v * 10000) / 10000).join(":");
  expect(r.full.map(key).sort()).toEqual(
    midi.tracks
      .flatMap((t) => t.notes)
      .map((n) =>
        key([
          n.midi,
          n.ticks / midi.header.ppq,
          n.durationTicks / midi.header.ppq,
        ])
      )
      .sort()
  );
});

for (const [key, file, source, bars, notes, beats] of [
  ["bach-invention", "bach-invention-01", "bach-invention-01", 22, 458, 88],
  ["bach-prelude", "bach-prelude-bwv846", "wtk1-prelude1", 35, 549, 140],
  ["mozart", "mozart-k545-opening", "K545-1", 12, 191, 48],
] as const) {
  test(`${key} preserves source MIDI pitches/onsets/durations and plays with its original PDF available`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    const r = await page.evaluate(
      async ({ key, file }) => {
        const { parseMusicXML } = await import("/src/music.ts");
        const { demoProject } = await import("/src/demos.ts");
        const project = await demoProject(key),
          t = parseMusicXML(project.xml);
        return {
          bars: t.measures.length,
          beats: t.duration,
          notes: t.notes.map((n) => [n.pitch, n.beat, n.duration]),
          warnings: t.warnings,
        };
      },
      { key, file }
    );
    expect(r.bars).toBe(bars);
    expect(r.beats).toBe(beats);
    expect(r.notes).toHaveLength(notes);
    expect(r.warnings.filter((w) => !w.includes("Text-only"))).toEqual([]);
    const midi = new Midi(await readFile(`public/demos/sources/${source}.mid`));
    const shape = (n: number[]) =>
      n.map((v) => Math.round(v * 10000) / 10000).join(":");
    const expected = midi.tracks
      .flatMap((t) => t.notes)
      .filter((n) => n.ticks / midi.header.ppq < beats)
      .map((n) =>
        shape([
          n.midi,
          n.ticks / midi.header.ppq,
          n.durationTicks / midi.header.ppq,
        ])
      )
      .sort();
    expect(r.notes.map(shape).sort()).toEqual(expected);
    await page
      .getByRole("button", { name: "My scores", exact: true })
      .first()
      .click();
    await page.locator(".score-open").first().click();
    await expect(page.locator("#notation svg").first()).toBeVisible();
    await expect(page.locator("[data-measure]")).toHaveCount(bars);
    await expect(
      page.getByRole("link", { name: "Source score PDF", exact: true })
    ).toHaveAttribute("href", `/demos/sources/${source}-a4.pdf`);
    const pdf = await page.request.get(`/demos/sources/${source}-a4.pdf`);
    expect(pdf.ok()).toBe(true);
    expect((await pdf.body()).subarray(0,5).toString()).toBe("%PDF-");
    await expect(page.locator("#demo-select option")).toHaveCount(5);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".key.active").first()).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.locator("#demo-select").selectOption("beethoven");
    await expect(page.locator("h1")).toHaveText("Ode to Joy");
    await expect(page.locator("[data-measure]")).toHaveCount(32);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}
