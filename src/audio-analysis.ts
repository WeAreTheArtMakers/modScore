export interface DetectedNote {
  pitchMidi: number;
  startTimeSeconds: number;
  durationSeconds: number;
  amplitude: number;
}
export const audioProfiles = {
  piano: { onset: 0.55, frame: 0.3, minSeconds: 0.07, minAmplitude: 0.27 },
  clean: { onset: 0.65, frame: 0.4, minSeconds: 0.1, minAmplitude: 0.35 },
  detailed: { onset: 0.4, frame: 0.25, minSeconds: 0.04, minAmplitude: 0.2 },
};
export type AudioProfile = keyof typeof audioProfiles;
/** Filter detections by explicit acoustic thresholds; never force a pitch into a scale. */
export function cleanDetections(
  notes: DetectedNote[],
  profile: AudioProfile = "piano",
) {
  const p = audioProfiles[profile],
    sorted = notes
      .filter(
        (n) =>
          Number.isInteger(n.pitchMidi) &&
          n.pitchMidi >= 21 &&
          n.pitchMidi <= 108 &&
          Number.isFinite(n.startTimeSeconds) &&
          n.startTimeSeconds >= 0 &&
          Number.isFinite(n.durationSeconds) &&
          n.durationSeconds >= p.minSeconds &&
          Number.isFinite(n.amplitude) &&
          n.amplitude >= p.minAmplitude,
      )
      .map((n) => ({ ...n }))
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const result: DetectedNote[] = [];
  for (const n of sorted) {
    const before = [...result]
      .reverse()
      .find((p) => p.pitchMidi === n.pitchMidi);
    if (
      before &&
      n.startTimeSeconds < before.startTimeSeconds + before.durationSeconds
    ) {
      // A new stronger attack is kept; truncate the preceding same-pitch tail.
      const gap = n.startTimeSeconds - before.startTimeSeconds;
      if (gap >= p.minSeconds) before.durationSeconds = gap;
      else {
        before.durationSeconds = Math.max(
          before.durationSeconds,
          n.startTimeSeconds + n.durationSeconds - before.startTimeSeconds,
        );
        before.amplitude = Math.max(before.amplitude, n.amplitude);
        continue;
      }
    }
    result.push(n);
  }
  return result;
}
/** A bounded onset-energy autocorrelation. This suggests BPM; it does not establish meter. */
export function estimateAudioTempo(samples: Float32Array, rate = 22050) {
  const hop = Math.round(rate * 0.01),
    flux: number[] = [];
  let previous = 0;
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < Math.min(i + hop, samples.length); j++)
      sum += samples[j] * samples[j];
    const value = Math.log1p(100 * Math.sqrt(sum / hop));
    flux.push(Math.max(0, value - previous));
    previous = value;
  }
  if (flux.length < 200) return 120;
  let best = { score: -Infinity, bpm: 120, lag: 50 };
  const candidates: { score: number; bpm: number; lag: number }[] = [];
  for (
    let lag = Math.ceil(60 / 180 / 0.01);
    lag <= Math.floor(60 / 55 / 0.01);
    lag++
  ) {
    let dot = 0,
      a = 0,
      b = 0;
    for (let i = lag; i < flux.length; i++) {
      dot += flux[i] * flux[i - lag];
      a += flux[i] * flux[i];
      b += flux[i - lag] * flux[i - lag];
    }
    const score = dot / Math.sqrt(a * b || 1);
    const candidate = { score, bpm: 60 / (lag * 0.01), lag };
    candidates.push(candidate);
    if (score > best.score) best = candidate;
  }
  // Prefer the quarter-note interpretation of a strong half-time alias when
  // onset energy also supports it; do not double slow music without evidence.
  if (best.bpm < 75) {
    const faster = candidates
      .filter((c) => Math.abs(c.bpm / best.bpm - 2) < 0.07)
      .sort((a, b) => b.score - a.score)[0];
    if (faster && faster.score >= best.score * 0.75) best = faster;
  }
  const left = candidates.find((c) => c.lag === best.lag - 1)?.score,
    right = candidates.find((c) => c.lag === best.lag + 1)?.score;
  const shift =
    left !== undefined && right !== undefined
      ? Math.max(
          -0.5,
          Math.min(
            0.5,
            (0.5 * (left - right)) / (left - 2 * best.score + right || 1),
          ),
        )
      : 0;
  return Math.round((60 / ((best.lag + shift) * 0.01)) * 10) / 10;
}
