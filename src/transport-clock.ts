import { beatToSeconds, secondsToBeat, type Timeline } from "./music";
export interface Pulse {
  beat: number;
  measure: number;
  index: number;
  count: number;
  accent: boolean;
}
export function metronomePulses(timeline: Timeline): Pulse[] {
  const pulses: Pulse[] = [];
  for (const m of timeline.measures) {
    const beats = m.meter?.beats || 4,
      unit = m.meter?.beatType || 4;
    const step = unit === 8 && beats >= 6 && beats % 3 === 0 ? 1.5 : 4 / unit;
    const count = Math.max(1, Math.ceil((m.duration - 1e-8) / step));
    for (let i = 0; i < count; i++)
      pulses.push({
        beat: m.beat + i * step,
        measure: m.index,
        index: i,
        count,
        accent: i === 0,
      });
  }
  return pulses;
}
/** AudioContext time is continuous across loop turns. No timer restart or
 * loading/activation delay is inserted at a loop boundary. */
export class TransportClock {
  readonly end: number;
  readonly firstEnd: number;
  readonly period: number;
  constructor(
    readonly timeline: Timeline,
    readonly start: number,
    readonly speed: number,
    readonly anchor: number,
    readonly loop?: [number, number],
  ) {
    this.end = loop?.[1] ?? timeline.duration;
    this.firstEnd = anchor + this.seconds(this.end) - this.seconds(start);
    this.period = loop ? this.seconds(loop[1]) - this.seconds(loop[0]) : 0;
    if (loop && !(this.period > 0))
      throw Error("Loop must have positive duration");
  }
  seconds(beat: number) {
    return beatToSeconds(beat, this.timeline.tempos, this.speed);
  }
  cycleAt(time: number) {
    return !this.loop || time < this.firstEnd
      ? 0
      : 1 + Math.floor((time - this.firstEnd + 1e-9) / this.period);
  }
  from(cycle: number) {
    return cycle && this.loop ? this.loop[0] : this.start;
  }
  when(beat: number, cycle = 0) {
    return cycle && this.loop
      ? this.firstEnd +
          (cycle - 1) * this.period +
          this.seconds(beat) -
          this.seconds(this.loop[0])
      : this.anchor + this.seconds(beat) - this.seconds(this.start);
  }
  beatAt(time: number) {
    const cycle = this.cycleAt(time),
      from = this.from(cycle);
    const seconds =
      this.seconds(from) + Math.max(0, time - this.when(from, cycle));
    return Math.min(
      this.end,
      secondsToBeat(seconds, this.timeline.tempos, this.speed),
    );
  }
  cycles(time: number, horizon: number) {
    if (!this.loop && time >= this.firstEnd) return [];
    const first = this.cycleAt(time),
      last = this.cycleAt(horizon);
    return Array.from(
      { length: Math.min(256, last - first + 1) },
      (_, i) => first + i,
    );
  }
}
