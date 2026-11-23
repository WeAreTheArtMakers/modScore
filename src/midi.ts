import { performanceTimeline } from "./performance";
import { parseMidi, writeMidi } from "midi-file";
import { spellPitch } from "./notation";
import { Midi } from "@tonejs/midi";
import type { Timeline } from "./music";
const midiText = (value: string) =>
  Array.from(new TextEncoder().encode(value), (v) =>
    String.fromCharCode(v)
  ).join("");
function readMidiText(value: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(value, (c) => c.charCodeAt(0))
    );
  } catch {
    return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "�");
  }
}
export function exportMidi(t: Timeline, transpose = 0, speed = 1) {
  t = performanceTimeline(t);
  const midi = new Midi();
  midi.name = midiText(t.title);
  midi.header.tempos = t.tempos.map((p) => ({
    ticks: Math.round(p.beat * midi.header.ppq),
    bpm: p.bpm * speed,
  }));
  midi.header.timeSignatures = t.measures
    .filter(
      (m, i) =>
        m.meter &&
        (!i ||
          m.meter.beats !== t.measures[i - 1].meter?.beats ||
          m.meter.beatType !== t.measures[i - 1].meter?.beatType)
    )
    .map((m) => ({
      ticks: Math.round(m.beat * midi.header.ppq),
      timeSignature: [m.meter!.beats, m.meter!.beatType],
    }));
  midi.header.update();
  const melodicChannels = Array.from({ length: 16 }, (_, i) => i).filter(
    (i) => i !== 9
  );
  let nextChannel = 0;
  for (const part of t.tracks) {
    // Note-off messages cannot identify individual same-pitch voices on one
    // channel. Partition only overlapping equal pitches, leaving ordinary
    // polyphony together and using separate channels for independent releases.
    const lanes: { ends: Map<number, number>; notes: typeof t.notes }[] = [];
    const notes = t.notes
      .filter((n) => n.track === part.id)
      .slice()
      .sort((a, b) => a.beat - b.beat);
    for (const n of notes) {
      const pitch = n.pitch + transpose;
      if (pitch < 0 || pitch > 127) continue;
      const tick = Math.round(n.beat * midi.header.ppq);
      let lane = part.drums
        ? lanes[0]
        : lanes.find((l) => (l.ends.get(pitch) ?? -1) <= tick);
      if (!lane) {
        lane = { ends: new Map(), notes: [] };
        lanes.push(lane);
      }
      lane.notes.push(n);
      lane.ends.set(
        pitch,
        tick + Math.round((n.soundDuration ?? n.duration) * midi.header.ppq)
      );
    }
    for (const [index, lane] of lanes.entries()) {
      const channel = part.drums ? 9 : melodicChannels[nextChannel++];
      if (channel === undefined)
        throw Error(
          "MIDI needs more than 15 melodic channels to preserve independent voices. Export fewer parts at a time."
        );
      const track = midi.addTrack();
      track.name = midiText(part.name + (index ? ` · layer ${index + 1}` : ""));
      track.channel = channel;
      track.instrument.number = part.program;
      for (const n of lane.notes)
        track.addNote({
          midi: n.pitch + transpose,
          ticks: Math.round(n.beat * midi.header.ppq),
          durationTicks: Math.round(
            (n.soundDuration ?? n.duration) * midi.header.ppq
          ),
          velocity: n.velocity,
        });
    }
  }
  // @tonejs/midi 2.0.28 writes key-signature sf with a +7 index error.
  // Encode this standard signed meta event directly with its underlying MIDI codec.
  const data = parseMidi(midi.toArray());
  if (t.key)
    data.tracks[0].unshift({
      deltaTime: 0,
      meta: true,
      type: "keySignature",
      key: t.key.fifths,
      scale: t.key.mode === "minor" ? 1 : 0,
    });
  return new Blob([new Uint8Array(writeMidi(data))], { type: "audio/midi" });
}
const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      }[c]!)
  );
export function midiToXml(buffer: ArrayBuffer, title: string) {
  const midi = new Midi(buffer);
  const ticks = 480;
  const tracks = midi.tracks.filter((t) => t.notes.length);
  if (!tracks.length) throw Error("MIDI has no note events");
  const sig = midi.header.keySignatures[0];
  const fifths = sig
    ? [
        "Cb",
        "Gb",
        "Db",
        "Ab",
        "Eb",
        "Bb",
        "F",
        "C",
        "G",
        "D",
        "A",
        "E",
        "B",
        "F#",
        "C#",
      ].indexOf(sig.key) - 7
    : 0;
  let xml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${esc(
    midi.name ? readMidiText(midi.name) : title
  )}</work-title></work><part-list>`;
  tracks.forEach(
    (t, i) =>
      (xml += `<score-part id="P${i}"><part-name>${esc(
        readMidiText(t.name) || t.instrument.name
      )}</part-name><midi-instrument id="I${i}"><midi-channel>${
        t.channel + 1
      }</midi-channel><midi-program>${
        t.instrument.number + 1
      }</midi-program></midi-instrument></score-part>`)
  );
  xml += "</part-list>";
  const signatures = midi.header.timeSignatures;
  const signature = signatures[0]?.timeSignature || [4, 4];
  const barBeats = (signature[0] * 4) / signature[1];
  const ppq = midi.header.ppq;
  const end = Math.max(
    ...tracks.flatMap((t) =>
      t.notes.map((n) => (n.ticks + n.durationTicks) / ppq)
    )
  );
  const count = Math.ceil(end / barBeats);
  tracks.forEach((track, ti) => {
    xml += `<part id="P${ti}">`;
    for (let m = 0; m < count; m++) {
      const start = m * barBeats,
        finish = start + barBeats;
      xml += `<measure number="${
        m + 1
      }"><attributes><divisions>${ticks}</divisions>${
        m === 0
          ? `<key><fifths>${fifths}</fifths><mode>${
              sig?.scale || "major"
            }</mode></key><time><beats>${signature[0]}</beats><beat-type>${
              signature[1]
            }</beat-type></time><clef><sign>G</sign><line>2</line></clef>`
          : ""
      }</attributes>`;
      for (const tempo of midi.header.tempos.filter(
        (t) => t.ticks / ppq >= start && t.ticks / ppq < finish
      )) {
        xml += `<direction><offset>${Math.round(
          (tempo.ticks / ppq - start) * ticks
        )}</offset><sound tempo="${tempo.bpm}"/></direction>`;
      }
      let used = false;
      for (const [ni, n] of track.notes.entries()) {
        const b = n.ticks / ppq,
          e = (n.ticks + n.durationTicks) / ppq;
        if (b >= finish || e <= start) continue;
        const local = Math.max(b, start) - start,
          dur = Math.min(e, finish) - Math.max(b, start);
        if (used)
          xml += `<backup><duration>${Math.round(
            barBeats * ticks
          )}</duration></backup>`;
        if (local)
          xml += `<forward><duration>${Math.round(
            local * ticks
          )}</duration></forward>`;
        const pitch = spellPitch(n.midi, fifths);
        xml += `<note><pitch><step>${pitch.step}</step>${
          pitch.alter ? `<alter>${pitch.alter}</alter>` : ""
        }<octave>${pitch.octave}</octave></pitch><duration>${Math.round(
          dur * ticks
        )}</duration>${b < start ? '<tie type="stop"/>' : ""}${
          e > finish ? '<tie type="start"/>' : ""
        }<voice>${ni + 1}</voice></note>`;
        const rest = barBeats - local - dur;
        if (rest > 0.00001)
          xml += `<forward><duration>${Math.round(
            rest * ticks
          )}</duration></forward>`;
        used = true;
      }
      if (!used)
        xml += `<note><rest measure="yes"/><duration>${Math.round(
          barBeats * ticks
        )}</duration></note>`;
      xml += "</measure>";
    }
    xml += "</part>";
  });
  return xml + "</score-partwise>";
}
