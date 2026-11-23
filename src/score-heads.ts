import { noteName, noteStaff, pitchToMidi } from "./music";

interface WrittenHead {
  source: number;
  voice: string;
}
interface GraphicalNote {
  sourceNote: {
    halfTone: number;
    IsGraceNote: boolean;
    isRest(): boolean;
    voiceEntry?: { parentVoice?: { voiceId?: number } };
  };
  vfnoteIndex: number;
  getNoteheadSVGs(): SVGElement[];
}
interface GraphicalMeasure {
  parentStaff: { parentInstrument: { idString: string; staves: unknown[] } };
  staffEntries: {
    relInMeasureTimestamp: { RealValue: number };
    graphicalVoiceEntries: { notes: GraphicalNote[] }[];
  }[];
}

const key = (part: string, staff: number, measure: number, beat: number, midi: number) =>
  JSON.stringify([part, staff, measure, Math.round(beat * 1e5), midi]);

function writtenHeads(doc: Document) {
  const index = new Map<string, WrittenHead[]>();
  let source = 0;
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    let divisions = 1;
    const measures = Array.from(part.querySelectorAll(":scope > measure"));
    for (const [measure, bar] of measures.entries()) {
      let at = 0;
      let lead = 0;
      for (const el of bar.children) {
        const duration = Number(el.querySelector(":scope > duration")?.textContent || 0) / divisions;
        if (el.localName === "attributes") {
          divisions = Number(el.querySelector(":scope > divisions")?.textContent || divisions);
        } else if (el.localName === "backup") {
          at -= duration;
        } else if (el.localName === "forward") {
          at += duration;
        } else if (el.localName === "note") {
          const id = source++;
          if (el.querySelector("grace")) continue;
          if (!el.querySelector(":scope > chord")) {
            lead = at;
            at += duration;
          }
          const step = el.querySelector("pitch > step")?.textContent;
          if (!step || duration <= 0 || el.getAttribute("print-object") === "no") continue;
          let midi: number;
          try {
            midi = pitchToMidi(step, Number(el.querySelector("pitch > octave")?.textContent),
              Number(el.querySelector("pitch > alter")?.textContent ?? 0));
          } catch {
            continue;
          }
          const k = key(part.id, noteStaff(el), measure, lead, midi);
          const candidates = index.get(k) ?? [];
          candidates.push({ source: id, voice: el.querySelector("voice")?.textContent?.trim() || "1" });
          index.set(k, candidates);
        }
      }
    }
  }
  return index;
}

/** The pinned OSMD renderer gives each chord member its own SVG notehead.
 * Match written coordinates, then leave shared unison heads unassigned. */
export function mapScoreHeads(doc: Document, bars: GraphicalMeasure[][]) {
  const written = writtenHeads(doc);
  const candidates = new Map<SVGElement, { source: number; name: string }[]>();
  for (const [measure, bar] of bars.entries()) {
    for (const gm of bar) {
      if (!gm?.parentStaff) continue;
      const instrument = gm.parentStaff.parentInstrument;
      const staff = instrument.staves.indexOf(gm.parentStaff) + 1;
      for (const entry of gm.staffEntries) {
        for (const voice of entry.graphicalVoiceEntries) {
          for (const gn of voice.notes) {
            const n = gn.sourceNote;
            if (n.IsGraceNote || n.isRest()) continue;
            const midi = n.halfTone + 12;
            const notes = written.get(key(instrument.idString, staff, measure,
              entry.relInMeasureTimestamp.RealValue * 4, midi));
            if (!notes?.length) continue;
            const sameVoice = notes.filter((note) => note.voice === String(n.voiceEntry?.parentVoice?.voiceId));
            const note = notes.length === 1 ? notes[0] : sameVoice.length === 1 ? sameVoice[0] : undefined;
            const head = gn.getNoteheadSVGs()?.[gn.vfnoteIndex];
            if (!note || !head || !head.isConnected) continue;
            const matches = candidates.get(head) ?? [];
            matches.push({ source: note.source, name: noteName(midi) });
            candidates.set(head, matches);
          }
        }
      }
    }
  }
  return [...candidates].flatMap(([head, matches]) =>
    matches.length === 1 ? [{ head, ...matches[0] }] : [],
  );
}
