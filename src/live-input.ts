import type { AudioEngine } from "./audio";
export const typingNotes: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
};
export class LiveInput {
  enabled = localStorage.getItem("modscore-typing") !== "off";
  octave = 4;
  active = new Map<
    string,
    { pitch: number; released: boolean; stop?: () => void }
  >();
  access: any;
  selected = "";
  status = "MIDI not connected";
  onchange = () => {};
  private sustain = new Set<string>();
  private held = new Set<string>();
  constructor(
    private audio: AudioEngine,
    private canType: () => boolean,
  ) {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.panic);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.panic();
    });
  }
  start(key: string, pitch: number, velocity = 0.8) {
    if (this.active.has(key) || pitch < 0 || pitch > 127) return;
    const note = {
      pitch,
      released: false,
      stop: undefined as undefined | (() => void),
    };
    this.active.set(key, note);
    this.onchange();
    void this.audio
      .touch(pitch, velocity)
      .then((stop) => {
        note.stop = stop;
        if (note.released) stop();
      })
      .catch((e) => {
        this.stop(key);
        this.status = e.message;
        this.onchange();
      });
  }
  stop(key: string) {
    const n = this.active.get(key);
    if (n) {
      n.released = true;
      n.stop?.();
      this.active.delete(key);
      this.onchange();
    }
  }
  panic = () => {
    for (const key of [...this.active.keys()]) this.stop(key);
    this.held.clear();
    this.sustain.clear();
  };
  pitches() {
    return [...this.active.values()].map((n) => n.pitch);
  }
  changeOctave(delta: number) {
    this.panic();
    this.octave = Math.max(1, Math.min(7, this.octave + delta));
    this.onchange();
  }
  private down = (e: KeyboardEvent) => {
    if (
      !this.enabled ||
      !this.canType() ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.repeat
    )
      return;
    const target = e.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable="true"],dialog'))
      return;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      e.preventDefault();
      this.changeOctave(e.code === "KeyX" ? 1 : -1);
      return;
    }
    const step = typingNotes[e.code];
    if (step !== undefined) {
      e.preventDefault();
      this.start("key:" + e.code, (this.octave + 1) * 12 + step);
    }
  };
  private up = (e: KeyboardEvent) => this.stop("key:" + e.code);
  async connect() {
    if (!(navigator as any).requestMIDIAccess)
      throw Error(
        "Web MIDI is unavailable in this browser. Use Chrome/Edge with HTTPS or localhost.",
      );
    await this.audio.activate();
    this.access ??= await (navigator as any).requestMIDIAccess({
      sysex: false,
    });
    this.access.onstatechange = () => {
      if (
        this.selected &&
        !this.inputs().some(
          (i: any) => i.id === this.selected && i.state === "connected",
        )
      )
        this.select("");
      this.onchange();
    };
    this.select(this.inputs()[0]?.id || "");
    this.status = this.inputs().length
      ? "MIDI connected"
      : "No MIDI input found";
    this.onchange();
  }
  inputs(): any[] {
    return this.access ? [...this.access.inputs.values()] : [];
  }
  select(id: string) {
    this.panic();
    for (const input of this.inputs()) {
      input.onmidimessage = null;
      if (input.id !== id && input.close) void input.close().catch(() => {});
    }
    this.selected = id;
    const input = this.inputs().find((i) => i.id === id);
    if (input) input.onmidimessage = (e: any) => this.message(id, e.data);
    this.onchange();
  }
  message(port: string, data: ArrayLike<number>) {
    const command = data[0] & 240,
      ch = data[0] & 15,
      pitch = data[1],
      value = data[2],
      group = port + ":" + ch,
      key = "midi:" + group + ":" + pitch;
    if (command === 144 && value > 0) {
      this.held.delete(key);
      this.stop(key);
      this.start(key, pitch, value / 127);
    }
    if (command === 128 || (command === 144 && value === 0)) {
      if (this.sustain.has(group)) this.held.add(key);
      else this.stop(key);
    }
    if (command === 176 && pitch === 64) {
      if (value >= 64) this.sustain.add(group);
      else {
        this.sustain.delete(group);
        for (const k of [...this.held])
          if (k.startsWith("midi:" + group + ":")) {
            this.held.delete(k);
            this.stop(k);
          }
      }
    }
    if (command === 176 && [120, 123].includes(pitch)) this.panic();
  }
}
