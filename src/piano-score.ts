export interface PianoEvent {
  pitch: number;
  beat: number;
  duration: number;
  velocity?: number;
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
  },
) {
  const { bars, bpm } = options,
    divisions = 96;
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
        n.beat < bars * 4,
    )
    .map((n) => ({ ...n, end: Math.min(bars * 4, n.beat + n.duration) }));
  if (
    notes.some(
      (n) =>
        Math.abs(n.beat * 8 - Math.round(n.beat * 8)) > 1e-6 ||
        Math.abs(n.end * 8 - Math.round(n.end * 8)) > 1e-6,
    )
  )
    throw Error("Notes must use the 1/8-beat notation grid");
  const hands = [
    voices(notes.filter((n) => n.pitch >= 60)),
    voices(notes.filter((n) => n.pitch < 60)),
  ];
  const pitch = (p: number) => {
    const step = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"][
      p % 12
    ];
    return `<pitch><step>${step}</step>${[1, 3, 6, 8, 10].includes(p % 12) ? "<alter>1</alter>" : ""}<octave>${Math.floor(p / 12) - 1}</octave></pitch>`;
  };
  let xml = `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(options.title)}</work-title></work><identification><creator type="composer">${escape(options.composer)}</creator>${options.rights ? `<rights>${escape(options.rights)}</rights>` : ""}<encoding><software>modScore</software></encoding>${options.notice ? `<miscellaneous><miscellaneous-field name="modscore-recognition-review">${escape(options.notice)}</miscellaneous-field></miscellaneous>` : ""}</identification><part-list><score-part id="Piano"><part-name>Piano</part-name><score-instrument id="Piano-I"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="Piano-I"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="Piano">`;
  for (let bar = 0; bar < bars; bar++) {
    const from = bar * 4,
      to = from + 4;
    xml += `<measure number="${bar + 1}">${bar > 0 && bar % 4 === 0 ? '<print new-system="yes"/>' : ""}${bar === 0 ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>` : ""}`;
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
          xml += `<backup><duration>${4 * divisions}</duration></backup>`;
        const voice = h === 0 ? v + 1 : v + 101,
          staff = h + 1;
        const emit = (start: number, end: number, group?: Chord) => {
          let at = start;
          while (at < end - 1e-7) {
            const shape = values.find((value) => value[0] <= end - at + 1e-7);
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
              xml += `<note${!note && v > 0 ? ' print-object="no"' : ""}${note ? ` dynamics="${Math.round(Math.max(0, Math.min(1, note.velocity ?? 0.75)) * 100)}"` : ""}>${index ? "<chord/>" : ""}${note ? pitch(note.pitch) : "<rest/>"}<duration>${Math.round(duration * divisions)}</duration>${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}<voice>${voice}</voice><type>${type}</type>${dotted ? "<dot/>" : ""}${hands[h].length > 1 && note ? `<stem>${v % 2 ? "down" : "up"}</stem>` : ""}<staff>${staff}</staff>${stop || start ? `<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}</notations>` : ""}</note>`;
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
  },
) {
  const sorted = notes
    .filter(
      (n) =>
        Number.isFinite(n.startTimeSeconds) &&
        Number.isFinite(n.durationSeconds) &&
        Number.isFinite(n.amplitude) &&
        n.durationSeconds > 0.05 &&
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
  const events = sorted.map((n) => {
    const beat = Math.max(
      0,
      Math.round((((n.startTimeSeconds - offset) * options.bpm) / 60) * 8) / 8,
    );
    const end = Math.max(
      beat + 0.125,
      Math.round(
        (((n.startTimeSeconds + n.durationSeconds - offset) * options.bpm) /
          60) *
          8,
      ) / 8,
    );
    return {
      pitch: n.pitchMidi,
      beat,
      duration: end - beat,
      velocity: Math.max(0.25, Math.min(1, n.amplitude)),
    };
  });
  return {
    xml: pianoScore(events, {
      ...options,
      composer: options.composer || "Audio transcription",
      notice:
        "Automatic audio transcription: estimated pitches, rhythm, tempo and hand assignment. Compare with the source recording before relying on the notation.",
    }),
    offset,
    events,
  };
}
