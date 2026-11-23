import { test, expect } from "@playwright/test";
import MidiPackage from "@tonejs/midi";
const { Midi } = MidiPackage;

test("ornaments honor diatonic/explicit neighbors and style while fermatas and arpeggios share the MIDI performance", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { parseMusicXML, beatToSeconds } = await import("/src/music.ts");
    const { performanceTimeline } = await import("/src/performance.ts");
    const { exportMidi } = await import("/src/midi.ts");
    const xml = `<score-partwise><identification><creator type="composer">J. S. Bach</creator></identification><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>16</divisions><key><fifths>-3</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>B</step><alter>0</alter><octave>3</octave></pitch><duration>16</duration><notations><ornaments><trill-mark/></ornaments></notations></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><notations><ornaments><mordent/></ornaments></notations></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>32</duration><notations><ornaments><inverted-mordent/><accidental-mark placement="above">natural</accidental-mark></ornaments></notations></note></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>64</duration><notations><arpeggiate direction="down"/><fermata/></notations></note><note><chord/><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>64</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>64</duration></note></measure><measure number="3"><note><rest/><duration>64</duration><notations><fermata>short</fermata></notations></note></measure></part></score-partwise>`;
    const t = parseMusicXML(xml),
      before = JSON.stringify(t.notes),
      p = performanceTimeline(t);
    const shape = (x: typeof t) =>
      x.notes.map((n) => [n.pitch, n.beat, n.soundDuration ?? n.duration]);
    const auto = shape(p),
      seconds = beatToSeconds(t.duration, p.tempos);
    t.expression = { style: "classical", fermata: 1.5 };
    const classical = performanceTimeline(t).notes[0].pitch;
    t.expression = { style: "literal", fermata: 1.5 };
    const literal = performanceTimeline(t);
    t.expression = { style: "auto", fermata: 1 };
    const noHolds = beatToSeconds(t.duration, performanceTimeline(t).tempos);
    t.expression = { style: "auto", fermata: 1.5 };
    return {
      auto,
      classical,
      literal: shape(literal),
      literalSame: literal === t,
      originalUnchanged: before === JSON.stringify(t.notes),
      seconds,
      noHolds,
      warnings: t.warnings,
      bytes: Array.from(new Uint8Array(await exportMidi(t).arrayBuffer())),
    };
  });
  expect(r.originalUnchanged).toBe(true);
  expect(r.literalSame).toBe(true);
  expect(r.literal).toHaveLength(6);
  expect(r.auto[0][0]).toBe(60);
  expect(r.classical).toBe(59);
  expect(r.auto.filter((n) => n[1] >= 1 && n[1] < 2).map((n) => n[0])).toEqual([
    62, 60, 62,
  ]);
  expect(r.auto.filter((n) => n[1] >= 2 && n[1] < 4).map((n) => n[0])).toEqual([
    62, 64, 62,
  ]);
  const roll = r.auto.filter((n) => n[1] >= 4);
  expect(roll.map((n) => n[0])).toEqual([67, 63, 60]);
  expect(roll[1][1]).toBeGreaterThan(roll[0][1]);
  expect(roll[2][1]).toBeGreaterThan(roll[1][1]);
  expect(r.seconds).toBeCloseTo(7.5);
  expect(r.noHolds).toBeCloseTo(6);
  expect(r.warnings).toEqual([]);
  const midi = new Midi(Uint8Array.from(r.bytes));
  const notes = midi.tracks
    .flatMap((t) => t.notes)
    .sort((a, b) => a.ticks - b.ticks);
  expect(notes).toHaveLength(r.auto.length);
  for (let i = 0; i < notes.length; i++) {
    expect(notes[i].midi).toBe(r.auto[i][0]);
    expect(notes[i].ticks / midi.header.ppq).toBeCloseTo(r.auto[i][1], 2);
    expect(notes[i].durationTicks / midi.header.ppq).toBeCloseTo(
      r.auto[i][2],
      2,
    );
  }
  expect(midi.header.tempos.map((t) => t.bpm)).toEqual(
    expect.arrayContaining([120, 80, 96]),
  );
});

test("Basic Music v4 changes only measures 13/14 and retains measured releases through source comparison and MIDI", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    const t = parseMusicXML(
      await (await fetch("/demos/basic-music.musicxml")).text(),
    );
    return {
      bass: t.notes
        .filter((n) => n.staff === 2 && n.beat >= 50 && n.beat < 52)
        .map((n) => [n.pitch, n.beat, n.duration]),
      upper: t.notes
        .filter((n) => n.staff === 1 && n.beat >= 52 && n.beat < 56)
        .map((n) => [
          n.pitch,
          n.beat,
          n.duration,
          n.soundDuration ?? n.duration,
        ]),
      unchanged: (await (await fetch("/demos/basic-music.score.json")).json())
        .revision,
    };
  });
  expect(r.bass).toEqual([[53, 50, 2]]);
  expect(r.upper).toEqual([
    [60, 52.75, 0.25, 0.5],
    [62, 53, 0.25, 0.1875],
    [60, 53.25, 0.25, 0.25],
    [62, 53.5, 0.25, 0.1875],
    [63, 53.75, 0.25, 0.5625],
  ]);
  expect(r.unchanged).toContain("v4");
});

test("A/B uses the same chosen beat, stops the other player, supports seeking the source and saves alignment", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-demo="basic"]').click();
  await page.getByRole("button",{name:"Review measures 13–14",exact:true}).click();
  await expect(page.locator("#ab-position")).toContainText("Measure 13");
  await page
    .getByRole("button", { name: "A · Listen to source", exact: true })
    .click();
  const source = page.locator("#original-audio");
  await expect
    .poll(() => source.evaluate((e) => (e as HTMLAudioElement).paused))
    .toBe(false);
  expect(
    await source.evaluate((e) => (e as HTMLAudioElement).currentTime),
  ).toBeGreaterThanOrEqual(35.7);
  await page
    .getByRole("button", { name: "B · Listen to piano", exact: true })
    .click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  expect(await source.evaluate((e) => (e as HTMLAudioElement).paused)).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "A · Listen to source", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(
    await source.evaluate((e) => (e as HTMLAudioElement).currentTime),
  ).toBeLessThan(36.3);
  await source.evaluate((e) => {
    const a = e as HTMLAudioElement;
    a.pause();
    a.currentTime = 40;
  });
  await page.waitForTimeout(100);
  await page
    .getByRole("button", { name: "Compare from here", exact: true })
    .click();
  await expect(page.locator("#ab-position")).toContainText("Measure 14");
  await page
    .getByRole("button", { name: "B · Listen to piano", exact: true })
    .click();
  await expect
    .poll(async () => Number(await page.locator("#seek").inputValue()))
    .toBeGreaterThan(55.7);
  await page
    .getByRole("button", { name: "Pause comparison", exact: true })
    .click();
  await page.getByText("Attach and align recording", { exact: true }).click();
  await page.locator("#source-offset").fill("9.4");
  await page.locator("#source-offset").dispatchEvent("change");
  const stored = await page.evaluate(async () => {
    const { listScores, exportProject, validateProject } = await import(
      "/src/storage.ts"
    );
    const p = (await listScores()).find(
      (p) => p.id === "modscore-demo-basic-v4",
    )!;
    return validateProject(JSON.parse(await (await exportProject(p)).text()))
      .sourceAlignment;
  });
  expect(stored).toEqual({ offset: 9.4, bpm: 110 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("source-alignment mappings use recording tempo independently of edited piano tempo and reject invalid backup values", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { sourceSeconds, sourceBeat } = await import(
      "/src/source-comparison.ts"
    );
    const { parseMusicXML } = await import("/src/music.ts");
    const { validateProject } = await import("/src/storage.ts");
    const t = parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    t.tempos = [{ beat: 0, bpm: 60 }];
    const p = {
      id: "test",
      title: "test",
      xml: "",
      pages: [],
      originals: [],
      created: 1,
      updated: 1,
      reviewed: false,
      sourceAlignment: { offset: 9.5, bpm: 110 },
    };
    const base = { format: "modscore", version: 1, ...p };
    return {
      seconds: sourceSeconds(p, t, 8),
      beat: sourceBeat(p, t, 9.5 + (8 * 60) / 110),
      invalid: [NaN, 4001].map((offset) => {
        try {
          validateProject({ ...base, sourceAlignment: { offset, bpm: 110 } });
          return false;
        } catch {
          return true;
        }
      }),
    };
  });
  expect(r.seconds).toBeCloseTo(13.863636);
  expect(r.beat).toBeCloseTo(8);
  expect(r.invalid).toEqual([true, true]);
});

test("WAV rendering uses the same expressive clock and sampled ornament notes as MIDI", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The offline sampled render is covered once on desktop.");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Virtual piano", exact: true })
    .click();
  await page.getByRole("button", { name: "Enable audio", exact: true }).click();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const { exportMidi } = await import("/src/midi.ts");
    const t = parseMusicXML(
      '<score-partwise><identification><creator type="composer">Bach</creator></identification><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>64</duration><notations><ornaments><trill-mark/></ornaments><fermata/></notations></note></measure></part></score-partwise>',
    );
    const a = new AudioEngine();
    a.timeline = t;
    await a.activate();
    await a.prepare();
    const data = await (await a.wav()).arrayBuffer(),
      v = new DataView(data);
    let energy = 0;
    for (let i = 44; i < data.byteLength; i += 2)
      energy += v.getInt16(i, true) ** 2;
    const bytes = Array.from(new Uint8Array(await exportMidi(t).arrayBuffer()));
    await a.context!.close();
    return {
      rate: v.getUint32(24, true),
      seconds: (data.byteLength - 44) / 2 / v.getUint32(24, true),
      energy,
      bytes,
    };
  });
  expect(r.seconds).toBeCloseTo(5, 2);
  expect(r.energy).toBeGreaterThan(1000);
  const m = new Midi(Uint8Array.from(r.bytes));
  expect(m.tracks.flatMap((t) => t.notes).length).toBeGreaterThan(3);
  expect(m.duration).toBeCloseTo(3, 1);
});

test("fermata holds expand once per repeat and preserve a continuous loop clock", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { parseMusicXML } = await import("/src/music.ts");
    const { performanceTimeline } = await import("/src/performance.ts");
    const { TransportClock } = await import("/src/transport-clock.ts");
    const t = parseMusicXML(
      '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><barline location="left"><repeat direction="forward"/></barline><direction><sound tempo="120"/></direction><note><rest/><duration>4</duration><notations><fermata/></notations></note><barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>',
    );
    const p = performanceTimeline(t),
      clock = new TransportClock(p, 0, 1, 0, [0, 8]);
    return {
      holds: t.fermatas,
      firstEnd: clock.firstEnd,
      period: clock.period,
      atBoundary: clock.beatAt(6),
      later: clock.beatAt(6.75),
    };
  });
  expect(r.holds?.map((h) => h.beat)).toEqual([0, 4]);
  expect(r.firstEnd).toBeCloseTo(6);
  expect(r.period).toBeCloseTo(6);
  expect(r.atBoundary).toBe(0);
  expect(r.later).toBeCloseTo(1);
});
