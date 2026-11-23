export interface AlignmentPoint {
  /** Zero-based index in playback order, including repeated visits. */
  measure: number;
  seconds: number;
}

export interface SourceAlignment {
  offset: number;
  bpm?: number;
  points?: AlignmentPoint[];
}

export function validAlignmentPoints(points: unknown): points is AlignmentPoint[] {
  if (!Array.isArray(points) || points.length > 64) return false;
  let previousMeasure = -1, previousSeconds = -1;
  for (const point of points) {
    if (!point || !Number.isSafeInteger(point.measure) || point.measure <= previousMeasure ||
        point.measure >= 100000 || !Number.isFinite(point.seconds) ||
        point.seconds < 0 || point.seconds <= previousSeconds) return false;
    previousMeasure = point.measure;
    previousSeconds = point.seconds;
  }
  return true;
}

/** Piecewise mapping in nominal score seconds. Beyond the marked span keep
 * the recorded anchor and fall back to the score's nominal rate. */
export function mapTime(time: number, points: readonly [number, number][], offset: number) {
  const first = points[0], last = points.at(-1);
  if (!first || !last) return time + offset;
  if (time <= first[0]) return first[1] + time - first[0];
  if (time >= last[0]) return last[1] + time - last[0];
  const end = points.findIndex(([seconds]) => seconds >= time);
  const [fromTime, fromValue] = points[end - 1];
  const [toTime, toValue] = points[end];
  return fromValue + (time - fromTime) * (toValue - fromValue) / (toTime - fromTime);
}
