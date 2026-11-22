import { type Note, type Timeline, isPianoPitch, noteName } from "./music";
import type { AudioEngine } from "./audio";
export const colors = [
  "#b6ef72",
  "#78c8ef",
  "#c9a4ff",
  "#ffb578",
  "#f58daf",
  "#8ee3cc",
];
export class Piano {
  onManualBrowse: () => void = () => {};
  resumeAuto() {
    this.autoUntil = 0;
  }
  private keys = new Map<number, HTMLButtonElement>();
  private fingers = new Map<number, { released: boolean; stop?: () => void }>();
  private canvas: HTMLCanvasElement;
  private inner: HTMLElement;
  private width = 32;
  private previous = "";
  private previousColors = "";
  private positions = new Map<number, number>();
  private autoUntil = 0;
  private keyboardListeners: (() => void)[] = [];
  constructor(
    private root: HTMLElement,
    private audio: AudioEngine,
  ) {
    root.innerHTML =
      '<div class="piano-inner"><canvas class="roll" height="170" aria-label="Falling note visualization"></canvas><div class="keys" role="group" aria-label="88-key piano A0 to C8"></div></div>';
    this.inner = root.querySelector(".piano-inner")!;
    this.canvas = root.querySelector("canvas")!;
    const keys = root.querySelector(".keys")!;
    let whites = 0;
    for (let p = 21; p <= 108; p++) {
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      const x = black ? whites - 0.31 : whites;
      this.positions.set(p, x);
      const key = document.createElement("button");
      key.className = "key " + (black ? "black" : "white");
      key.dataset.pitch = String(p);
      key.setAttribute("aria-label", noteName(p));
      key.innerHTML = `<span>${noteName(p)}</span>`;
      keys.append(key);
      this.keys.set(p, key);
      if (!black) whites++;
      key.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        key.setPointerCapture(e.pointerId);
        const finger: { released: boolean; stop?: () => void } = {
          released: false,
        };
        this.fingers.set(e.pointerId, finger);
        key.classList.add("touched");
        void audio
          .touch(p)
          .then((stop) => {
            finger.stop = stop;
            if (finger.released) stop();
          })
          .catch(console.error);
      });
      const release = (e: PointerEvent) => {
        const finger = this.fingers.get(e.pointerId);
        if (finger) {
          finger.released = true;
          finger.stop?.();
          this.fingers.delete(e.pointerId);
        }
        key.classList.remove("touched");
      };
      key.addEventListener("pointerup", release);
      key.addEventListener("pointercancel", release);
      key.addEventListener("lostpointercapture", release);
    }
    root.addEventListener(
      "pointerdown",
      () => (this.autoUntil = performance.now() + 6000),
    );
    root.addEventListener(
      "wheel",
      () => {
        this.autoUntil = Infinity;
        this.onManualBrowse();
      },
      { passive: true },
    );
    root.addEventListener(
      "touchmove",
      () => {
        this.autoUntil = Infinity;
        this.onManualBrowse();
      },
      { passive: true },
    );
    root.addEventListener("pointerdown", (event) => {
      const r = root.getBoundingClientRect();
      if (event.clientY >= r.top + root.clientHeight) {
        this.autoUntil = Infinity;
        this.onManualBrowse();
      }
    });
    this.zoom(32);
    requestAnimationFrame(() => (root.scrollLeft = 650));
  }
  setLive(pitches: number[]) {
    const set = new Set(pitches);
    for (const [pitch, key] of this.keys)
      key.classList.toggle("live", set.has(pitch));
  }
  zoom(width: number) {
    this.width = width;
    this.inner.style.width = `${width * 52}px`;
    this.canvas.width = width * 52;
    for (const [pitch, key] of this.keys) {
      key.style.left = `${this.positions.get(pitch)! * width}px`;
      key.style.width = `${key.classList.contains("black") ? width * 0.62 : width}px`;
    }
  }
  showRoll(yes: boolean) {
    this.canvas.hidden = !yes;
  }
  update(
    notes: Note[],
    beat: number,
    timeline: Timeline | undefined,
    auto: boolean,
  ) {
    const active = notes.filter(
      (n) =>
        isPianoPitch(n.pitch + this.audio.transpose) && this.audio.audible(n),
    );
    const signature = active
      .map((n) => `${n.id}/${n.pitch}/${this.audio.transpose}`)
      .join(",");
    const palette = colors.join(",");
    if (signature !== this.previous || palette !== this.previousColors) {
      this.previous = signature;
      this.previousColors = palette;
      for (const k of this.keys.values()) {
        k.classList.remove("active");
        k.style.removeProperty("--voice");
      }
      for (const n of active) {
        const key = this.keys.get(n.pitch + this.audio.transpose)!;
        key.classList.add("active");
        key.style.setProperty("--voice", this.color(n));
      }
      if (
        auto &&
        this.audio.playing &&
        active.length &&
        performance.now() > this.autoUntil
      ) {
        const pitch = active[0].pitch + this.audio.transpose;
        const x = this.positions.get(pitch)! * this.width;
        const visible =
          x > this.root.scrollLeft + 60 &&
          x < this.root.scrollLeft + this.root.clientWidth - 60;
        if (!visible)
          this.root.scrollTo({
            left: x - this.root.clientWidth / 2,
            behavior: "smooth",
          });
      }
    }
    if (!this.canvas.hidden) this.draw(beat, timeline);
  }
  color(n: Note) {
    let index = 0;
    if (this.audio.timeline) {
      const keys = [
        ...new Set(
          this.audio.timeline.notes.map((n) => this.audio.voiceKey(n)),
        ),
      ];
      index = keys.indexOf(this.audio.voiceKey(n));
    }
    return colors[Math.max(0, index) % colors.length];
  }
  private draw(beat: number, t?: Timeline) {
    const c = this.canvas,
      ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#ffffff0c";
    for (let b = Math.floor(beat); b < beat + 6; b++) {
      const y = 170 - (b - beat) * 28;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }
    if (!t) return;
    for (const n of t.notes) {
      const p = n.pitch + this.audio.transpose;
      if (
        !isPianoPitch(p) ||
        !this.audio.audible(n) ||
        n.beat + n.duration < beat ||
        n.beat > beat + 6
      )
        continue;
      const x = this.positions.get(p)! * this.width;
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      const bottom = 170 - (n.beat - beat) * 28;
      ctx.fillStyle = this.color(n);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        x + 2,
        bottom - n.duration * 28,
        (black ? 0.62 : 1) * this.width - 4,
        n.duration * 28 - 2,
      );
    }
    ctx.globalAlpha = 1;
  }
  dispose() {
    for (const f of this.fingers.values()) {
      f.released = true;
      f.stop?.();
    }
    this.keyboardListeners.forEach((f) => f());
  }
}
