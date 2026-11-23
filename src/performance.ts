import type { Note, Timeline, Tempo } from "./music";
import { keyAlterations } from "./notation";
export interface ExpressionOptions {
  style: "auto" | "baroque" | "classical" | "literal";
  fermata: number;
}
export interface Ornament {
  type: "trill" | "mordent" | "inverted-mordent";
  upper: number;
  lower: number;
  start?: "main" | "upper" | "below";
  count?: number;
  long?: boolean;
}
export interface NoteExpression {
  ornament?: Ornament;
  arpeggio?: { number: string; direction: "up" | "down" };
}
export interface Fermata {
  beat: number;
  duration: number;
  factor: number;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function fermataFactor(el: Element) {
  const shape = el.querySelector("notations > fermata")?.textContent?.trim();
  return shape === undefined
    ? undefined
    : { "very-short": 1.15, short: 1.25, long: 1.75, "very-long": 2 }[shape] ||
        1.5;
}
export function readExpression(
  el: Element,
  step: string,
  octave: number,
  transpose: number,
  fifths: number,
  accidentals: Map<string, number>,
): NoteExpression | undefined {
  const names = "CDEFGAB",
    pcs = [0, 2, 4, 5, 7, 9, 11],
    i = names.indexOf(step),
    key = keyAlterations(fifths);
  const neighbor = (delta: number) => {
    const d = i + delta,
      index = (d + 7) % 7,
      oct = octave + Math.floor(d / 7),
      name = names[index];
    return (
      (oct + 1) * 12 +
      pcs[index] +
      (accidentals.get(name + oct) ?? key[name] ?? 0) +
      transpose
    );
  };
  const node = el.querySelector(
    "ornaments > trill-mark,ornaments > mordent,ornaments > inverted-mordent",
  );
  const arp = el.querySelector("notations > arpeggiate");
  if (!node && !arp) return;
  const value: NoteExpression = {};
  if (node) {
    let upper = neighbor(1),
      lower = neighbor(-1);
    const marks = {
      flat: -1,
      sharp: 1,
      natural: 0,
      "double-sharp": 2,
      "flat-flat": -2,
    } as Record<string, number>;
    for (const mark of Array.from(
      node.parentElement!.querySelectorAll("accidental-mark"),
    )) {
      const delta = marks[mark.textContent?.trim() || ""];
      if (delta === undefined) continue;
      const below = mark.getAttribute("placement") === "below";
      const d = i + (below ? -1 : 1),
        index = (d + 7) % 7,
        oct = octave + Math.floor(d / 7),
        p = (oct + 1) * 12 + pcs[index] + delta + transpose;
      if (below) lower = p;
      else upper = p;
    }
    const pitch =
      (octave + 1) * 12 +
      pcs[i] +
      Number(el.querySelector("pitch > alter")?.textContent || 0) +
      transpose;
    if (node.hasAttribute("trill-step"))
      upper =
        pitch +
        ({ half: 1, whole: 2, unison: 0 }[node.getAttribute("trill-step")!] ??
          2);
    const start = node.getAttribute("start-note");
    const count = Number(node.getAttribute("beats"));
    value.ornament = {
      type:
        node.localName === "trill-mark"
          ? "trill"
          : (node.localName as Ornament["type"]),
      upper,
      lower,
      start: ["main", "upper", "below"].includes(start || "")
        ? (start as Ornament["start"])
        : undefined,
      count: count >= 2 && count <= 64 ? Math.round(count) : undefined,
      long: node.getAttribute("long") === "yes",
    };
  }
  if (arp)
    value.arpeggio = {
      number: arp.getAttribute("number") || "1",
      direction: arp.getAttribute("direction") === "down" ? "down" : "up",
    };
  return value;
}
const cache = new WeakMap<Timeline, { key: string; value: Timeline }>();
/** Written notes stay intact for editing/engraving. All sound consumers share this realization. */
export function performanceTimeline(t: Timeline): Timeline {
  if (t.realized) return t;
  const options = t.expression || { style: "auto", fermata: 1.5 };
  if (options.style === "literal") return t;
  const key = options.style + ":" + options.fermata,
    saved = cache.get(t);
  if (saved?.key === key) return saved.value;
  const style =
    options.style === "auto"
      ? t.composer?.match(/bach/i)
        ? "baroque"
        : "classical"
      : options.style;
  const baseAt = (b: number) =>
    t.tempos.filter((p) => p.beat <= b).at(-1)?.bpm || 120;
  const holds = t.fermatas || [];
  const boundaries = [
    ...new Set([
      ...t.tempos.map((p) => p.beat),
      ...holds.flatMap((h) => [h.beat, h.beat + h.duration]),
    ]),
  ]
    .filter((b) => b >= 0 && b <= t.duration)
    .sort((a, b) => a - b);
  const tempos: Tempo[] = [];
  for (const beat of boundaries) {
    const factor = Math.max(
      1,
      ...holds
        .filter((h) => h.beat <= beat && h.beat + h.duration > beat + 1e-8)
        .map((h) =>
          clamp(1 + ((h.factor - 1) * (options.fermata - 1)) / 0.5, 1, 3),
        ),
    );
    const bpm = baseAt(beat) / factor;
    if (!tempos.length || tempos.at(-1)!.bpm !== bpm)
      tempos.push({ beat, bpm });
  }
  if (!tempos.length) tempos.push(...t.tempos);
  const notes: Note[] = [];
  for (const n of t.notes) {
    const o = n.expression?.ornament;
    if (!o) {
      notes.push({ ...n });
      continue;
    }
    const length = n.soundDuration ?? n.duration,
      bpm = baseAt(n.beat),
      seconds = (length * 60) / bpm;
    if (seconds < 0.06) {
      notes.push({ ...n });
      continue;
    }
    let pitches: number[], durations: number[];
    if (o.type === "trill") {
      const start = o.start || (style === "baroque" ? "upper" : "main");
      let count = o.count || clamp(Math.round(seconds * 8), 3, 64);
      if (
        !o.count &&
        ((start === "main" && count % 2 === 0) ||
          (start !== "main" && count % 2 !== 0))
      )
        count = count === 64 ? 63 : count + 1;
      pitches = Array.from({ length: count }, (_, j) =>
        start === "below"
          ? j % 2
            ? n.pitch
            : o.lower
          : start === "upper"
          ? j % 2
            ? n.pitch
            : o.upper
          : j % 2
          ? o.upper
          : n.pitch,
      );
      durations = pitches.map(() => length / count);
    } else {
      const aux = o.type === "mordent" ? o.lower : o.upper,
        count = o.long ? 5 : 3;
      pitches = Array.from({ length: count }, (_, j) =>
        j % 2 ? aux : n.pitch,
      );
      if (o.start === "upper") pitches.unshift(o.upper);
      if (o.start === "below") pitches.unshift(o.lower);
      const rapid = Math.min(length * 0.18, (bpm / 60) * 0.065);
      durations = pitches.map((_, j) =>
        j === pitches.length - 1
          ? length - rapid * (pitches.length - 1)
          : rapid,
      );
    }
    if (pitches.length + notes.length > 200000)
      throw Error(
        "Expressive playback exceeds 200,000 events. Choose Literal playback for this score.",
      );
    let at = n.beat;
    for (let j = 0; j < pitches.length; j++) {
      const duration = durations[j];
      notes.push({
        ...n,
        id: `${n.id}:orn${j}`,
        pitch: clamp(pitches[j], 0, 127),
        beat: at,
        duration,
        soundDuration: duration,
        expression: undefined,
      });
      at += duration;
    }
  }
  const groups = new Map<string, Note[]>();
  for (const n of notes)
    if (n.expression?.arpeggio) {
      const a = n.expression.arpeggio,
        k = `${n.track}:${n.beat}:${a.number}`;
      const group = groups.get(k) || [];
      group.push(n);
      groups.set(k, group);
    }
  for (const group of groups.values()) {
    const marked = group[0].expression!.arpeggio!,
      same = notes.filter(
        (n) =>
          n.track === group[0].track &&
          n.beat === group[0].beat &&
          !n.expression?.ornament,
      );
    // Marking a single chord member conventionally marks the entire same-voice chord;
    // explicit shared numbers can join marked notes across staves.
    for (const n of same)
      if (
        group.some((m) => m.staff === n.staff && m.voice === n.voice) &&
        !group.includes(n)
      )
        group.push(n);
    group.sort((a, b) =>
      marked.direction === "down" ? b.pitch - a.pitch : a.pitch - b.pitch,
    );
    const maxRoll = Math.min(
        (0.18 * baseAt(group[0].beat)) / 60,
        ...group.map((n) => (n.soundDuration ?? n.duration) * 0.4),
      ),
      step = group.length > 1 ? maxRoll / (group.length - 1) : 0;
    group.forEach((n, i) => {
      const shift = step * i;
      n.beat += shift;
      n.duration = Math.max(0.001, n.duration - shift);
      n.soundDuration = Math.max(
        0.001,
        (n.soundDuration ?? n.duration + shift) - shift,
      );
    });
  }
  const value = {
    ...t,
    notes: notes.sort((a, b) => a.beat - b.beat),
    tempos,
    realized: true,
  };
  cache.set(t, { key, value });
  return value;
}
