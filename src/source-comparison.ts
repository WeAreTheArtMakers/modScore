import { beatToSeconds, secondsToBeat, type Timeline } from "./music";
import type { AudioEngine } from "./audio";
import type { Project } from "./storage";
export function sourceSeconds(p: Project, t: Timeline, beat: number) {
  const a = p.sourceAlignment;
  const tempos = a?.bpm
    ? [{ beat: 0, bpm: a.bpm }]
    : p.performance
    ? [{ beat: 0, bpm: p.performance.bpm }]
    : t.tempos;
  return (
    (a?.offset ?? p.performance?.sourceStart ?? 0) + beatToSeconds(beat, tempos)
  );
}
export function sourceBeat(p: Project, t: Timeline, seconds: number) {
  const a = p.sourceAlignment;
  const tempos = a?.bpm
    ? [{ beat: 0, bpm: a.bpm }]
    : p.performance
    ? [{ beat: 0, bpm: p.performance.bpm }]
    : t.tempos;
  return Math.min(
    t.duration,
    secondsToBeat(
      Math.max(0, seconds - (a?.offset ?? p.performance?.sourceStart ?? 0)),
      tempos,
    ),
  );
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
      element.onloadedmetadata = () => {
        element.currentTime = Math.max(
          0,
          Math.min(element.duration || 0, sourceSeconds(p, t, this.anchor)),
        );
      };
      element.onseeking = () => {
        this.fromSource = true;
      };
      element.onplay = () => {
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
    if (this.element) {
      this.element.pause();
      this.element.onplay = null;
      this.element.onseeking = null;
      this.element.onloadedmetadata = null;
    }
    this.element = undefined;
  }
  pause() {
    this.pending?.();
    this.pending = undefined;
    this.fromSource = false;
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
    this.pending=undefined;
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
    await e.play();
    if (request !== this.generation) e.pause();
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
