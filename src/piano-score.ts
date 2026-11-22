import {
  spellPitch,
  keyAlterations,
  estimateKey,
  suggestChord,
  type KeySignature,
} from "./notation";
export interface PianoEvent {
  pitch: number;
  beat: number;
  duration: number;
  velocity?: number;
  staff?: 1 | 2;
  articulation?:
    | "staccato"
    | "staccatissimo"
    | "tenuto"
    | "accent"
    | "strong-accent";
}
const escape = (v: string) =>
  v.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const values: [number, string, boolean][] = [
  [4, "whole", false],
  [3, "half", true],
  [2, "half", false],
  [1.5, "quarter", true],
  [1, "quarter", false],
  [0.75, "eighth", true],
  [0.5, "eighth", false],
  [0.375, "16th", true],
  [0.25, "16th", false],
  [0.125, "32nd", false],
];
type Event = PianoEvent & { end: number };
interface Chord {
  beat: number;
  end: number;
  notes: Event[];
}
/** Interval partitioning preserves independent releases without splitting every
 * sustained note at every other note's attack/release. Equal intervals are chords. */
function voices(notes: Event[]): Chord[][] {
  const groups = new Map<string, Chord>();
  for (const note of notes) {
    const key = `${note.beat}:${note.end}`;
    const group = groups.get(key) || {
      beat: note.beat,
      end: note.end,
      notes: [],
    };
    group.notes.push(note);
    groups.set(key, group);
  }
  const result: Chord[][] = [];
  for (const group of [...groups.values()].sort(
    (a, b) => a.beat - b.beat || b.end - a.end,
  )) {
    let voice = result.find((v) => v.at(-1)!.end <= group.beat + 1e-7);
    if (!voice) {
      voice = [];
      result.push(voice);
    }
    voice.push(group);
  }
  return result.length ? result : [[]];
}
export function pianoScore(
  events: PianoEvent[],
  options: {
    title: string;
    composer: string;
    bars: number;
    bpm: number;
    notice?: string;
    rights?: string;
    key?: KeySignature;
    meter?: { beats: number; beatType: number };
    clefs?: {
      beat: number;
      staff: number;
      sign: "G" | "F";
      line: number;
      octaveChange?: number;
    }[];
    chordSuggestions?: boolean;
    barDurations?: number[];
  },
) {
  const { bars, bpm } = options,
    divisions = 96;
  const key = options.key || { fifths: 0, mode: "major" },
    meter = options.meter || { beats: 4, beatType: 4 };
  const barBeats = (meter.beats * 4) / meter.beatType;
  if (
    !Number.isInteger(key.fifths) ||
    Math.abs(key.fifths) > 7 ||
    !["major", "minor"].includes(key.mode) ||
    !Number.isInteger(meter.beats) ||
    meter.beats < 1 ||
    meter.beats > 16 ||
    ![2, 4, 8, 16].includes(meter.beatType)
  )
    throw Error("Invalid key or time signature");
  const lengths = options.barDurations || Array(bars).fill(barBeats);
  if (
    lengths.length !== bars ||
    lengths.some(
      (n) =>
        !Number.isFinite(n) ||
        n <= 0 ||
        n > barBeats ||
        Math.abs(n * 8 - Math.round(n * 8)) > 1e-7,
    )
  )
    throw Error("Invalid measure lengths");
  const starts = lengths.reduce<number[]>((a, n) => [...a, a.at(-1)! + n], [0]),
    totalBeats = starts.at(-1)!;
  const clefs = (options.clefs || []).slice().sort((a, b) => a.beat - b.beat);
  if (
    !Number.isInteger(bars) ||
    bars < 1 ||
    bars > 256 ||
    !Number.isFinite(bpm) ||
    bpm < 20 ||
    bpm > 300
  )
    throw Error("Invalid score length or tempo");
  const notes = events
    .filter(
      (n) =>
        Number.isInteger(n.pitch) &&
        n.pitch >= 21 &&
        n.pitch <= 108 &&
        Number.isFinite(n.beat) &&
        Number.isFinite(n.duration) &&
        n.duration > 0 &&
        n.beat >= 0 &&
        n.beat < totalBeats,
    )
    .map((n) => ({ ...n, end: Math.min(totalBeats, n.beat + n.duration) }));
  if (
    notes.some(
      (n) =>
        Math.abs(n.beat * 8 - Math.round(n.beat * 8)) > 1e-6 ||
        Math.abs(n.end * 8 - Math.round(n.end * 8)) > 1e-6,
    )
  )
    throw Error("Notes must use the 1/8-beat notation grid");
  const hands = [
    voices(notes.filter((n) => (n.staff ?? (n.pitch >= 60 ? 1 : 2)) === 1)),
    voices(notes.filter((n) => (n.staff ?? (n.pitch >= 60 ? 1 : 2)) === 2)),
  ];
  const pitch = (p: number) => {
    const n = spellPitch(p, key.fifths);
    return `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ""}<octave>${n.octave}</octave></pitch>`;
  };
  const clefXml = (c: {
    staff: number;
    sign: string;
    line: number;
    octaveChange?: number;
  }) =>
    `<clef number="${c.staff}"><sign>${c.sign}</sign><line>${c.line}</line>${c.octaveChange ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>` : ""}</clef>`;
  const initialClefs = [1, 2]
    .map((staff) =>
      clefXml(
        clefs.find((c) => c.beat === 0 && c.staff === staff) || {
          staff,
          sign: staff === 1 ? "G" : "F",
          line: staff === 1 ? 2 : 4,
        },
      ),
    )
    .join("");
  let xml = `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(options.title)}</work-title></work><identification><creator type="composer">${escape(options.composer)}</creator>${options.rights ? `<rights>${escape(options.rights)}</rights>` : ""}<encoding><software>modScore</software></encoding>${options.notice ? `<miscellaneous><miscellaneous-field name="modscore-recognition-review">${escape(options.notice)}</miscellaneous-field></miscellaneous>` : ""}</identification><part-list><score-part id="Piano"><part-name>Piano</part-name><score-instrument id="Piano-I"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="Piano-I"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="Piano">`;
  for (let bar = 0; bar < bars; bar++) {
    const from = starts[bar],
      to = starts[bar + 1];
    xml += `<measure number="${bar + 1}"${lengths[bar] < barBeats ? ' implicit="yes"' : ""}>${bar > 0 && bar % 4 === 0 ? '<print new-system="yes"/>' : ""}${bar === 0 ? `<attributes><divisions>${divisions}</divisions><key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key><time><beats>${meter.beats}</beats><beat-type>${meter.beatType}</beat-type></time><staves>2</staves>${initialClefs}</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>` : ""}`;
    if (bar > 0 && clefs.some((c) => c.beat === from))
      xml += `<attributes>${clefs
        .filter((c) => c.beat === from)
        .map(clefXml)
        .join("")}</attributes>`;
    if (options.chordSuggestions) {
      const group = notes.filter((n) => n.beat >= from && n.beat < to);
      const chord = suggestChord(group);
      if (chord) {
        const root = spellPitch(chord.root + 60, key.fifths);
        xml += `<harmony><root><root-step>${root.step}</root-step>${root.alter ? `<root-alter>${root.alter}</root-alter>` : ""}</root><kind>${chord.kind}</kind><staff>1</staff></harmony>`;
      }
    }
    let lane = 0;
    for (let h = 0; h < 2; h++) {
      const active = hands[h]
        .map((groups, v) => ({ groups, v }))
        .filter(({ groups }) =>
          groups.some((g) => g.beat < to && g.end > from),
        );
      for (const { groups, v } of active.length
        ? active
        : [{ groups: [], v: 0 }]) {
        if (lane++)
          xml += `<backup><duration>${lengths[bar] * divisions}</duration></backup>`;
        const voice = h === 0 ? v + 1 : v + 101,
          staff = h + 1;
        const emit = (start: number, end: number, group?: Chord) => {
          let at = start;
          while (at < end - 1e-7) {
            if (v === 0) {
              const changes = clefs.filter(
                (c) =>
                  c.staff === staff &&
                  c.beat > from &&
                  c.beat < to &&
                  Math.abs(c.beat - at) < 1e-7,
              );
              if (changes.length)
                xml += `<attributes>${changes.map(clefXml).join("")}</attributes>`;
            }
            const nextChange =
              clefs.find(
                (c) => c.staff === staff && c.beat > at + 1e-7 && c.beat < end,
              )?.beat ?? end;
            const shape = values.find(
              (value) => value[0] <= nextChange - at + 1e-7,
            );
            if (!shape) throw Error("Invalid notation grid");
            const [duration, type, dotted] = shape;
            const unique = group
              ? [
                  ...new Map(
                    [...group.notes]
                      .sort((a, b) => (a.velocity ?? 0.7) - (b.velocity ?? 0.7))
                      .map((n) => [n.pitch, n]),
                  ).values(),
                ].sort((a, b) => a.pitch - b.pitch)
              : [null];
            unique.forEach((note, index) => {
              const stop = !!note && note.beat < at - 1e-7,
                start = !!note && note.end > at + duration + 1e-7;
              xml += `<note${!note && v > 0 ? ' print-object="no"' : ""}${note ? ` dynamics="${Math.round(Math.max(0, Math.min(1, note.velocity ?? 0.75)) * 100)}"` : ""}>${index ? "<chord/>" : ""}${note ? pitch(note.pitch) : "<rest/>"}<duration>${Math.round(duration * divisions)}</duration>${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}<voice>${voice}</voice><type>${type}</type>${dotted ? "<dot/>" : ""}${hands[h].length > 1 && note ? `<stem>${v % 2 ? "down" : "up"}</stem>` : ""}<staff>${staff}</staff>${stop || start || note?.articulation ? `<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}${note?.articulation && !stop ? `<articulations><${note.articulation}/></articulations>` : ""}</notations>` : ""}</note>`;
            });
            at += duration;
          }
        };
        let at = from;
        for (const group of groups) {
          if (group.end <= from || group.beat >= to) continue;
          const start = Math.max(from, group.beat),
            end = Math.min(to, group.end);
          if (start > at) emit(at, start);
          emit(start, end, group);
          at = end;
        }
        if (at < to) emit(at, to);
      }
    }
    if (bar === bars - 1)
      xml +=
        '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    xml += "</measure>";
  }
  return xml + "</part></score-partwise>";
}
export function audioNotesToScore(
  notes: {
    pitchMidi: number;
    startTimeSeconds: number;
    durationSeconds: number;
    amplitude: number;
  }[],
  options: {
    title: string;
    bpm: number;
    bars: number;
    composer?: string;
    trimStart?: boolean;
    key?: KeySignature;
    meter?: { beats: number; beatType: number };
    grid?: number;
    chordSuggestions?: boolean;
  },
) {
  const sorted = notes
    .filter(
      (n) =>
        Number.isFinite(n.startTimeSeconds) &&
        Number.isFinite(n.durationSeconds) &&
        Number.isFinite(n.amplitude) &&
        n.durationSeconds > 0 &&
        Number.isInteger(n.pitchMidi) &&
        n.pitchMidi >= 21 &&
        n.pitchMidi <= 108,
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  if (!sorted.length)
    throw Error(
      "No stable piano-range notes were detected. Try a cleaner single-instrument recording.",
    );
  const offset =
    options.trimStart === false ? 0 : Math.max(0, sorted[0].startTimeSeconds);
  const grid = options.grid ?? 0.25;
  if (![0.125, 0.25, 0.5].includes(grid))
    throw Error("Choose an eighth, sixteenth or 32nd-note grid");
  const performance = sorted.map((n) => ({
    pitch: n.pitchMidi,
    beat: Math.max(0, ((n.startTimeSeconds - offset) * options.bpm) / 60),
    duration: (n.durationSeconds * options.bpm) / 60,
    velocity: Math.max(0.1, Math.min(1, n.amplitude)),
  }));
  const quantized = sorted.map((n) => {
    const beat = Math.max(
      0,
      Math.round(((n.startTimeSeconds - offset) * options.bpm) / 60 / grid) *
        grid,
    );
    const end = Math.max(
      beat + grid,
      Math.round(
        (((n.startTimeSeconds + n.durationSeconds - offset) * options.bpm) /
          60) *
          (1 / grid),
      ) * grid,
    );
    return {
      pitch: n.pitchMidi,
      beat,
      duration: end - beat,
      velocity: Math.max(0.25, Math.min(1, n.amplitude)),
    };
  });
  // Attacks that collapse onto one notation-grid position cannot be engraved
  // as separate identical piano strikes. Preserve both in performance MIDI.
  const positions = new Map<string, PianoEvent>();
  for (const note of quantized) {
    const id = `${note.pitch}:${note.beat}`,
      before = positions.get(id);
    if (before) {
      before.duration = Math.max(before.duration, note.duration);
      before.velocity = Math.max(before.velocity ?? 0, note.velocity);
    } else positions.set(id, note);
  }
  const events = [...positions.values()];
  const key = options.key || estimateKey(performance);
  return {
    key,
    performance,
    xml: pianoScore(events, {
      ...options,
      key,
      composer: options.composer || "Audio transcription",
      notice:
        "Automatic audio transcription: estimated pitches, rhythm, tempo and hand assignment. Compare with the source recording before relying on the notation.",
    }),
    offset,
    events,
  };
}
