import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("h1").waitFor();
});
test("real grand staff parses pitches, polyphony, dotted durations and ties", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    const t = m.parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    return {
      notes: t.notes,
      total: t.duration,
      tempos: t.tempos,
      range: [
        m.isPianoPitch(20),
        m.isPianoPitch(21),
        m.isPianoPitch(108),
        m.isPianoPitch(109),
      ],
      pitches: [
        m.pitchToMidi("A", 0),
        m.pitchToMidi("C", 8),
        m.pitchToMidi("B", 3, -1),
      ],
      names: [m.noteName(21), m.noteName(60), m.noteName(108)],
    };
  });
  expect(result.notes).toHaveLength(19);
  expect(
    result.notes
      .filter((n) => n.beat === 0)
      .map((n) => n.pitch)
      .sort(),
  ).toEqual([48, 52, 60]);
  expect(
    result.notes.find((n) => n.beat === 8 && n.pitch === 64)?.duration,
  ).toBe(3);
  expect(result.notes.find((n) => n.beat === 6 && n.staff === 1)?.pitch).toBe(
    66,
  );
  expect(result.notes.find((n) => n.beat === 7)?.pitch).toBe(65);
  expect(result.total).toBe(16);
  expect(result.tempos).toEqual([{ beat: 0, bpm: 96 }]);
  expect(result.range).toEqual([false, true, true, false]);
  expect(result.pitches).toEqual([21, 108, 58]);
  expect(result.names).toEqual(["A0", "C4", "C8"]);
});
test("piecewise tempo conversion and inverse avoid drift", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    const tempos = [
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 60 },
      { beat: 12, bpm: 180 },
    ];
    const beats = [0, 0.333333, 4, 5, 12, 1000];
    return beats.map((b) => ({
      b,
      seconds: m.beatToSeconds(b, tempos),
      roundtrip: m.secondsToBeat(m.beatToSeconds(b, tempos, 1.5), tempos, 1.5),
    }));
  });
  expect(result[3].seconds).toBe(3);
  for (const n of result) expect(n.roundtrip).toBeCloseTo(n.b, 8);
});
test("tuplets, alto clef, rests and offset tempo use explicit MusicXML timing", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    const xml =
      '<score-partwise><part-list><score-part id="P"><part-name>Viola</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>3</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>C</sign><line>3</line></clef></attributes><direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction><note><pitch><step>C</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note><direction><offset>1</offset><sound tempo="90"/></direction><note><rest/><duration>2</duration></note></measure></part></score-partwise>';
    const t = m.parseMusicXML(xml);
    return t;
  });
  expect(out.notes[0].pitch).toBe(59);
  expect(out.notes[0].duration).toBeCloseTo(1 / 3);
  expect(out.duration).toBe(1);
  expect(out.tempos).toEqual([
    { beat: 0, bpm: 120 },
    { beat: 2 / 3, bpm: 90 },
  ]);
});
test("manual pitch, accidental, duration and onset corrections survive MusicXML", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    let xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    let t = m.parseMusicXML(xml);
    xml = m.amendOnset(xml, t.notes.find((n) => n.pitch === 62)!, 1.5);
    t = m.parseMusicXML(xml);
    xml = m.amendNote(xml, t.notes.find((n) => n.pitch === 62)!, 63, 0.5);
    t = m.parseMusicXML(xml);
    return t.notes.find((n) => n.pitch === 63);
  });
  expect(out?.beat).toBe(1.5);
  expect(out?.duration).toBe(0.5);
});
test("MIDI import and export retain events, tempos and overlapping notes", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const m = await import("/src/music.ts"),
      io = await import("/src/midi.ts");
    const t = m.parseMusicXML(
      await (await fetch("/fixtures/grand-staff.musicxml")).text(),
    );
    const blob = io.exportMidi(t);
    const xml = io.midiToXml(await blob.arrayBuffer(), "roundtrip");
    const r = m.parseMusicXML(xml);
    const key = (n: any) => [n.pitch, n.beat, n.duration];
    return {
      a: t.notes.map(key).sort(),
      b: r.notes.map(key).sort(),
      tempos: r.tempos,
    };
  });
  expect(out.b).toEqual(out.a);
  expect(out.tempos[0].bpm).toBe(96);
});
test("XML rejects entities, active content and malformed input", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    return [
      '<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]><score-partwise/>',
      "<score-partwise><script>alert(1)</script></score-partwise>",
      "<score-partwise><part>",
    ].map((xml) => {
      try {
        m.parseMusicXML(xml);
        return false;
      } catch {
        return true;
      }
    });
  });
  expect(result).toEqual([true, true, true]);
});
test("IndexedDB commits complete project backups and keeps imports separate", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const s = await import("/src/storage.ts");
    const p = {
      id: "test-local",
      title: "<unsafe title>",
      xml: await (await fetch("/fixtures/grand-staff.musicxml")).text(),
      pages: [new Blob(["pixels"], { type: "image/png" })],
      originals: [],
      created: 1,
      updated: 1,
      reviewed: false,
    };
    await s.saveScore(p);
    const all = await s.listScores();
    const backup = await s.exportProject(p);
    const imported = s.validateProject(JSON.parse(await backup.text()));
    await s.deleteScore(p.id);
    return {
      stored: all.find((v) => v.id === p.id)?.title,
      clone: imported.id !== p.id,
      blob: await imported.pages[0].text(),
      empty: (await s.listScores()).length,
    };
  });
  expect(out).toEqual({
    stored: "<unsafe title>",
    clone: true,
    blob: "pixels",
    empty: 0,
  });
});
test("multiple-page XML combines without losing events or measure offsets", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const m = await import("/src/music.ts");
    const xml = await (await fetch("/fixtures/grand-staff.musicxml")).text();
    const merged = m.mergePages([xml, xml], "Two pages");
    const t = m.parseMusicXML(merged);
    return {
      notes: t.notes.length,
      measures: t.measures.length,
      duration: t.duration,
      second: t.notes
        .filter((n) => n.beat === 16)
        .map((n) => n.pitch)
        .sort(),
    };
  });
  expect(result).toEqual({
    notes: 38,
    measures: 8,
    duration: 32,
    second: [48, 52, 60],
  });
});
