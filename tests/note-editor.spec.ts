import { expect, test } from "@playwright/test";

const score = `<score-partwise version="4.0"><work><work-title>Palette étude</work-title></work>
<part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list>
<part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>-2</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><rest/><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
<backup><duration>16</duration></backup>
<note><pitch><step>G</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure>
<measure number="2"><note><rest measure="yes"/><duration>16</duration><voice>1</voice><staff>1</staff></note>
<backup><duration>16</duration></backup><note><rest measure="yes"/><duration>16</duration><voice>2</voice><staff>2</staff></note></measure></part></score-partwise>`;

test("the note palette saves written accidentals, removes a chord member and adds a key-aware note", async ({page}) => {
  await page.goto("/");
  await page.locator("#files").setInputFiles({
    name: "Palette étude.musicxml",
    mimeType: "application/vnd.recordare.musicxml+xml",
    buffer: Buffer.from(score),
  });
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page.getByRole("tab", {name: "Review notes", exact: true}).click();
  await page.locator("#edit-accidental").selectOption("0");
  await page.getByRole("button", {name: "Apply correction", exact: true}).click();
  await expect(page.locator("#edit-pitch")).toHaveValue("71");
  const snapshot = async () => page.evaluate(async () => {
    const { listScores } = await import("/src/storage.ts");
    const { parseMusicXML, xmlDocument } = await import("/src/music.ts");
    const saved = (await listScores()).find(({title}) => title === "Palette étude")!;
    const doc = xmlDocument(saved.xml), t = parseMusicXML(saved.xml);
    return {
      key: t.key,
      notes: t.notes.map((n) => [n.pitch, n.beat, n.duration, n.staff]),
      signs: [...doc.querySelectorAll("note > accidental")].map((n) => n.textContent),
      clefs: [...doc.querySelectorAll("clef > sign")].map((n) => n.textContent),
      measures: t.measures.map((m) => [m.beat, m.duration]),
    };
  });
  expect((await snapshot()).signs).toEqual(["natural", "flat"]);
  await page.getByRole("button", {name: "Delete note", exact: true}).click();
  await expect(page.locator("#edit-pitch")).toHaveValue("77");
  expect((await snapshot()).notes).toEqual([[77, 0, 1, 1], [55, 0, 4, 2], [70, 1, 1, 1]]);
  await page.getByRole("button", {name: "Undo last note edit", exact: true}).click();
  await expect(page.locator("#edit-pitch")).toHaveValue("71");
  await page.getByText("Add a note", {exact: true}).click();
  await page.locator("#add-measure").selectOption({ value: "1" });
  await expect(page.locator("#add-measure")).toHaveValue("1");
  await page.locator("#add-beat").fill("2.5");
  await page.locator("#add-duration").selectOption("0.5");
  await page.locator("#add-step").selectOption("E");
  await page.locator("#add-octave").fill("4");
  await page.getByRole("button", {name: "Insert note", exact: true}).click();
  await expect(page.locator("#edit-pitch")).toHaveValue("63");
  const result = await snapshot();
  expect(result).toEqual({
    key: {fifths: -2, mode: "minor"},
    notes: [[71, 0, 1, 1], [77, 0, 1, 1], [55, 0, 4, 2], [70, 1, 1, 1], [63, 5.5, 0.5, 1]],
    signs: ["natural", "flat"],
    clefs: ["G", "F"],
    measures: [[0, 4], [4, 4]],
  });
  await page.getByRole("tab", {name: "Score", exact: true}).click();
  await expect(page.locator("#notation svg").first()).toBeVisible();
});

test("overlapping additions, chord additions and tied deletion preserve the other voices and measure starts", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async (xml) => {
    const { insertWrittenNote, removeWrittenNote } = await import("/src/note-editor.ts");
    const { parseMusicXML } = await import("/src/music.ts");
    const upper = {part: "P", staff: 1, voice: "1"};
    const add = (source: string, beat: number, duration: number, step: string) =>
      insertWrittenNote(source, 0, upper, beat, duration, 4, {step, octave: 4, alter: "key"}).xml;
    const chord = add(xml, 0, 1, "G");
    const overlap = add(chord, 0.5, 1, "D");
    const tied = xml.replace("<voice>1</voice>", '<tie type="start"/><voice>1</voice>')
      .replace('<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>\n<note><rest/>',
        '<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff></note>\n<note><rest/>');
    const held = parseMusicXML(tied).notes.find((n) => n.source.length === 2)!;
    const removed = parseMusicXML(removeWrittenNote(tied, held));
    return {
      notes: parseMusicXML(overlap).notes.map((n) => [n.pitch, n.beat, n.duration, n.voice]),
      deleted: removed.notes.map((n) => [n.pitch, n.beat, n.duration, n.voice]),
      bars: removed.measures.map((m) => m.beat),
    };
  }, score);
  expect(result.notes).toEqual([[70,0,1,"1"],[77,0,1,"1"],[67,0,1,"1"],[55,0,4,"2"],[62,0.5,1,"3"],[70,1,1,"1"]]);
  expect(result.deleted).toEqual([[77,0,1,"1"],[55,0,4,"2"]]);
  expect(result.bars).toEqual([0,4]);
});

test("insertion keeps notes before later division changes and accepts existing quintuplet-grid positions", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { insertWrittenNote } = await import("/src/note-editor.ts");
    const { parseMusicXML, amendOnset } = await import("/src/music.ts");
    const xml = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">
      <measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>3</duration></note></measure>
      <measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
      <attributes><divisions>10</divisions></attributes><note><rest/><duration>30</duration></note></measure>
    </part></score-partwise>`;
    const t = parseMusicXML(xml);
    const moved = amendOnset(xml, t.notes[1], 4.5);
    const edited = insertWrittenNote(xml, 1, {part: "P", staff: 1, voice: "1"},
      1.1, 0.125, 4, {step: "F", octave: 4, alter: "key"}).xml;
    const changes = parseMusicXML(edited);
    return {
      notes: changes.notes.map((n) => [n.pitch, n.beat, n.duration]),
      measures: changes.measures.map((m) => [m.beat, m.duration]),
      moved: parseMusicXML(moved).notes[1].beat,
    };
  });
  expect(result.notes).toEqual([[60,0,1],[62,4,1],[65,5.1,0.125]]);
  expect(result.measures).toEqual([[0,4],[4,4]]);
  expect(result.moved).toBe(4.5);
});
