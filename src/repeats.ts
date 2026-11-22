import type { Timeline, Measure, Tempo } from "./music";
/** Expand bounded, non-nested forward/backward repeats. Keep a written-position
 * map so notation, live cursor and exported performance agree. */
export function expandRepeats(t: Timeline, xml: Document): Timeline {
  const written = Array.from(xml.querySelector("part")?.children || []).filter(
    (n) => n.localName === "measure",
  );
  if (!written.some((m) => m.querySelector("repeat"))) return t;
  const unsupported = xml.querySelector(
    "ending,segno,coda,sound[da-capo],sound[dalsegno]",
  );
  const blocks: { start: number; end: number; times: number }[] = [];
  let start = 0,
    open = false;
  for (let i = 0; i < written.length; i++) {
    if (written[i].querySelector('repeat[direction="forward"]')) {
      if (open)
        return {
          ...t,
          warnings: [
            ...t.warnings,
            "Nested repeats need external review; playback uses written order.",
          ],
        };
      start = i;
      open = true;
    }
    const close = written[i].querySelector('repeat[direction="backward"]');
    if (close) {
      const times = Number(close.getAttribute("times") || 2);
      if (!Number.isInteger(times) || times < 2 || times > 8)
        return {
          ...t,
          warnings: [
            ...t.warnings,
            "Repeat count is outside 2–8; playback uses written order.",
          ],
        };
      blocks.push({ start, end: i, times });
      open = false;
      start = i + 1;
    }
  }
  if (unsupported || !blocks.length)
    return {
      ...t,
      warnings: [
        ...t.warnings,
        "Endings/navigation require external review; playback uses written order.",
      ],
    };
  const order: number[] = [];
  for (let i = 0; i < written.length; ) {
    const block = blocks.find((b) => b.start === i);
    if (block) {
      for (let pass = 0; pass < block.times; pass++)
        for (let n = i; n <= block.end; n++) order.push(n);
      i = block.end + 1;
    } else order.push(i++);
  }
  if (order.length > 10000 || order.some((n) => !t.measures[n]))
    return {
      ...t,
      warnings: [
        ...t.warnings,
        "Repeat expansion exceeds the supported score size; playback uses written order.",
      ],
    };
  let beat = 0;
  const seen = new Map<number, number>(),
    measures: Measure[] = [],
    notes: Timeline["notes"] = [],
    tempos: Tempo[] = [];
  for (let j = 0; j < order.length; j++) {
    const source = order[j],
      m = t.measures[source],
      pass = (seen.get(source) || 0) + 1;
    seen.set(source, pass);
    measures.push({
      ...m,
      index: j,
      beat,
      number: pass === 1 ? m.number : `${m.number}·${pass}`,
      sourceMeasure: source,
      sourceBeat: m.beat,
      pass,
    });
    let contiguousEnd = m.beat + m.duration;
    for (let k = j + 1; k < order.length && order[k] === order[k - 1] + 1; k++)
      contiguousEnd = t.measures[order[k]].beat + t.measures[order[k]].duration;
    for (const n of t.notes.filter((n) => n.measure === source))
      notes.push({
        ...n,
        id: `${n.id}@${j}`,
        measure: j,
        beat: beat + n.beat - m.beat,
        duration: Math.min(n.duration, contiguousEnd - n.beat),
        soundDuration:
          n.soundDuration === undefined
            ? undefined
            : Math.min(n.soundDuration, contiguousEnd - n.beat),
      });
    const active = t.tempos.filter((p) => p.beat <= m.beat).at(-1) || {
      beat: 0,
      bpm: 120,
    };
    tempos.push({ beat, bpm: active.bpm });
    for (const p of t.tempos)
      if (p.beat > m.beat && p.beat < m.beat + m.duration)
        tempos.push({ beat: beat + p.beat - m.beat, bpm: p.bpm });
    beat += m.duration;
  }
  return {
    ...t,
    notes: notes.sort((a, b) => a.beat - b.beat),
    measures,
    tempos: tempos.filter((p, i) => !i || p.bpm !== tempos[i - 1].bpm),
    duration: beat,
    writtenDuration: t.duration,
    writtenMeasures: t.measures.length,
  };
}
export function writtenBeat(t: Timeline, beat: number) {
  const m =
    [...t.measures].reverse().find((m) => m.beat <= beat) || t.measures[0];
  return m
    ? (m.sourceBeat ?? m.beat) +
        Math.min(m.duration, Math.max(0, beat - m.beat))
    : beat;
}
