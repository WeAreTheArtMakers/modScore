export interface KeySignature {
  fifths: number;
  mode: "major" | "minor";
}
export const keyChoices = Array.from({ length: 15 }, (_, i) => i - 7).flatMap(
  (f, i) => [
    {
      fifths: f,
      mode: "major" as const,
      label:
        [
          "C♭",
          "G♭",
          "D♭",
          "A♭",
          "E♭",
          "B♭",
          "F",
          "C",
          "G",
          "D",
          "A",
          "E",
          "B",
          "F♯",
          "C♯",
        ][i] + " major",
    },
    {
      fifths: f,
      mode: "minor" as const,
      label:
        [
          "A♭",
          "E♭",
          "B♭",
          "F",
          "C",
          "G",
          "D",
          "A",
          "E",
          "B",
          "F♯",
          "C♯",
          "G♯",
          "D♯",
          "A♯",
        ][i] + " minor",
    },
  ],
);
export function keyAlterations(fifths: number) {
  const result: Record<string, number> = {
    C: 0,
    D: 0,
    E: 0,
    F: 0,
    G: 0,
    A: 0,
    B: 0,
  };
  for (const step of (fifths < 0 ? "BEADGCF" : "FCGDAEB").slice(
    0,
    Math.abs(fifths),
  ))
    result[step] = fifths < 0 ? -1 : 1;
  return result;
}
export function spellPitch(midi: number, fifths = 0) {
  const key = keyAlterations(fifths),
    base: Record<string, number> = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
    };
  const candidates = Object.entries(base).flatMap(([step, pc]) =>
    [-1, 0, 1]
      .filter((alter) => (pc + alter + 12) % 12 === midi % 12)
      .map((alter) => ({
        step,
        alter,
        octave: (midi - pc - alter) / 12 - 1,
        score:
          Math.abs(alter - key[step]) * 2 +
          Math.abs(alter) +
          ((fifths < 0 && alter > 0) || (fifths > 0 && alter < 0) ? 0.2 : 0),
      })),
  );
  return candidates.sort((a, b) => a.score - b.score)[0];
}
export function estimateKey(
  events: { pitch: number; duration: number; velocity?: number }[],
): KeySignature {
  const chroma = Array(12).fill(0);
  for (const n of events)
    chroma[n.pitch % 12] += Math.min(2, n.duration) * (n.velocity ?? 0.7);
  const profiles = {
    major: [
      6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ],
    minor: [
      6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ],
  };
  const mean = chroma.reduce((a, b) => a + b, 0) / 12;
  let best = {
    score: -Infinity,
    fifths: 0,
    mode: "major" as "major" | "minor",
  };
  for (const mode of ["major", "minor"] as const)
    for (let root = 0; root < 12; root++) {
      const p = profiles[mode],
        pm = p.reduce((a, b) => a + b) / 12;
      let dot = 0,
        a = 0,
        b = 0;
      for (let i = 0; i < 12; i++) {
        const x = chroma[(i + root) % 12] - mean,
          y = p[i] - pm;
        dot += x * y;
        a += x * x;
        b += y * y;
      }
      const score = dot / Math.sqrt(a * b || 1),
        majorRoot = mode === "major" ? root : (root + 3) % 12;
      const fifths =
        Array.from({ length: 15 }, (_, i) => i - 7)
          .filter((f) => (((7 * f) % 12) + 12) % 12 === majorRoot)
          .sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
      if (score > best.score) best = { score, fifths, mode };
    }
  return { fifths: best.fifths, mode: best.mode };
}
export function suggestChord(
  events: { pitch: number; duration: number; velocity?: number }[],
) {
  if (!events.length) return;
  const weights = Array(12).fill(0);
  for (const n of events)
    weights[n.pitch % 12] += n.duration * (n.velocity ?? 0.7);
  const total = weights.reduce((a, b) => a + b, 0),
    bass = Math.min(...events.map((n) => n.pitch)) % 12;
  let best = { root: 0, kind: "major", score: 0 };
  for (let root = 0; root < 12; root++)
    for (const [kind, steps] of Object.entries({
      major: [0, 4, 7],
      minor: [0, 3, 7],
      diminished: [0, 3, 6],
      dominant: [0, 4, 7, 10],
    })) {
      const present = steps.map((n) => weights[(root + n) % 12]);
      if (present.filter((n) => n > 0).length < 3) continue;
      const coverage = present.reduce((a, b) => a + b, 0) / total,
        score =
          coverage - 0.1 * (steps.length - 3) + (bass === root ? 0.08 : 0);
      if (score > best.score) best = { root, kind, score };
    }
  return best.score >= 0.65 ? { root: best.root, kind: best.kind } : undefined;
}
