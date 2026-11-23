import {
  noteStaff as staffOf, orderNoteChildren, pitchToMidi, refineDivisionGrid, writeNoteRhythm,
  xmlDocument, type Note,
} from "./music";
import { keyAlterations, spellPitch } from "./notation";

export const noteLetters = ["C", "D", "E", "F", "G", "A", "B"];
export const accidentalNames: Readonly<Record<number, string>> = {
  [-2]: "flat-flat", [-1]: "flat", 0: "natural", 1: "sharp", 2: "double-sharp",
};
export interface PitchChoice {
  step: string;
  octave: number;
  alter: number | "key";
}
export interface InsertionTarget {
  part: string;
  staff: number;
  voice: string;
}
const EPS = 0.000001;
const naturalKey = keyAlterations(0);
const at = (el: Element | undefined, tag: string) =>
  Array.from(el?.children ?? []).find((node) => node.localName === tag);
const value = (el: Element | undefined, tag: string, fallback = "") =>
  at(el, tag)?.textContent?.trim() || fallback;
const number = (el: Element | undefined, tag: string, fallback = 0) =>
  Number(value(el, tag, String(fallback)));
const voiceOf = (el: Element) => value(el, "voice", "1");
const measureNotes = (doc: Document) =>
  Array.from(doc.querySelectorAll("part > measure > note"));
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
function put(el: Element, tag: string, text: string | number) {
  const node = at(el, tag) ?? el.appendChild(el.ownerDocument.createElement(tag));
  node.textContent = String(text);
  return node;
}

export function readWrittenPitch(note: Element) {
  const pitch = at(note, "pitch");
  const step = value(pitch, "step");
  const octave = number(pitch, "octave");
  const alter = number(pitch, "alter");
  const accidental = value(note, "accidental");
  return { step, octave, alter, accidental };
}

function stateBefore(measure: Element) {
  let divisions = 1;
  let transpose = 0;
  let staves = 1;
  const keys = new Map<number, Record<string, number>>();
  const apply = (attrs: Element) => {
    divisions = number(attrs, "divisions", divisions);
    staves = number(attrs, "staves", staves);
    const trans = at(attrs, "transpose");
    if (trans) transpose = number(trans, "chromatic") + 12 * number(trans, "octave-change");
    for (const key of attrs.querySelectorAll(":scope > key")) {
      const signature = keyAlterations(number(key, "fifths"));
      const letters = key.querySelectorAll("key-step");
      const alters = key.querySelectorAll("key-alter");
      letters.forEach((letter, i) => {
        signature[letter.textContent!.trim()] = Number(alters[i]?.textContent);
      });
      const staff = Number(key.getAttribute("number") ?? 0);
      if (staff === 0) keys.clear();
      keys.set(staff, signature);
    }
  };
  for (const previous of Array.from(measure.parentElement!.children)) {
    if (previous === measure) break;
    for (const attrs of previous.querySelectorAll(":scope > attributes")) apply(attrs);
  }
  const keyFor = (staff: number) => keys.get(staff) ?? keys.get(0) ?? naturalKey;
  return { apply, keyFor, get divisions() { return divisions; },
    get transpose() { return transpose; }, get staves() { return staves; } };
}

function readMeasure(measure: Element, staff?: number) {
  const state = stateBefore(measure);
  let cursor = 0;
  let leading = 0;
  let end = 0;
  const events = Array.from(measure.children, (el) => {
    if (el.localName === "attributes") state.apply(el);
    const chord = !!at(el, "chord");
    const duration = number(el, "duration") / state.divisions;
    const beat = chord ? leading : cursor;
    const event = { el, beat, cursor, duration, chord, transpose: state.transpose,
      key: state.keyFor(staff ?? staffOf(el)), divisions: state.divisions };
    if (el.localName === "note" && !at(el, "grace")) {
      if (!chord) {
        leading = cursor;
        cursor += duration;
      }
      end = Math.max(end, beat + duration);
    }
    if (el.localName === "backup") cursor -= duration;
    if (el.localName === "forward") {
      cursor += duration;
      end = Math.max(end, cursor);
    }
    return event;
  });
  return { events, cursor, end, staves: state.staves };
}

function shift(doc: Document, difference: number, units: number) {
  if (Math.abs(difference) < EPS) return [];
  const ticks = Math.abs(difference) * units;
  if (Math.abs(ticks - Math.round(ticks)) > 0.00001)
    throw Error("Choose a position on the score's timing grid.");
  const el = doc.createElement(difference > 0 ? "forward" : "backup");
  put(el, "duration", Math.round(ticks));
  return [el];
}

export function pitchChoiceForMidi(xml: string, note: Note, midi: number): PitchChoice {
  const el = measureNotes(xmlDocument(xml))[note.source[0]];
  if (!el) throw Error("Note source is unavailable.");
  const context = readMeasure(el.parentElement!).events.find((event) => event.el === el)!;
  const written = midi - context.transpose;
  if (!Number.isInteger(written) || written < 0 || written > 127)
    throw Error("This pitch is outside MIDI range.");
  const fifths = Object.values(context.key).reduce((sum, alter) => sum + alter, 0);
  const pitch = spellPitch(written, fifths);
  return pitch.alter === context.key[pitch.step] ? { ...pitch, alter: "key" } : pitch;
}

function writePitch(el: Element, choice: PitchChoice, key: Record<string, number>, transpose: number) {
  const alter = choice.alter === "key" ? (key[choice.step] ?? 0) : choice.alter;
  if (!noteLetters.includes(choice.step) || !Object.hasOwn(accidentalNames, alter))
    throw Error("Choose a valid note and accidental.");
  const pitch = pitchToMidi(choice.step, choice.octave, alter) + transpose;
  if (pitch < 0 || pitch > 127) throw Error("This pitch is outside MIDI range.");
  const node = at(el, "pitch") ?? el.appendChild(el.ownerDocument.createElement("pitch"));
  put(node, "step", choice.step);
  put(node, "alter", alter);
  put(node, "octave", choice.octave);
  at(el, "accidental")?.remove();
  if (choice.alter !== "key") put(el, "accidental", accidentalNames[alter]);
  orderNoteChildren(el);
  return alter;
}

// A local accidental can change the reading of later notes on the same staff.
// Preserve their encoded pitch by printing a cancellation when it is needed.
function restoreAccidentals(measure: Element, touched: Set<string>) {
  const active = new Map<string, { alter: number; key: Record<string, number> }>();
  const { events } = readMeasure(measure);
  for (const { el, key } of events.sort((a, b) => a.beat - b.beat)) {
    if (!at(el, "pitch")) continue;
    const { step, octave, alter, accidental } = readWrittenPitch(el);
    const id = `${staffOf(el)}:${step}${octave}`;
    if (!touched.has(id)) continue;
    const before = active.get(id);
    const previous = before?.key === key ? before.alter : key[step] ?? 0;
    const tied = el.querySelector('tie[type="stop"]');
    if (tied && !accidental && previous !== alter) continue;
    if (!accidental && alter !== previous && Object.hasOwn(accidentalNames, alter)) {
      put(el, "accidental", accidentalNames[alter]);
      orderNoteChildren(el);
    }
    active.set(id, { alter, key });
  }
}

export function replaceWrittenPitch(xml: string, note: Note, choice: PitchChoice) {
  const doc = xmlDocument(xml);
  const nodes = measureNotes(doc);
  const affected = new Map<Element, Set<string>>();
  let heldAlter: number | undefined;
  for (const index of note.source) {
    const el = nodes[index];
    if (!el || !at(el, "pitch")) throw Error("Note source is unavailable.");
    const measure = el.parentElement!;
    const context = readMeasure(measure).events.find((event) => event.el === el)!;
    const old = readWrittenPitch(el);
    const touched = affected.get(measure) ?? new Set<string>();
    touched.add(`${staffOf(el)}:${old.step}${old.octave}`);
    touched.add(`${staffOf(el)}:${choice.step}${choice.octave}`);
    affected.set(measure, touched);
    const continuation = heldAlter !== undefined;
    heldAlter = writePitch(el, continuation ? { ...choice, alter: heldAlter! } : choice,
      context.key, context.transpose);
    if (continuation) at(el, "accidental")?.remove();
  }
  for (const [measure, touched] of affected) restoreAccidentals(measure, touched);
  return serialize(doc);
}

export function removeWrittenNote(xml: string, note: Note) {
  const doc = xmlDocument(xml);
  const nodes = measureNotes(doc);
  for (const index of note.source) {
    const el = nodes[index];
    if (!el || !at(el, "pitch")) throw Error("Note source is unavailable.");
    const measure = el.parentElement!;
    const before = readMeasure(measure);
    const { step, octave } = readWrittenPitch(el);
    const staff = staffOf(el);
    const next = el.nextElementSibling;
    if (at(el, "chord")) {
      el.remove();
    } else if (next && at(next, "chord")) {
      const removed = before.events.find((event) => event.el === el)!;
      const members = [next];
      while (members.at(-1)!.nextElementSibling && at(members.at(-1)!.nextElementSibling!, "chord"))
        members.push(members.at(-1)!.nextElementSibling!);
      const promoted = before.events.filter((event) => members.includes(event.el))
        .reduce((a, b) => a.duration >= b.duration ? a : b);
      members.at(-1)!.after(...shift(doc, removed.duration - promoted.duration, removed.divisions));
      at(promoted.el, "chord")!.remove();
      if (promoted.duration === removed.duration && !at(promoted.el, "beam")) {
        for (const beam of el.querySelectorAll(":scope > beam")) promoted.el.append(beam);
        orderNoteChildren(promoted.el);
      }
      el.replaceWith(promoted.el);
    } else {
      at(el, "pitch")!.replaceWith(doc.createElement("rest"));
      for (const node of el.querySelectorAll(
        ":scope > tie, :scope > accidental, :scope > stem, :scope > notehead, :scope > notehead-text, :scope > lyric, :scope > notations > :not(tuplet,fermata)",
      )) node.remove();
      for (const attr of ["attack", "release", "dynamics", "end-dynamics", "pizzicato"])
        el.removeAttribute(attr);
    }
    // A long chord member can have been the only event reaching the bar's end.
    const after = readMeasure(measure);
    if (after.end < before.end - EPS) {
      const units = after.events.at(-1)?.divisions ?? 1;
      const rightBarline = Array.from(measure.children).find(
        (node) => node.localName === "barline" && (node.getAttribute("location") ?? "right") === "right",
      );
      const padding = shift(doc, before.end - after.cursor, units);
      if (rightBarline) rightBarline.before(...padding);
      else measure.append(...padding);
    }
    restoreAccidentals(measure, new Set([`${staff}:${step}${octave}`]));
  }
  return serialize(doc);
}

export function insertionTargets(doc: Document, measureIndex: number) {
  return Array.from(doc.querySelectorAll("score-partwise > part")).flatMap((part) => {
    const measure = part.querySelectorAll(":scope > measure")[measureIndex];
    if (!measure) return [];
    const { events, staves } = readMeasure(measure);
    // Recognition imports may contain page-specific parts hidden in other pages.
    const visible = events.filter(({ el }) =>
      el.localName === "note" && el.getAttribute("print-object") !== "no");
    if (!visible.length && events.some(({ el }) => el.getAttribute("print-object") === "no"))
      return [];
    const staffCount = Math.min(32, visible.reduce((count, { el }) => Math.max(count, staffOf(el)), Math.max(staves, 1)));
    return Array.from({ length: staffCount }, (_, i) => {
      const staff = i + 1;
      const voices = [...new Set(visible.filter(({ el }) => staffOf(el) === staff)
        .map(({ el }) => voiceOf(el)))];
      return (voices.length ? voices : ["1"]).map((voice) => ({ part: part.id, staff, voice }));
    }).flat();
  });
}

export function insertWrittenNote(
  xml: string, measureIndex: number, target: InsertionTarget,
  beat: number, duration: number, measureDuration: number, choice: PitchChoice,
) {
  if (!Number.isFinite(beat) || !Number.isFinite(duration) || beat < 0 ||
      duration <= 0 || beat + duration > measureDuration + EPS)
    throw Error("Keep the new note inside the selected measure.");
  const doc = xmlDocument(xml);
  const part = Array.from(doc.querySelectorAll("score-partwise > part"))
    .find((el) => el.id === target.part);
  const measure = part?.querySelectorAll(":scope > measure")[measureIndex];
  if (!part || !measure || !insertionTargets(doc, measureIndex).some(
    (option) => option.part === target.part && option.staff === target.staff && option.voice === target.voice,
  )) throw Error("Choose an available part, staff and voice.");
  const units = refineDivisionGrid(doc, part, beat, duration);
  const { events, end, cursor } = readMeasure(measure, target.staff);
  const voice = events.filter(({ el }) => el.localName === "note" &&
    !at(el, "grace") && staffOf(el) === target.staff && voiceOf(el) === target.voice);
  const sameTime = voice.filter((event) => Math.abs(event.beat - beat) < EPS);
  const chord = sameTime.some((event) => !event.chord) && sameTime.every(({ el, duration: length }) =>
    at(el, "pitch") && Math.abs(length - duration) < EPS);
  const rest = voice.find((event) => at(event.el, "rest") &&
    !event.el.querySelector("notations > *, time-modification") &&
    event.beat <= beat + EPS && event.beat + event.duration >= beat + duration - EPS);
  const overlaps = voice.some((event) =>
    event.beat < beat + duration - EPS && event.beat + event.duration > beat + EPS);
  const rightBarline = events.find(({ el }) =>
    el.localName === "barline" && (el.getAttribute("location") ?? "right") === "right");
  // Use an XML boundary whose active clef, key and transposition match this beat.
  // Keep the cursor unchanged across the inserted material.
  const next = events.find(({ el, chord, beat: atBeat }) =>
    (el.localName === "note" && !chord && !at(el, "grace") && atBeat >= beat - EPS) ||
    (el.localName === "attributes" && atBeat > beat + EPS));
  const context = chord ? sameTime[0] : rest ?? next ?? rightBarline ?? events.at(-1);
  const contextIndex = context ? events.indexOf(context) : -1;
  const previous = events[contextIndex - 1];
  const pitchContext = context === next && next?.el.localName === "attributes" ? previous : context;
  const key = pitchContext?.key ?? stateBefore(measure).keyFor(target.staff);
  const newNote = doc.createElement("note");
  const alter = writePitch(newNote, choice, key, pitchContext?.transpose ?? stateBefore(measure).transpose);
  put(newNote, "duration", Math.round(duration * units));
  let voiceId = target.voice;
  if (overlaps && !chord && !rest) {
    const used = new Set(Array.from(part.querySelectorAll("note"), voiceOf));
    let id = 1;
    while (used.has(String(id))) id++;
    voiceId = String(id);
  }
  put(newNote, "voice", voiceId);
  put(newNote, "staff", target.staff);
  if (!writeNoteRhythm(newNote, duration)) throw Error("Choose a duration from the rhythm palette.");
  orderNoteChildren(newNote);
  if (chord) {
    if (sameTime.some(({ el }) => {
      const pitch = readWrittenPitch(el);
      return pitchToMidi(pitch.step, pitch.octave, pitch.alter) ===
        pitchToMidi(choice.step, choice.octave, alter);
    })) throw Error("This pitch is already in the chord.");
    newNote.prepend(doc.createElement("chord"));
    let last = sameTime.find((event) => !event.chord)!.el;
    while (last.nextElementSibling && at(last.nextElementSibling, "chord"))
      last = last.nextElementSibling;
    last.after(newNote);
  } else if (rest) {
    const before = beat - rest.beat, after = rest.beat + rest.duration - beat - duration;
    const split = (length: number) => {
      if (length <= EPS) return [];
      const note = doc.createElement("note");
      note.append(doc.createElement("rest"));
      put(note, "duration", Math.round(length * units));
      put(note, "voice", target.voice);
      put(note, "staff", target.staff);
      if (!writeNoteRhythm(note, length)) return shift(doc, length, units);
      orderNoteChildren(note);
      return [note];
    };
    rest.el.replaceWith(...split(before), newNote, ...split(after));
  } else {
    const anchor = next ?? rightBarline;
    const position = anchor?.cursor ?? cursor;
    const insertion = [
      ...shift(doc, beat - position, units), newNote,
      ...shift(doc, position - beat - duration, units),
    ];
    if (anchor) anchor.el.before(...insertion);
    else measure.append(...insertion);
  }
  if (end < EPS && beat + duration < measureDuration - EPS) {
    const current = readMeasure(measure).cursor;
    const padding = shift(doc, measureDuration - current, units);
    if (rightBarline) rightBarline.el.before(...padding);
    else measure.append(...padding);
  }
  restoreAccidentals(measure, new Set([`${target.staff}:${choice.step}${choice.octave}`]));
  return { xml: serialize(doc), source: measureNotes(doc).indexOf(newNote) };
}
