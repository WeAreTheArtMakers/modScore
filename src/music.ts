import { expandRepeats } from "./repeats";
export interface Note {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  track: string;
  voice: string;
  staff: number;
  measure: number;
  velocity: number;
  source: number[];
  soundDuration?: number;
  articulations?: string[];
}
export interface Measure {
  index: number;
  number: string;
  beat: number;
  duration: number;
  page: number;
  meter?: { beats: number; beatType: number };
  sourceMeasure?: number;
  sourceBeat?: number;
  pass?: number;
}
export interface Tempo {
  beat: number;
  bpm: number;
}
export interface Track {
  id: string;
  name: string;
  program: number;
  drums: boolean;
}
export interface Timeline {
  title: string;
  notes: Note[];
  measures: Measure[];
  tempos: Tempo[];
  tracks: Track[];
  duration: number;
  warnings: string[];
  key?: { fifths: number; mode: "major" | "minor" };
  writtenMeasures?: number;
  writtenDuration?: number;
}
const steps: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
export const noteName = (midi: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
    ((midi % 12) + 12) % 12
  ] +
  (Math.floor(midi / 12) - 1);
export const isPianoPitch = (pitch: number) =>
  Number.isInteger(pitch) && pitch >= 21 && pitch <= 108;
export function pitchToMidi(step: string, octave: number, alter = 0) {
  if (!(step in steps) || !Number.isInteger(octave) || !Number.isInteger(alter))
    throw Error("Unsupported or invalid pitch");
  const midi = (octave + 1) * 12 + steps[step] + alter;
  if (midi < 0 || midi > 127) throw Error("Pitch is outside MIDI range");
  return midi;
}
const children = (e: Element, name: string) =>
  Array.from(e.children).filter((n) => n.localName === name);
const child = (e: Element, name: string) => children(e, name)[0];
const txt = (e: Element | undefined, path: string, defaultValue = "") =>
  e?.querySelector(path)?.textContent?.trim() || defaultValue;
const num = (e: Element | undefined, path: string, fallback = 0) =>
  Number(txt(e, path, String(fallback)));
export function xmlDocument(xml: string) {
  if (xml.length > 25_000_000)
    throw Error("MusicXML is too large for safe mobile parsing");
  if (/<!ENTITY|<\s*script\b/i.test(xml))
    throw Error("Active or entity content is not permitted in a score");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw Error("Invalid MusicXML");
  if (doc.documentElement.localName !== "score-partwise")
    throw Error("Use uncompressed, partwise MusicXML (.musicxml or .xml)");
  return doc;
}
export function parseMusicXML(xml: string, title = "Untitled score"): Timeline {
  const doc = xmlDocument(xml);
  const warnings = new Set<string>();
  if (doc.querySelector('miscellaneous-field[name="modscore-page-layout"]'))
    warnings.add(
      "Page layouts differ. Pages play in order using page-specific tracks; review part identities and missing notation against originals.",
    );
  for (const field of Array.from(
    doc.querySelectorAll(
      'miscellaneous-field[name="modscore-recognition-review"]',
    ),
  ))
    if (field.textContent) warnings.add(field.textContent);
  const tracks = Array.from(doc.querySelectorAll("part-list > score-part")).map(
    (p) => ({
      id: p.id,
      name: txt(p, "part-name", p.id),
      program: Math.max(0, num(p, "midi-program", 1) - 1),
      drums: num(p, "midi-channel", 1) === 10,
    }),
  );
  const measureLengths: number[] = [];
  const measureNumbers: string[] = [];
  const measureMeters: { beats: number; beatType: number }[] = [];
  let measurePages: number[] = [];
  try {
    const encoded = JSON.parse(
      doc.querySelector('miscellaneous-field[name="modscore-source-pages"]')
        ?.textContent || "[]",
    );
    if (
      Array.isArray(encoded) &&
      encoded.length <= 200000 &&
      encoded.every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)
    )
      measurePages = encoded;
  } catch {}
  const tempos: Tempo[] = [];
  const notes: Note[] = [];
  const tempoOffsets: number[] = [];
  let sourceIndex = 0;
  const pending = new Map<string, Note>();
  for (const part of children(doc.documentElement, "part")) {
    let divisions = 1,
      beats = 4,
      beatType = 4,
      transpose = 0,
      dynamic = 0.75;
    const staged: { note: Note; localBeat: number }[] = [];
    const measures = children(part, "measure");
    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      let at = 0,
        max = 0,
        previous = 0;
      const miNotes: { note: Note; localBeat: number }[] = [];
      for (const el of Array.from(m.children)) {
        if (el.localName === "attributes") {
          if (child(el, "divisions")) {
            divisions = num(el, "divisions");
            if (!(divisions > 0)) throw Error("Invalid MusicXML divisions");
          }
          if (el.querySelector("time")) {
            beats = txt(el, "time > beats", "4")
              .split("+")
              .reduce((s, v) => s + Number(v), 0);
            beatType = num(el, "time > beat-type", 4);
          }
          if (el.querySelector("transpose"))
            transpose =
              num(el, "transpose > chromatic") +
              12 * num(el, "transpose > octave-change");
        } else if (el.localName === "backup") {
          at -= num(el, "duration") / divisions;
          if (at < -0.0001)
            warnings.add(
              "A voice moves before the start of a measure; review timing.",
            );
        } else if (el.localName === "forward") {
          at += num(el, "duration") / divisions;
          max = Math.max(max, at);
        } else if (el.localName === "direction") {
          const soundDynamics = el.querySelector("sound[dynamics]");
          const levels: Record<string, number> = {
            ppp: 0.25,
            pp: 0.35,
            p: 0.5,
            mp: 0.65,
            mf: 0.78,
            f: 0.9,
            ff: 1,
            fff: 1,
          };
          const marking =
            el.querySelector("dynamics")?.firstElementChild?.localName;
          if (marking && levels[marking] !== undefined)
            dynamic = levels[marking];
          if (soundDynamics) {
            const value = Number(soundDynamics.getAttribute("dynamics"));
            if (Number.isFinite(value))
              dynamic = Math.max(0, Math.min(1, value / 100));
          }
          let bpm = num(el, "sound[tempo]", 0);
          const sound = el.querySelector("sound[tempo]");
          if (sound) bpm = Number(sound.getAttribute("tempo"));
          if (!bpm && el.querySelector("metronome")) {
            const units: Record<string, number> = {
              whole: 4,
              half: 2,
              quarter: 1,
              eighth: 0.5,
            };
            const base = units[txt(el, "beat-unit", "quarter")] || 1;
            const dots = el.querySelectorAll("beat-unit-dot").length;
            bpm = num(el, "per-minute") * base * (2 - 2 ** -dots);
          }
          if (bpm > 0) {
            tempos.push({ beat: mi, bpm });
            tempoOffsets.push(at + num(el, "offset") / divisions);
          }
          if (
            el.querySelector("segno,coda") ||
            el.querySelector("sound[da-capo],sound[dalsegno]")
          )
            warnings.add(
              "Navigation marks are displayed but not expanded for playback.",
            );
        } else if (el.localName === "note") {
          const si = sourceIndex++;
          const chord = !!child(el, "chord");
          let dur = num(el, "duration") / divisions;
          if (child(el, "grace")) {
            warnings.add(
              "Grace notes are displayed but omitted from playback.",
            );
            continue;
          }
          if (!Number.isFinite(dur) || dur <= 0) {
            warnings.add(
              "A note or rest has no valid duration and was omitted.",
            );
            continue;
          }
          const start = chord ? previous : at;
          if (!chord) {
            previous = at;
            at += dur;
          }
          max = Math.max(max, start + dur, at);
          if (child(el, "rest")) continue;
          if (child(el, "unpitched")) {
            warnings.add(
              "Unpitched MusicXML notation requires MIDI drum mapping and was omitted.",
            );
            continue;
          }
          if (!el.querySelector("pitch")) {
            warnings.add("A note has no pitch and was omitted.");
            continue;
          }
          let pitch: number;
          try {
            pitch =
              pitchToMidi(
                txt(el, "pitch > step"),
                num(el, "pitch > octave"),
                num(el, "pitch > alter"),
              ) + transpose;
            if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127)
              throw Error();
          } catch {
            warnings.add(
              "An unsupported microtonal or invalid pitch was omitted.",
            );
            continue;
          }
          const dynamics = Number(el.getAttribute("dynamics") ?? dynamic * 100);
          const articulations = Array.from(
            el.querySelectorAll("notations > articulations > *"),
          ).map((n) => n.localName);
          const gate = articulations.includes("staccatissimo")
            ? 0.3
            : articulations.includes("staccato")
              ? 0.55
              : articulations.includes("tenuto")
                ? 1
                : 1;
          const note: Note = {
            id: `n${si}`,
            pitch,
            beat: 0,
            duration: dur,
            track: part.id,
            voice: txt(el, "voice", "1"),
            staff: num(el, "staff", 1),
            measure: mi,
            velocity: Math.max(
              0,
              Math.min(
                1,
                (Number.isFinite(dynamics) ? dynamics / 100 : 0.75) *
                  (articulations.includes("accent")
                    ? 1.15
                    : articulations.includes("strong-accent")
                      ? 1.25
                      : 1),
              ),
            ),
            source: [si],
            soundDuration: gate === 1 ? undefined : dur * gate,
            articulations: articulations.length ? articulations : undefined,
          };
          miNotes.push({ note, localBeat: start });
        }
      }
      measureMeters[mi] ??= { beats, beatType };
      const expected = (beats * 4) / beatType;
      if (!Number.isFinite(expected) || expected <= 0)
        throw Error("Invalid time signature");
      const length = max > 0 ? max : expected;
      if (max > expected + 0.001)
        warnings.add(
          `Measure ${m.getAttribute("number") || mi + 1} exceeds its time signature; review voice timing.`,
        );
      measureLengths[mi] = Math.max(measureLengths[mi] || 0, length);
      if (m.hasAttribute("data-modscore-page"))
        measurePages[mi] = Number(m.getAttribute("data-modscore-page")) || 0;
      measureNumbers[mi] = m.getAttribute("number") || String(mi + 1);
      staged.push(...miNotes);
      if (m.querySelector("ending"))
        warnings.add(
          "Repeat signs/endings are displayed; playback currently follows written measure order.",
        );
      if (m.querySelector("direction-type > words"))
        warnings.add(
          "Text-only tempo and performance instructions require manual review.",
        );
    }
    // Resolve global measure positions after all parts below, with rests and pickups retained.
    for (const { note, localBeat } of staged) {
      note.beat = localBeat;
      notes.push(note);
    }
  }
  const measures: Measure[] = [];
  let beat = 0;
  measureLengths.forEach((duration, index) => {
    measures.push({
      index,
      number: measureNumbers[index],
      beat,
      duration,
      page: measurePages[index] || 0,
      meter: measureMeters[index],
    });
    beat += duration;
  });
  for (const note of notes) note.beat += measures[note.measure].beat;
  const allSource = Array.from(doc.querySelectorAll("part > measure > note"));
  const merged: Note[] = [];
  for (const n of [...notes].sort(
    (a, b) => a.beat - b.beat || Number(a.id.slice(1)) - Number(b.id.slice(1)),
  )) {
    const el = allSource[n.source[0]];
    const types = Array.from(el.querySelectorAll("tie")).map((t) =>
      t.getAttribute("type"),
    );
    const key = `${n.track}/${n.staff}/${n.voice}/${n.pitch}`;
    const before = pending.get(key);
    if (
      types.includes("stop") &&
      before &&
      Math.abs(before.beat + before.duration - n.beat) < 0.0001
    ) {
      before.soundDuration =
        n.soundDuration === undefined
          ? undefined
          : before.duration + n.soundDuration;
      before.duration += n.duration;
      before.source.push(...n.source);
      if (!types.includes("start")) pending.delete(key);
      continue;
    }
    if (types.includes("stop"))
      warnings.add("An unmatched tie was played as a separate note.");
    merged.push(n);
    if (types.includes("start")) pending.set(key, n);
  }
  tempos.forEach(
    (t, i) => (t.beat = (measures[t.beat]?.beat || 0) + tempoOffsets[i]),
  );
  if (!tempos.some((t) => t.beat === 0)) {
    tempos.unshift({ beat: 0, bpm: 120 });
    warnings.add(
      "No initial numeric tempo was found. Playback defaults to 120 BPM; set tempo after reviewing the printed score.",
    );
  }
  tempos.sort((a, b) => a.beat - b.beat);
  const unique = tempos.filter(
    (t, i) =>
      !i || t.beat !== tempos[i - 1].beat || t.bpm !== tempos[i - 1].bpm,
  );
  if (merged.some((n) => !isPianoPitch(n.pitch)))
    warnings.add(
      "Some notes are outside A0–C8; audio plays their true pitch, and the piano omits those keys.",
    );
  return expandRepeats(
    {
      key: doc.querySelector("key > fifths")
        ? {
            fifths: Number(doc.querySelector("key > fifths")!.textContent),
            mode:
              doc.querySelector("key > mode")?.textContent === "minor"
                ? "minor"
                : "major",
          }
        : undefined,
      title: txt(
        doc.documentElement,
        "work-title",
        txt(doc.documentElement, "movement-title", title),
      ),
      notes: merged.sort((a, b) => a.beat - b.beat),
      measures,
      tempos: unique,
      tracks,
      duration: beat,
      warnings: [...warnings],
    },
    doc,
  );
}
export function beatToSeconds(beat: number, tempos: Tempo[], speed = 1) {
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i],
      end = Math.min(beat, tempos[i + 1]?.beat ?? beat);
    if (end > t.beat) sec += ((end - t.beat) * 60) / t.bpm;
    if (end === beat) break;
  }
  return sec / speed;
}
export function secondsToBeat(seconds: number, tempos: Tempo[], speed = 1) {
  let remaining = Math.max(0, seconds) * speed;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i],
      next = tempos[i + 1]?.beat ?? Infinity,
      span = ((next - t.beat) * 60) / t.bpm;
    if (remaining <= span) return t.beat + (remaining * t.bpm) / 60;
    remaining -= span;
  }
  return 0;
}
export function activeNotes(t: Timeline, beat: number) {
  return t.notes.filter(
    (n) => n.beat <= beat && n.beat + (n.soundDuration ?? n.duration) > beat,
  );
}
/** Raise a part's tick resolution without changing any encoded musical time. */
function refineDivisionGrid(
  doc: Document,
  part: Element,
  value: number,
): number {
  const denominators = [
    1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512,
    768, 1024, 1536, 2048, 3072, 4096, 6144,
  ];
  const denominator = denominators.find(
    (d) => Math.abs(value * d - Math.round(value * d)) < 0.000001,
  );
  if (!denominator)
    throw Error(
      "Use an exact binary or tuplet duration from the rhythm presets.",
    );
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let common = denominator;
  for (const node of Array.from(
    part.querySelectorAll("attributes > divisions"),
  )) {
    const d = Number(node.textContent);
    if (!Number.isSafeInteger(d) || d <= 0)
      throw Error("Invalid MusicXML divisions");
    common = (common / gcd(common, d)) * d;
    if (common > 16777216)
      throw Error("The required MusicXML timing grid is too fine.");
  }
  let oldUnits = 1;
  const measures = children(part, "measure");
  for (const measure of measures) {
    for (const el of Array.from(measure.children)) {
      const definition =
        el.localName === "attributes" ? child(el, "divisions") : undefined;
      if (definition) {
        oldUnits = Number(definition.textContent);
        definition.textContent = String(common);
      }
      for (const d of Array.from(el.querySelectorAll("duration,offset")))
        d.textContent = String((Number(d.textContent) * common) / oldUnits);
      if (el.localName === "note")
        for (const name of ["attack", "release"]) {
          if (el.hasAttribute(name))
            el.setAttribute(
              name,
              String((Number(el.getAttribute(name)) * common) / oldUnits),
            );
        }
    }
  }
  if (measures[0] && !measures[0].querySelector("attributes > divisions")) {
    const attrs = doc.createElement("attributes"),
      d = doc.createElement("divisions");
    d.textContent = String(common);
    attrs.append(d);
    measures[0].prepend(attrs);
  }
  return common;
}

/** Re-encode the measure's cursor movements after reflowing one voice.
 * Changing a duration in interleaved MusicXML must update backups too; keeping
 * old backup lengths moved other voices before the measure or duplicated time.
 */
function reflowDuration(
  doc: Document,
  target: Element,
  duration: number,
  initialDivisions: number,
) {
  const measure = target.parentElement!;
  const voiceKey = (el: Element) =>
    `${txt(el, "voice", "1")}:${txt(el, "staff", "1")}`;
  const events: {
    el: Element;
    start: number;
    duration: number;
    divisions: number;
    chord: boolean;
  }[] = [];
  let cursor = 0,
    previous = 0,
    divisions = initialDivisions;
  for (const el of Array.from(measure.children)) {
    if (el.localName === "attributes" && child(el, "divisions"))
      divisions = num(el, "divisions");
    const d = num(el, "duration") / divisions;
    if (el.localName === "backup") {
      cursor -= d;
      continue;
    }
    if (el.localName === "forward") {
      cursor += d;
      continue;
    }
    const chord = !!child(el, "chord");
    const start = el.localName === "note" && chord ? previous : cursor;
    events.push({ el, start, duration: d, divisions, chord });
    if (el.localName === "note" && !child(el, "grace") && !chord) {
      previous = cursor;
      cursor += d;
    }
  }
  const selected = events.find((e) => e.el === target)!;
  const delta = duration - selected.duration;
  const key = voiceKey(target);
  let at = 0,
    leading = 0;
  const fragments = doc.createDocumentFragment();
  const move = (to: number, units: number) => {
    const difference = to - at;
    if (Math.abs(difference) < 0.000001) return;
    const ticks = Math.abs(difference) * units;
    if (Math.abs(ticks - Math.round(ticks)) > 0.00001)
      throw Error("This rhythm needs a finer MusicXML division grid.");
    const shift = doc.createElement(difference > 0 ? "forward" : "backup");
    const d = doc.createElement("duration");
    d.textContent = String(Math.round(ticks));
    shift.append(d);
    fragments.append(shift);
    at = to;
  };
  for (const event of events) {
    const { el, divisions: units } = event;
    if (el.localName === "note") {
      const after =
        event.start > selected.start + 0.000001 && voiceKey(el) === key;
      const start = event.start + (after ? delta : 0);
      const length = el === target ? duration : event.duration;
      if (event.chord && Math.abs(start - leading) > 0.000001)
        child(el, "chord")?.remove();
      const chord = !!child(el, "chord");
      if (!chord) {
        move(start, units);
        leading = start;
        if (!child(el, "grace")) at = start + length;
      }
      if (el === target)
        child(el, "duration")!.textContent = String(
          Math.round(duration * units),
        );
    } else if (el.localName === "direction" || el.localName === "harmony") {
      const oldOffset = num(el, "offset");
      const offset = (event.start - at) * units + oldOffset;
      let node = child(el, "offset");
      if (Math.abs(offset) > 0.000001 || node) {
        node ??= doc.createElement("offset");
        node.textContent = String(Math.round(offset));
        if (!node.parentNode) {
          const anchor = Array.from(el.children).find(
            (e) =>
              ![
                "direction-type",
                "root",
                "kind",
                "inversion",
                "bass",
                "degree",
              ].includes(e.localName),
          );
          el.insertBefore(node, anchor || null);
        }
      }
    }
    fragments.append(el);
  }
  measure.replaceChildren(fragments);
}

export function amendNote(
  xml: string,
  note: Note,
  pitch: number,
  duration: number,
): string {
  if (
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw Error("Invalid note correction");
  const doc = xmlDocument(xml);
  const nodes = doc.querySelectorAll("part > measure > note");
  if (note.source.length > 1 && Math.abs(duration - note.duration) > 0.00001)
    throw Error(
      "Change tied note durations in an external notation editor; pitch corrections are supported here.",
    );
  const names = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  for (const index of note.source) {
    const el = nodes[index];
    if (!el) throw Error("Note source is unavailable");
    const p = el.querySelector("pitch")!;
    const set = (root: Element, name: string, value: string) => {
      let node = root.querySelector(name);
      if (!node) {
        node = doc.createElement(name);
        root.append(node);
      }
      node.textContent = value;
    };
    set(p, "step", names[pitch % 12]);
    set(p, "alter", String(alters[pitch % 12]));
    set(p, "octave", String(Math.floor(pitch / 12) - 1));
    el.querySelector("accidental")?.remove();
    if (note.source.length === 1) {
      let divisions = 1;
      for (const m of children(el.parentElement!.parentElement!, "measure")) {
        const d = m.querySelector("attributes > divisions");
        if (d) divisions = Number(d.textContent);
        if (m === el.parentElement) break;
      }
      let ticks = duration * divisions;
      if (Math.abs(ticks - Math.round(ticks)) > 0.00001) {
        divisions = refineDivisionGrid(
          doc,
          el.parentElement!.parentElement!,
          duration,
        );
        ticks = duration * divisions;
      }
      // A pitch-only edit preserves tuplets, dots, beams and the original type.
      if (Math.abs(duration - note.duration) > 0.000001) {
        reflowDuration(doc, el, duration, divisions);
        for (const d of Array.from(
          el.querySelectorAll("dot,time-modification,beam,notations > tuplet"),
        ))
          d.remove();
        const types: Record<string, string> = {
          "8": "breve",
          "4": "whole",
          "2": "half",
          "1": "quarter",
          "0.5": "eighth",
          "0.25": "16th",
          "0.125": "32nd",
          "0.0625": "64th",
          "0.03125": "128th",
          "0.015625": "256th",
          "0.0078125": "512th",
          "0.00390625": "1024th",
        };
        let represented = false;
        for (const [value, type] of Object.entries(types)) {
          for (const [factor, dots, actual, normal] of [
            [1, 0, 1, 1],
            [1.5, 1, 1, 1],
            [1.75, 2, 1, 1],
            [2 / 3, 0, 3, 2],
          ] as const) {
            if (Math.abs(Number(value) * factor - duration) > 0.000001)
              continue;
            set(el, "type", type);
            for (let i = 0; i < dots; i++) el.append(doc.createElement("dot"));
            if (actual !== normal) {
              const tm = doc.createElement("time-modification");
              set(tm, "actual-notes", String(actual));
              set(tm, "normal-notes", String(normal));
              el.append(tm);
            }
            represented = true;
            break;
          }
          if (represented) break;
        }
        if (!represented) el.querySelector("type")?.remove();
      }
    }
  }
  for (const index of note.source) {
    const el = nodes[index];
    const pitch = el.querySelector("pitch");
    if (pitch)
      for (const tag of ["step", "alter", "octave"]) {
        const child = pitch.querySelector(tag);
        if (child) pitch.append(child);
      }
    const order = [
      "grace",
      "cue",
      "chord",
      "pitch",
      "unpitched",
      "rest",
      "duration",
      "tie",
      "instrument",
      "footnote",
      "level",
      "voice",
      "type",
      "dot",
      "accidental",
      "time-modification",
      "stem",
      "notehead",
      "notehead-text",
      "staff",
      "beam",
      "notations",
      "lyric",
      "play",
      "listen",
    ];
    const children = Array.from(el.children);
    children.sort(
      (a, b) => order.indexOf(a.localName) - order.indexOf(b.localName),
    );
    const comments = Array.from(el.childNodes).filter((n) => n.nodeType === 8);
    el.replaceChildren(...children, ...comments);
  }
  return new XMLSerializer().serializeToString(doc);
}
function mergeIndependentPages(pages: string[], title: string) {
  const docs = pages.map(xmlDocument),
    timelines = pages.map((p) => parseMusicXML(p));
  const dest = new DOMParser().parseFromString(
    '<score-partwise version="4.0"><work><work-title/></work><identification><miscellaneous><miscellaneous-field name="modscore-page-layout">Page layouts differ; page-specific tracks preserve encoded music without assuming part identity.</miscellaneous-field></miscellaneous></identification><part-list/></score-partwise>',
    "application/xml",
  );
  dest.querySelector("work-title")!.textContent = title;
  docs.forEach((doc, page) => {
    for (const field of Array.from(
      doc.querySelectorAll(
        'miscellaneous-field[name="modscore-recognition-review"]',
      ),
    )) {
      const clone = dest.importNode(field, true);
      clone.textContent = `Page ${page + 1}: ${clone.textContent}`;
      dest.querySelector("identification > miscellaneous")!.append(clone);
    }
  });
  const lengths = timelines.flatMap((t) => t.measures.map((m) => m.duration));
  const sourcePages = timelines.flatMap((t, page) =>
    t.measures.map(() => page),
  );
  let offset = 0;
  docs.forEach((doc, page) => {
    const count = timelines[page].measures.length;
    children(doc.documentElement, "part").forEach((part, index) => {
      const id = `Page${page + 1}Part${index + 1}`,
        definition = doc.querySelector(
          `part-list > score-part[id="${part.id}"]`,
        );
      if (!definition) throw Error("MusicXML part definition missing");
      const def = dest.importNode(definition, true);
      def.id = id;
      def.querySelector("part-name")!.textContent =
        `Page ${page + 1} · ${txt(definition, "part-name", part.id)}`;
      const remap = (root: Element) => {
        for (const el of Array.from(root.querySelectorAll("[id]")))
          el.setAttribute("id", id + "_" + el.getAttribute("id"));
      };
      remap(def);
      dest.querySelector("part-list")!.append(def);
      const out = dest.createElement("part");
      out.id = id;
      const measures = children(part, "measure");
      for (let global = 0; global < lengths.length; global++) {
        const local = global - offset;
        if (local >= 0 && local < count && measures[local]) {
          const clone = dest.importNode(measures[local], true);
          clone.setAttribute("number", String(global + 1));
          clone.setAttribute("data-modscore-page", String(sourcePages[global]));
          remap(clone);
          if (local === 0 && !clone.querySelector("attributes > divisions")) {
            const attrs = dest.createElement("attributes");
            const d = dest.createElement("divisions");
            d.textContent = "1";
            attrs.append(d);
            clone.prepend(attrs);
          }
          out.append(clone);
        } else {
          const m = dest.createElement("measure");
          m.setAttribute("number", String(global + 1));
          m.setAttribute("data-modscore-page", String(sourcePages[global]));
          m.setAttribute("implicit", "yes");
          const attrs = dest.createElement("attributes");
          if (global === 0) {
            const source = measures[0]?.querySelector("attributes");
            if (source)
              for (const el of Array.from(source.children))
                if (el.tagName !== "divisions")
                  attrs.append(dest.importNode(el, true));
          }
          const div = dest.createElement("divisions");
          div.textContent = "480";
          attrs.prepend(div);
          const note = dest.createElement("note");
          const rest = dest.createElement("rest");
          rest.setAttribute("measure", "yes");
          const duration = dest.createElement("duration");
          duration.textContent = String(Math.round(lengths[global] * 480));
          note.append(rest, duration);
          m.append(attrs, note);
          out.append(m);
        }
      }
      dest.documentElement.append(out);
    });
    offset += count;
  });
  return new XMLSerializer().serializeToString(dest);
}
function finalizeSourcePages(xml: string) {
  const doc = xmlDocument(xml);
  const first = doc.querySelector("score-partwise > part");
  const pages = first
    ? children(first, "measure").map(
        (m) => Number(m.getAttribute("data-modscore-page")) || 0,
      )
    : [];
  for (const measure of Array.from(doc.querySelectorAll("part > measure")))
    measure.removeAttribute("data-modscore-page");
  let identification = doc.querySelector("identification");
  if (!identification) {
    identification = doc.createElement("identification");
    doc.documentElement.insertBefore(
      identification,
      doc.querySelector("defaults,part-list"),
    );
  }
  let misc = identification.querySelector("miscellaneous");
  if (!misc) {
    misc = doc.createElement("miscellaneous");
    identification.append(misc);
  }
  for (const old of Array.from(
    misc.querySelectorAll('miscellaneous-field[name="modscore-source-pages"]'),
  ))
    old.remove();
  const field = doc.createElement("miscellaneous-field");
  field.setAttribute("name", "modscore-source-pages");
  field.textContent = JSON.stringify(pages);
  misc.append(field);
  return new XMLSerializer().serializeToString(doc);
}
export function mergePages(pages: string[], title: string) {
  pages = pages.map((xml, page) => {
    const doc = xmlDocument(xml);
    for (const m of Array.from(doc.querySelectorAll("part > measure")))
      m.setAttribute("data-modscore-page", String(page));
    return new XMLSerializer().serializeToString(doc);
  });
  if (!pages.length) throw Error("No recognized pages");
  const signatures = pages.map((xml) => {
    const d = xmlDocument(xml);
    return children(d.documentElement, "part").map((p) => ({
      name: txt(
        d.documentElement,
        `score-part[id="${p.id}"] > part-name`,
        p.id,
      ),
      staffs: Math.max(
        1,
        ...Array.from(p.querySelectorAll("staff,staves")).map(
          (s) => Number(s.textContent) || 1,
        ),
      ),
    }));
  });
  if (
    signatures.some((s) => JSON.stringify(s) !== JSON.stringify(signatures[0]))
  )
    return finalizeSourcePages(mergeIndependentPages(pages, title));
  return finalizeSourcePages(mergeUniformPages(pages, title));
}
function mergeUniformPages(pages: string[], title: string) {
  if (pages.length === 1) return pages[0];
  const docs = pages.map(xmlDocument);
  const dest = docs[0];
  const parts = children(dest.documentElement, "part");
  let number = children(parts[0], "measure").length;
  for (const d of docs.slice(1)) {
    const fields = Array.from(
      d.querySelectorAll(
        'miscellaneous-field[name="modscore-recognition-review"]',
      ),
    );
    if (fields.length) {
      let identification = dest.querySelector("identification");
      if (!identification) {
        identification = dest.createElement("identification");
        dest.documentElement.insertBefore(
          identification,
          dest.querySelector("defaults,part-list"),
        );
      }
      let misc = identification.querySelector("miscellaneous");
      if (!misc) {
        misc = dest.createElement("miscellaneous");
        identification.append(misc);
      }
      for (const field of fields) misc.append(dest.importNode(field, true));
    }
    const incoming = children(d.documentElement, "part");
    if (incoming.length !== parts.length)
      return mergeIndependentPages(pages, title);
    const n = children(incoming[0], "measure").length;
    incoming.forEach((p, i) => {
      for (const m of children(p, "measure")) {
        const clone = dest.importNode(m, true);
        clone.setAttribute(
          "number",
          String(number + Number(m.getAttribute("number") || 1)),
        );
        parts[i].append(clone);
      }
    });
    number += n;
  }
  let titleEl = dest.querySelector("work-title");
  if (!titleEl) {
    const work = dest.createElement("work");
    titleEl = dest.createElement("work-title");
    work.append(titleEl);
    dest.documentElement.prepend(work);
  }
  titleEl.textContent = title;
  return new XMLSerializer().serializeToString(dest);
}

export function amendOnset(xml: string, note: Note, newBeat: number): string {
  if (!Number.isFinite(newBeat) || newBeat < 0) throw Error("Invalid onset");
  if (Math.abs(newBeat - note.beat) < 0.000001) return xml;
  if (note.source.length !== 1)
    throw Error("Move tied notes in an external notation editor.");
  const t = parseMusicXML(xml);
  const m = t.measures[note.measure];
  if (
    newBeat < m.beat ||
    newBeat + note.duration > m.beat + m.duration + 0.0001
  )
    throw Error("Keep the corrected note within its original measure.");
  const delta = newBeat - note.beat;
  if (Math.abs(delta) < 0.0001) return xml;
  const doc = xmlDocument(xml);
  const el = doc.querySelectorAll("part > measure > note")[note.source[0]];
  if (child(el, "chord"))
    throw Error("Move the leading chord note to reposition the entire chord.");
  let divisions = 1;
  for (const measure of children(el.parentElement!.parentElement!, "measure")) {
    const d = measure.querySelector("attributes > divisions");
    if (d) divisions = Number(d.textContent);
    if (measure === el.parentElement) break;
  }
  let ticks = Math.abs(delta) * divisions;
  if (Math.abs(ticks - Math.round(ticks)) > 0.0001) {
    divisions = refineDivisionGrid(
      doc,
      el.parentElement!.parentElement!,
      Math.abs(delta),
    );
    ticks = Math.abs(delta) * divisions;
  }
  const shift = (name: string) => {
    const e = doc.createElement(name);
    const d = doc.createElement("duration");
    d.textContent = String(Math.round(ticks));
    e.append(d);
    return e;
  };
  el.before(shift(delta > 0 ? "forward" : "backup"));
  let last = el;
  while (
    last.nextElementSibling?.localName === "note" &&
    child(last.nextElementSibling, "chord")
  )
    last = last.nextElementSibling;
  last.after(shift(delta > 0 ? "backup" : "forward"));
  return new XMLSerializer().serializeToString(doc);
}
