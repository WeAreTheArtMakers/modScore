import { basicReferenceXml } from "./basic-reference.mjs";
// Rebuild the notation edition from its reviewable note data, never from raw AMT output.
import ts from "typescript";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "modscore-score-"));
try {
  for (const name of ["notation", "midi"]) {
    const source = await readFile(`src/${name}.ts`, "utf8");
    const js = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replace('"./notation"', '"./notation.mjs"')
      .replace(
        '"@tonejs/midi"',
        JSON.stringify(pathToFileURL(require.resolve("@tonejs/midi")).href)
      )
      .replace(
        '"midi-file"',
        JSON.stringify(pathToFileURL(require.resolve("midi-file")).href)
      );
    const nodeJs = js.replace(
      /import \{ Midi \} from ([^;]+);/,
      "import MidiPackage from $1;const {Midi}=MidiPackage;"
    );
    await writeFile(join(directory, `${name}.mjs`), nodeJs);
  }
  const score = JSON.parse(
    await readFile("public/demos/basic-music.score.json", "utf8")
  );
  const events = [];
  let barStart = 0;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const bar of score.measures) {
    for (const [hand, staff] of [
      ["upper", 1],
      ["lower", 2],
    ]) {
      let beat = barStart;
      for (const item of bar[hand]) {
        const duration = item.units / 4;
        for (const name of item.pitches) {
          if (name === "R") continue;
          const match = /^([A-G])(bb|b|##|#)?(\d)$/.exec(name);
          if (!match) throw Error("Invalid pitch " + name);
          let pitch =
            (Number(match[3]) + 1) * 12 +
            pc[match[1]] +
            (match[2]?.includes("b")
              ? -match[2].length
              : match[2]?.length || 0);
          // Screenshots use a treble clef marked 8 above in these passages.
          if (
            staff === 1 &&
            ((beat >= 28 && beat < 46) || (beat >= 84 && beat < 104))
          )
            pitch += 12;
          const previous = events.findLast(
            (n) =>
              n.staff === staff &&
              n.pitch === pitch &&
              Math.abs(n.beat + n.duration - beat) < 1e-7
          );
          if (item.tie?.includes("stop") && previous)
            previous.duration += duration;
          else
            events.push({
              pitch,
              beat,
              duration,
              staff,
              velocity: staff === 1 ? 0.76 : 0.6,
            });
        }
        beat += duration;
      }
      if (Math.abs(beat - barStart - score.barDurations[bar.number - 1]) > 1e-6)
        throw Error(`Bar ${bar.number}, ${hand} has wrong duration`);
    }
    barStart += score.barDurations[bar.number - 1];
  }
  await writeFile(
    "public/demos/basic-music.musicxml",
    basicReferenceXml(score)
  );
  await writeFile(
    "public/demos/basic-music-32.musicxml",
    basicReferenceXml(score, 32, false)
  );
  const { exportMidi } = await import(
    pathToFileURL(join(directory, "midi.mjs")).href
  );
  const timeline = (notes, repeat) => {
    let at = 0;
    const measures = [];
    for (let pass = 0; pass < repeat; pass++)
      for (const duration of score.barDurations) {
        measures.push({
          index: measures.length,
          number: String(measures.length + 1),
          beat: at,
          duration,
          page: 0,
          meter: { beats: 4, beatType: 4 },
        });
        at += duration;
      }
    return {
      title: score.title,
      key: score.key,
      tempos: [{ beat: 0, bpm: score.bpm }],
      duration: at,
      measures,
      tracks: [{ id: "Piano", name: "Piano", program: 0, drums: false }],
      warnings: [],
      notes: Array.from({ length: repeat }, (_, pass) =>
        notes.map((n, i) => ({
          ...n,
          id: `n${i}-${pass}`,
          beat: n.beat + pass * barStart,
          track: "Piano",
          voice: "1",
          measure: 0,
          source: [],
        }))
      ).flat(),
    };
  };
  await writeFile(
    "public/demos/basic-music.mid",
    new Uint8Array(await exportMidi(timeline(events, 2)).arrayBuffer())
  );
  await writeFile(
    "public/demos/basic-music-32.mid",
    new Uint8Array(
      await exportMidi(
        timeline(
          events
            .filter((n) => n.beat < 128)
            .map((n) => ({
              ...n,
              duration: Math.min(n.duration, 128 - n.beat),
            })),
          1
        )
      ).arrayBuffer()
    )
  );
  console.log(
    JSON.stringify({
      writtenBars: 35,
      writtenBeats: barStart,
      events: events.length,
      key: score.key,
      repeat: 2,
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
