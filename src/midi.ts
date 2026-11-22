import { Midi } from "@tonejs/midi";
import type { Timeline } from "./music";
const midiText = (value: string) =>
  Array.from(new TextEncoder().encode(value), (v) =>
    String.fromCharCode(v),
  ).join("");
function readMidiText(value: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(value, (c) => c.charCodeAt(0)),
    );
  } catch {
    return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "�");
  }
}
export function exportMidi(t: Timeline, transpose = 0, speed = 1) {
  const midi = new Midi();
  midi.name = midiText(t.title);
  midi.header.tempos = t.tempos.map((p) => ({
    ticks: Math.round(p.beat * midi.header.ppq),
    bpm: p.bpm * speed,
  }));
  midi.header.update();
  for (const part of t.tracks) {
    const track = midi.addTrack();
    track.name = midiText(part.name);
    track.channel = part.drums ? 9 : Math.min(15, midi.tracks.length - 1);
    if (track.channel === 9 && !part.drums) track.channel = 15;
    track.instrument.number = part.program;
    for (const n of t.notes.filter((n) => n.track === part.id)) {
      const pitch = n.pitch + transpose;
      if (pitch < 0 || pitch > 127) continue;
      track.addNote({
        midi: pitch,
        ticks: Math.round(n.beat * midi.header.ppq),
        durationTicks: Math.round(n.duration * midi.header.ppq),
        velocity: n.velocity,
      });
    }
  }
  return new Blob([new Uint8Array(midi.toArray())], { type: "audio/midi" });
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
      })[c]!,
  );
export function midiToXml(buffer: ArrayBuffer, title: string) {
  const midi = new Midi(buffer);
  const ticks = 480;
  const tracks = midi.tracks.filter((t) => t.notes.length);
  if (!tracks.length) throw Error("MIDI has no note events");
  const pitchNames = [
    "C",
    "C",
    "D",
    "D",
    "E",
    "F",
    "F",
    "G",
    "G",
    "A",
    "A",
    "B",
  ];
  let xml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${esc(midi.name ? readMidiText(midi.name) : title)}</work-title></work><part-list>`;
  tracks.forEach(
    (t, i) =>
      (xml += `<score-part id="P${i}"><part-name>${esc(readMidiText(t.name) || t.instrument.name)}</part-name><midi-instrument id="I${i}"><midi-channel>${t.channel + 1}</midi-channel><midi-program>${t.instrument.number + 1}</midi-program></midi-instrument></score-part>`),
  );
  xml += "</part-list>";
  const signatures = midi.header.timeSignatures;
  const signature = signatures[0]?.timeSignature || [4, 4];
  const barBeats = (signature[0] * 4) / signature[1];
  const ppq = midi.header.ppq;
  const end = Math.max(
    ...tracks.flatMap((t) =>
      t.notes.map((n) => (n.ticks + n.durationTicks) / ppq),
    ),
  );
  const count = Math.ceil(end / barBeats);
  tracks.forEach((track, ti) => {
    xml += `<part id="P${ti}">`;
    for (let m = 0; m < count; m++) {
      const start = m * barBeats,
        finish = start + barBeats;
      xml += `<measure number="${m + 1}"><attributes><divisions>${ticks}</divisions>${m === 0 ? `<time><beats>${signature[0]}</beats><beat-type>${signature[1]}</beat-type></time><clef><sign>G</sign><line>2</line></clef>` : ""}</attributes>`;
      for (const tempo of midi.header.tempos.filter(
        (t) => t.ticks / ppq >= start && t.ticks / ppq < finish,
      )) {
        xml += `<direction><offset>${Math.round((tempo.ticks / ppq - start) * ticks)}</offset><sound tempo="${tempo.bpm}"/></direction>`;
      }
      let used = false;
      for (const [ni, n] of track.notes.entries()) {
        const b = n.ticks / ppq,
          e = (n.ticks + n.durationTicks) / ppq;
        if (b >= finish || e <= start) continue;
        const local = Math.max(b, start) - start,
          dur = Math.min(e, finish) - Math.max(b, start);
        if (used)
          xml += `<backup><duration>${Math.round(barBeats * ticks)}</duration></backup>`;
        if (local)
          xml += `<forward><duration>${Math.round(local * ticks)}</duration></forward>`;
        const pc = n.midi % 12;
        xml += `<note><pitch><step>${pitchNames[pc]}</step>${[1, 3, 6, 8, 10].includes(pc) ? "<alter>1</alter>" : ""}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch><duration>${Math.round(dur * ticks)}</duration>${b < start ? '<tie type="stop"/>' : ""}${e > finish ? '<tie type="start"/>' : ""}<voice>${ni + 1}</voice></note>`;
        const rest = barBeats - local - dur;
        if (rest > 0.00001)
          xml += `<forward><duration>${Math.round(rest * ticks)}</duration></forward>`;
        used = true;
      }
      if (!used)
        xml += `<note><rest measure="yes"/><duration>${Math.round(barBeats * ticks)}</duration></note>`;
      xml += "</measure>";
    }
    xml += "</part>";
  });
  return xml + "</score-partwise>";
}
