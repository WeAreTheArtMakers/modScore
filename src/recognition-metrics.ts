import type { Note, Timeline } from "./music";

function byStaff(score: Timeline, measure: number) {
  const staffOffsets = new Map<string, number>();
  let offset = 0;
  for (const track of score.tracks) {
    staffOffsets.set(track.id, offset);
    offset += score.notes.reduce((max, n) => n.track === track.id ? Math.max(max, n.staff) : max, 1);
  }
  const groups = new Map<number, Note[]>();
  for (const n of score.notes) {
    if (n.measure !== measure) continue;
    const staff = (staffOffsets.get(n.track) ?? 0) + n.staff;
    const group = groups.get(staff) ?? [];
    group.push(n);
    groups.set(staff, group);
  }
  return groups;
}

const round = (n: number) => +n.toFixed(5);
/** Benchmark matched notes per written measure and staff. Match the same pitch
 * at the nearest onset first. Pair remaining nearby attacks so a wrong pitch
 * can be measured independently of onset and release. */
export function measureRecognition(reference: Timeline, candidate: Timeline) {
  const pairWindow = 0.25;
  const tolerance = 1 / 48;
  const barCount = Math.max(reference.measures.length, candidate.measures.length);
  const rows = [];
  for (let index = 0; index < barCount; index++) {
    const expected = byStaff(reference, index), detected = byStaff(candidate, index);
    let referenceNotes = 0, detectedNotes = 0, paired = 0, wrongPitch = 0,
      onsetErrors = 0, durationErrors = 0, onsetTotal = 0, durationTotal = 0;
    for (const staff of new Set([...expected.keys(), ...detected.keys()])) {
      const a = expected.get(staff) ?? [], b = detected.get(staff) ?? [];
      referenceNotes += a.length;
      detectedNotes += b.length;
      const originA = reference.measures[index]?.beat ?? 0;
      const originB = candidate.measures[index]?.beat ?? 0;
      const edges = a.flatMap((note, i) => b.flatMap((guess, j) => {
        const onsetError = Math.abs((note.beat - originA) - (guess.beat - originB));
        return onsetError <= pairWindow + 1e-8 ?
          [{i, j, onsetError, samePitch: note.pitch === guess.pitch}] : [];
      }));
      edges.sort((a, b) => Number(b.samePitch) - Number(a.samePitch) || a.onsetError - b.onsetError);
      const usedA = new Set<number>(), usedB = new Set<number>();
      for (const {i, j, samePitch, onsetError} of edges) {
        if (usedA.has(i) || usedB.has(j)) continue;
        usedA.add(i);
        usedB.add(j);
        paired++;
        if (!samePitch) wrongPitch++;
        const durationError = Math.abs(a[i].duration - b[j].duration);
        if (onsetError > tolerance + 1e-8) onsetErrors++;
        if (durationError > tolerance + 1e-8) durationErrors++;
        onsetTotal += onsetError;
        durationTotal += durationError;
      }
    }
    rows.push({
      measure: index + 1, referenceNotes, detectedNotes, paired, wrongPitch,
      missing: referenceNotes - paired, extra: detectedNotes - paired,
      onsetErrors, durationErrors,
      onsetMAEBeats: paired ? round(onsetTotal / paired) : null,
      durationMAEBeats: paired ? round(durationTotal / paired) : null,
    });
  }
  return { pairWindowBeats: pairWindow, errorToleranceBeats: tolerance, measures: rows };
}
