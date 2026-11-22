import { sourceLocation } from "./recognition-review";
import { xmlDocument, parseMusicXML } from "./music";
/** Structural checks describe encoded music; they never claim image recognition confidence. */
export function reviewEncoding(xml: string) {
  const doc = xmlDocument(xml);
  let divisions = 1,
    beats = 4,
    unit = 4;
  const rows: {
    part: string;
    index: number;
    tuplets: number;
    measure: string;
    expected: number;
    encoded: number;
    ties: number;
    shortNotes: number;
    beams: number;
    issues: string[];
  }[] = [];
  for (const part of Array.from(
    doc.querySelectorAll("score-partwise > part"),
  )) {
    divisions = 1;
    beats = 4;
    unit = 4;
    let measureIndex = 0;
    for (const measure of Array.from(part.children).filter(
      (e) => e.tagName === "measure",
    )) {
      let at = 0,
        end = 0,
        previous = 0;
      const intervals = new Map<string, [number, number][]>();
      const issues: string[] = [];
      for (const node of Array.from(measure.children)) {
        if (node.tagName === "attributes") {
          divisions = Number(
            node.querySelector("divisions")?.textContent || divisions,
          );
          beats = String(
            node.querySelector("time > beats")?.textContent || beats,
          )
            .split("+")
            .reduce((s, n) => s + Number(n), 0);
          unit = Number(
            node.querySelector("time > beat-type")?.textContent || unit,
          );
        }
        const duration =
          Number(node.querySelector(":scope > duration")?.textContent || 0) /
          divisions;
        if (node.tagName === "backup") at -= duration;
        if (node.tagName === "forward") at += duration;
        if (node.tagName === "note" && !node.querySelector("grace")) {
          const chord = !!node.querySelector("chord"),
            start = chord ? previous : at;
          if (!chord) {
            previous = at;
            at += duration;
          }
          end = Math.max(end, start + duration);
          const staff = node.querySelector("staff")?.textContent || "1";
          const spans = intervals.get(staff) || [];
          spans.push([start, start + duration]);
          intervals.set(staff, spans);
        }
      }
      const expected = (beats * 4) / unit;
      if (
        Math.abs(end - expected) > 0.001 &&
        measure.getAttribute("implicit") !== "yes"
      )
        issues.push(
          `Encoded length ${end} vs ${expected} quarter beats; check rests and durations (pickup measures may be intentional).`,
        );
      for (const [staff, spans] of intervals) {
        spans.sort((a, b) => a[0] - b[0]);
        let covered = 0;
        for (const [start, stop] of spans) {
          if (start > covered + 0.001)
            issues.push(
              `Staff ${staff}: no encoded note/rest from beat ${covered} to ${start}.`,
            );
          covered = Math.max(covered, stop);
        }
        if (
          covered < expected - 0.001 &&
          measure.getAttribute("implicit") !== "yes"
        )
          issues.push(
            `Staff ${staff}: encoded content ends at beat ${covered}.`,
          );
      }
      const pitched = Array.from(measure.querySelectorAll("note")).filter(n => n.querySelector("pitch"));
      const tuplets = pitched.filter(n => n.querySelector("time-modification")).length;
      if (tuplets >= 9 && tuplets > pitched.length / 2)
        issues.push("Dense tuplet passage: verify printed grouping and short-note values against the original; do not assume the decoded tuplets are correct.");
      const previousPositions = new Map<string, number>();
      for (const note of pitched) {
        const position = sourceLocation(note);
        if (!position) continue;
        const key = `${note.querySelector("voice")?.textContent}:${position.box.join(",")}`;
        const previous = previousPositions.get(key);
        const unit = (position.box[3] - position.box[1]) / 4;
        if (previous !== undefined && position.x < previous - 2 * unit)
          issues.push("Model positions move backwards within a staff: check note order, repeated notes and voice assignment in the source excerpt.");
        previousPositions.set(key, position.x);
      }
      rows.push({
        part: part.id,
        index: measureIndex++,
        tuplets,
        measure: measure.getAttribute("number") || "",
        expected,
        encoded: end,
        ties: measure.querySelectorAll('tie[type="start"]').length,
        shortNotes: measure.querySelectorAll("note > type").length
          ? Array.from(measure.querySelectorAll("note")).filter((n) =>
              ["eighth", "16th", "32nd", "64th", "128th", "256th", "512th", "1024th"].includes(
                n.querySelector("type")?.textContent || "",
              ),
            ).length
          : 0,
        beams: measure.querySelectorAll("beam").length,
        issues,
      });
    }
  }
  return rows;
}
export function setScoreTempo(xml: string, bpm: number, words = "") {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)
    throw Error("Tempo must be 20–300 BPM");
  const doc = xmlDocument(xml),
    measure = doc.querySelector("part > measure");
  if (!measure) throw Error("No measure");
  // Add an authoritative opening direction, without guessing a BPM from prose.
  const direction = doc.createElement("direction");
  direction.setAttribute("data-modscore-tempo", "true");
  for (const old of Array.from(
    measure.querySelectorAll("direction[data-modscore-tempo]"),
  ))
    old.remove();
  // Existing opening directions must not override the explicit user correction.
  for (const old of Array.from(measure.children)) {
    if (old.tagName === "note" || old.tagName === "forward") break;
    for (const sound of Array.from(old.querySelectorAll("sound[tempo]")))
      sound.removeAttribute("tempo");
    for (const metronome of Array.from(old.querySelectorAll("metronome")))
      metronome.remove();
  }
  const type = doc.createElement("direction-type"),
    metronome = doc.createElement("metronome");
  for (const [name, value] of [
    ["beat-unit", "quarter"],
    ["per-minute", String(bpm)],
  ]) {
    const el = doc.createElement(name);
    el.textContent = value;
    metronome.append(el);
  }
  type.append(metronome);
  direction.append(type);
  if (words.trim()) {
    const textType = doc.createElement("direction-type"),
      text = doc.createElement("words");
    text.textContent = words.trim();
    textType.append(text);
    direction.prepend(textType);
  }
  const sound = doc.createElement("sound");
  sound.setAttribute("tempo", String(bpm));
  direction.append(sound);
  const first = Array.from(measure.children).find(
    (n) => n.tagName !== "attributes" && n.tagName !== "print",
  );
  measure.insertBefore(direction, first || null);
  return new XMLSerializer().serializeToString(doc);
}
export function tieNext(xml: string, note: import("./music").Note) {
  const doc = xmlDocument(xml);
  const all = Array.from(doc.querySelectorAll("part > measure > note"));
  // Reuse musical time rather than source order, which interleaves piano voices.
  const timeline = parseMusicXML(xml);
  const next = timeline.notes.find(
    (n) =>
      n.pitch === note.pitch &&
      n.track === note.track &&
      n.staff === note.staff &&
      n.voice === note.voice &&
      Math.abs(n.beat - note.beat - note.duration) < 0.0001,
  );
  if (!next)
    throw Error("No contiguous note with the same pitch, staff and voice.");
  const mark = (el: Element, kind: string) => {
    if (!el.querySelector(`tie[type="${kind}"]`)) {
      const tie = doc.createElement("tie");
      tie.setAttribute("type", kind);
      el.insertBefore(tie, el.querySelector("voice,type"));
    }
    let notation = el.querySelector("notations");
    if (!notation) {
      notation = doc.createElement("notations");
      el.append(notation);
    }
    if (!notation.querySelector(`tied[type="${kind}"]`)) {
      const tied = doc.createElement("tied");
      tied.setAttribute("type", kind);
      notation.append(tied);
    }
  };
  mark(all[note.source[note.source.length - 1]], "start");
  mark(all[next.source[0]], "stop");
  return new XMLSerializer().serializeToString(doc);
}
export function untie(xml: string, note: import("./music").Note) {
  const doc = xmlDocument(xml),
    all = doc.querySelectorAll("part > measure > note");
  for (const index of note.source)
    for (const marker of Array.from(
      all[index].querySelectorAll("tie,notations > tied"),
    ))
      marker.remove();
  return new XMLSerializer().serializeToString(doc);
}
