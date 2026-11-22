import { test, expect } from "@playwright/test";
test("meter-aware pulses and a continuous loop clock retain exact tempo changes over 10000 turns", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { TransportClock, metronomePulses } = await import(
      "/src/transport-clock.ts"
    );
    const t: any = {
      notes: [],
      tracks: [],
      warnings: [],
      title: "Meters",
      duration: 10,
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 3, bpm: 60 },
      ],
      measures: [
        { index: 0, beat: 0, duration: 3, meter: { beats: 3, beatType: 4 } },
        { index: 1, beat: 3, duration: 3, meter: { beats: 6, beatType: 8 } },
        { index: 2, beat: 6, duration: 4, meter: { beats: 4, beatType: 4 } },
      ],
    };
    const c = new TransportClock(t, 4, 1.5, 12, [3, 10]);
    const boundaries = [1, 2, 100, 10000].map((n) => {
      const at = c.when(3, n);
      return {
        n,
        at,
        beat: c.beatAt(at),
        cycle: c.cycleAt(at),
        end: c.when(10, n),
        next: c.when(3, n + 1),
        middle: c.beatAt(c.when(7, n)),
      };
    });
    return {
      pulses: metronomePulses(t),
      boundaries,
      period: c.period,
      start: c.beatAt(12),
      lookahead: c.cycles(c.firstEnd - 0.05, c.firstEnd + 0.05),
    };
  });
  expect(r.pulses.map((p) => p.beat)).toEqual([0, 1, 2, 3, 4.5, 6, 7, 8, 9]);
  expect(r.pulses.filter((p) => p.accent).map((p) => p.beat)).toEqual([
    0, 3, 6,
  ]);
  expect(r.period).toBeCloseTo(7 / 1.5);
  expect(r.start).toBe(4);
  expect(r.lookahead).toEqual([0, 1]);
  for (const b of r.boundaries) {
    expect(b.cycle).toBe(b.n);
    expect(b.beat).toBeCloseTo(3, 7);
    expect(b.end).toBeCloseTo(b.next, 9);
    expect(b.middle).toBeCloseTo(7, 7);
  }
});
test("piano notation preserves sustained chords, repeated attacks and cross-bar ties through MIDI", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { pianoScore } = await import("/src/piano-score.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const { exportMidi, midiToXml } = await import("/src/midi.ts");
    const events = [
      { pitch: 48, beat: 0, duration: 8, velocity: 0.6 },
      { pitch: 60, beat: 0, duration: 1.5, velocity: 0.9 },
      { pitch: 64, beat: 0.5, duration: 4, velocity: 0.7 },
      { pitch: 60, beat: 2, duration: 0.125, velocity: 0.8 },
      { pitch: 67, beat: 3.875, duration: 0.25, velocity: 0.5 },
    ];
    const xml = pianoScore(events, {
      title: "Timing",
      composer: "Test",
      bars: 2,
      bpm: 112,
    });
    const t = parseMusicXML(xml);
    const out = parseMusicXML(
      midiToXml(await exportMidi(t).arrayBuffer(), "Timing"),
    ).notes.map(({ pitch, beat, duration }) => ({ pitch, beat, duration }));
    return {
      notes: t.notes.map(({ pitch, beat, duration, velocity }) => ({
        pitch,
        beat,
        duration,
        velocity,
      })),
      duration: t.duration,
      warnings: t.warnings,
      midi: out,
    };
  });
  expect(r.midi).toHaveLength(5);
  expect(r.midi.find((n) => n.pitch === 48)?.duration).toBe(8);
  expect(r.duration).toBe(8);
  expect(r.warnings).toEqual([]);
  expect(r.notes).toHaveLength(5);
  expect(r.notes.find((n) => n.pitch === 48)?.duration).toBe(8);
  expect(r.notes.find((n) => n.pitch === 64)?.duration).toBe(4);
  expect(r.notes.find((n) => n.pitch === 67)?.duration).toBe(0.25);
  expect(r.notes.find((n) => n.pitch === 60 && n.beat === 0)?.velocity).toBe(
    0.9,
  );
});
test("pending preparation can be cancelled and only the most recent Play schedules sound", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const a: any = new AudioEngine();
    a.timeline = parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    let resolve: any;
    const pending = new Promise<void>((r) => (resolve = r));
    a.prepare = () => pending;
    let count = 0;
    a.note = () => {
      count++;
      return () => {};
    };
    const first = a.play();
    await new Promise((r) => setTimeout(r, 30));
    a.stop();
    resolve();
    await first;
    const cancelled = { playing: a.playing, count };
    const two = a.play(),
      three = a.play();
    await Promise.all([two, three]);
    const latest = { playing: a.playing, count };
    a.stop();
    await a.context.close();
    return { cancelled, latest };
  });
  expect(r.cancelled).toEqual({ playing: false, count: 0 });
  expect(r.latest.playing).toBe(true);
  expect(r.latest.count).toBe(3);
});
test("loop range selection, independent metronome volume and octave controls persist across views", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles("public/fixtures/grand-staff.musicxml");
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Select loop range", exact: true })
    .click();
  await page.locator('[data-measure="1"]').click();
  await page.locator('[data-measure="2"]').click();
  await expect(page.locator("#loop-start")).toHaveValue("2");
  await expect(page.locator("#loop-end")).toHaveValue("3");
  await expect(page.locator("#loop-on")).toBeChecked();
  await page.locator("#metronome").check();
  await page.locator("#metronome-volume").fill("0.17");
  await page.locator("#metronome-volume").dispatchEvent("input");
  await expect(page.locator("#metronome-level")).toHaveText("17%");
  await page.getByRole("tab", { name: "Review notes", exact: true }).click();
  await expect(page.locator("#loop-start")).toHaveValue("2");
  await expect(page.locator("#metronome-volume")).toHaveValue("0.17");
  await page.locator('[data-action="octave-up"]').click();
  await expect(page.locator("#keyboard-octave")).toHaveText("5");
  await page.locator('[data-action="octave-down"]').click();
  await expect(page.locator("#keyboard-octave")).toHaveText("4");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("real audio scheduler looks ahead across loop boundaries without restarting preparation", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio.ts");
    const a: any = new AudioEngine();
    a.timeline = {
      title: "Loop",
      tracks: [{ id: "p", name: "Piano", program: 0 }],
      warnings: [],
      duration: 1,
      tempos: [{ beat: 0, bpm: 600 }],
      measures: [{ index: 0, beat: 0, duration: 1 }],
      notes: [
        {
          id: "n",
          pitch: 60,
          beat: 0,
          duration: 0.5,
          velocity: 0.7,
          track: "p",
          voice: "1",
          staff: 1,
        },
      ],
    };
    const whens: number[] = [];
    let prepares = 0;
    a.prepare = async () => {
      prepares++;
    };
    a.note = (_p: number, when: number) => {
      whens.push(when);
      return () => {};
    };
    a.setLoop([0, 1]);
    a.metronome = true;
    a.setMetronomeVolume(0.17);
    a.setVolume(0.8);
    await a.play();
    await new Promise((r) => setTimeout(r, 1150));
    const r = {
      whens,
      turns: a.loopTurns,
      prepares,
      metro: a.metronomeGain.gain.value,
      instrument: a.master.gain.value,
    };
    a.stop();
    await a.context.close();
    return r;
  });
  expect(r.prepares).toBe(1);
  expect(r.turns).toBeGreaterThanOrEqual(9);
  expect(r.whens.length).toBeGreaterThanOrEqual(11);
  for (let i = 1; i < r.whens.length; i++)
    expect(r.whens[i] - r.whens[i - 1]).toBeCloseTo(0.1, 5);
  expect(r.metro).toBeCloseTo(0.17, 2);
  expect(r.instrument).toBeCloseTo(0.8, 2);
});
