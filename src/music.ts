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
}
export interface Measure {
  index: number;
  number: string;
  beat: number;
  duration: number;
  page: number;
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
  const tempos: Tempo[] = [];
  const notes: Note[] = [];
  const tempoOffsets: number[] = [];
  let sourceIndex = 0;
  const pending = new Map<string, Note>();
  for (const part of children(doc.documentElement, "part")) {
    let divisions = 1,
      beats = 4,
      beatType = 4,
      transpose = 0;
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
          const note: Note = {
            id: `n${si}`,
            pitch,
            beat: 0,
            duration: dur,
            track: part.id,
            voice: txt(el, "voice", "1"),
            staff: num(el, "staff", 1),
            measure: mi,
            velocity: 0.75,
            source: [si],
          };
          miNotes.push({ note, localBeat: start });
        }
      }
      const expected = (beats * 4) / beatType;
      if (!Number.isFinite(expected) || expected <= 0)
        throw Error("Invalid time signature");
      const length = max > 0 ? max : expected;
      if (max > expected + 0.001)
        warnings.add(
          `Measure ${m.getAttribute("number") || mi + 1} exceeds its time signature; review voice timing.`,
        );
      measureLengths[mi] = Math.max(measureLengths[mi] || 0, length);
      measureNumbers[mi] = m.getAttribute("number") || String(mi + 1);
      staged.push(...miNotes);
      if (m.querySelector("repeat,ending"))
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
      page: 0,
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
  return {
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
  };
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
  return t.notes.filter((n) => n.beat <= beat && n.beat + n.duration > beat);
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
      const ticks = duration * divisions;
      if (Math.abs(ticks - Math.round(ticks)) > 0.00001)
        throw Error(
          `Duration must be a multiple of 1/${divisions} quarter note.`,
        );
      set(el, "duration", String(Math.round(ticks)));
      for (const d of Array.from(el.querySelectorAll("dot,time-modification")))
        d.remove();
      const types: Record<string, string> = {
        "4": "whole",
        "2": "half",
        "1": "quarter",
        "0.5": "eighth",
        "0.25": "16th",
        "0.125": "32nd",
      };
      const simple = types[String(duration)];
      const dotted = types[String(duration / 1.5)];
      set(el, "type", simple || dotted || "quarter");
      if (dotted && !simple) el.append(doc.createElement("dot"));
      if (!simple && !dotted) el.querySelector("type")?.remove();
    }
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
  const lengths = timelines.flatMap((t) => t.measures.map((m) => m.duration));
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
export function mergePages(pages: string[], title: string) {
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
    return mergeIndependentPages(pages, title);
  return mergeUniformPages(pages, title);
}
function mergeUniformPages(pages: string[], title: string) {
  if (pages.length === 1) return pages[0];
  const docs = pages.map(xmlDocument);
  const dest = docs[0];
  const parts = children(dest.documentElement, "part");
  let number = children(parts[0], "measure").length;
  for (const d of docs.slice(1)) {
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
  const ticks = Math.abs(delta) * divisions;
  if (Math.abs(ticks - Math.round(ticks)) > 0.0001)
    throw Error(`Onset must use 1/${divisions} quarter-note steps.`);
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
