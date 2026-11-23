import { beatToSeconds, secondsToBeat, type Timeline } from "./music";
import type { AudioEngine } from "./audio";
import type { Project } from "./storage";
import { mapTime } from "./source-alignment";

function calculateAlignment(p: Project, t: Timeline) {
  const a = p.sourceAlignment;
  const bpm = a?.bpm ?? p.performance?.bpm;
  const tempos = bpm ? [{ beat: 0, bpm }] : t.tempos;
  const points = (a?.points ?? []).flatMap(({measure, seconds}) =>
    t.measures[measure] ? [[beatToSeconds(t.measures[measure].beat, tempos), seconds] as [number, number]] : []);
  const inverse = points.map(([score, recording]): [number, number] => [recording, score]);
  return { tempos, points, inverse, offset: a?.offset ?? p.performance?.sourceStart ?? 0 };
}

const mappings = new WeakMap<Project, {
  score: Timeline;
  settings: Project["sourceAlignment"];
  result: ReturnType<typeof calculateAlignment>;
}>();
function alignment(p: Project, t: Timeline) {
  const cached = mappings.get(p);
  if (cached?.score === t && cached.settings === p.sourceAlignment) return cached.result;
  const result = calculateAlignment(p, t);
  mappings.set(p, { score: t, settings: p.sourceAlignment, result });
  return result;
}

export function sourceSeconds(p: Project, t: Timeline, beat: number) {
  const { tempos, points, offset } = alignment(p, t);
  return mapTime(beatToSeconds(beat, tempos), points, offset);
}

export function sourceBeat(p: Project, t: Timeline, seconds: number) {
  const { tempos, inverse, offset } = alignment(p, t);
  const nominal = mapTime(seconds, inverse, -offset);
  return Math.min(t.duration, secondsToBeat(Math.max(0, nominal), tempos));
}
/** A/B replays from a stable, user-selected written beat. Native source seeking
 * can set a new anchor. Switching stops the other player before starting. */
export class SourceComparison {
  anchor = 0;
  private id = "";
  private element?: HTMLAudioElement;
  private project?: Project;
  private timeline?: Timeline;
  private generation = 0;
  private fromSource = false;
  private pending?: () => void;
  constructor(private piano: AudioEngine) {}
  bind(element: HTMLAudioElement | undefined, p: Project, t: Timeline) {
    this.detach();
    if (this.id !== p.id) {
      this.anchor = 0;
      this.id = p.id;
    }
    this.element = element;
    this.project = p;
    this.timeline = t;
    if (element) {
      element.volume = this.piano.volume;
      element.onseeking = () => {
        this.fromSource = true;
      };
      element.onplay = () => {
        if (element.paused) return;
        this.fromSource = true;
        this.piano.pause();
        element.playbackRate = this.piano.speed;
      };
    }
  }
  detach() {
    this.pending?.();
    this.pending = undefined;
    this.generation++;
    this.fromSource = false;
    if (this.element) {
      this.element.pause();
      this.element.onplay = null;
      this.element.onseeking = null;
    }
    this.element = undefined;
  }
  pause(keepSourcePosition = false) {
    this.pending?.();
    this.pending = undefined;
    if (!keepSourcePosition) this.fromSource = false;
    this.generation++;
    this.element?.pause();
  }
  here() {
    if (
      this.element &&
      !this.piano.playing &&
      this.fromSource &&
      this.project &&
      this.timeline
    )
      this.anchor = sourceBeat(
        this.project,
        this.timeline,
        this.element.currentTime,
      );
    else this.anchor = this.piano.now();
    this.pause();
    this.piano.pause();
    return this.anchor;
  }
  async listenSource() {
    const e = this.element,
      p = this.project,
      t = this.timeline;
    if (!e || !p || !t) throw Error("Attach a source recording first.");
    this.pending?.();
    this.pending = undefined;
    const request = ++this.generation;
    this.piano.pause();
    e.pause();
    if (e.readyState < 1)
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          e.removeEventListener("loadedmetadata", ok);
          e.removeEventListener("error", bad);
          clearTimeout(timer);
          this.pending = undefined;
        };
        const ok = () => {
            cleanup();
            resolve();
          },
          bad = () => {
            cleanup();
            reject(Error("The source recording could not be decoded."));
          };
        const timer = setTimeout(() => {
          cleanup();
          reject(Error("Source audio metadata timed out."));
        }, 15000);
        this.pending = () => {
          cleanup();
          resolve();
        };
        e.addEventListener("loadedmetadata", ok);
        e.addEventListener("error", bad);
        e.load();
      });
    if (request !== this.generation) return;
    const seconds = sourceSeconds(p, t, this.anchor);
    if (seconds < 0 || seconds >= e.duration)
      throw Error(
        "The selected score position is outside this recording. Adjust its offset or recording BPM.",
      );
    e.currentTime = seconds;
    e.playbackRate = this.piano.speed;
    this.fromSource = true;
    try {
      await e.play();
    } catch (error) {
      // A newer action may pause playback while this play request is pending.
      if (request === this.generation) throw error;
    }
  }
  async listenPiano() {
    this.pause();
    this.piano.pause();
    this.piano.position = this.anchor;
    await this.piano.play();
  }
  syncRate() {
    if (this.element && this.element.playbackRate !== this.piano.speed)
      this.element.playbackRate = this.piano.speed;
  }
  get sourcePlaying() {
    return !!this.element && !this.element.paused;
  }
}
