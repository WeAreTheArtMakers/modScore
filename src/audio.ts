import {
  beatToSeconds,
  secondsToBeat,
  type Timeline,
  type Note,
} from "./music";
import { Instruments } from "./instruments";
export interface VoiceState {
  mute: boolean;
  solo: boolean;
}
export class AudioEngine {
  context?: AudioContext;
  master?: GainNode;
  instruments = new Instruments();
  playing = false;
  position = 0;
  speed = 1;
  transpose = 0;
  volume = 0.65;
  metronome = false;
  timeline?: Timeline;
  voices = new Map<string, VoiceState>();
  loop?: [number, number];
  private timer?: number;
  private anchor = 0;
  private origin = 0;
  private scheduled = new Set<string>();
  private sources = new Set<AudioScheduledSourceNode>();
  private gains = new Map<AudioScheduledSourceNode, GainNode>();
  private clickBeat = -1;
  async activate() {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      this.context.addEventListener("statechange", () => {
        if (this.playing && this.context?.state !== "running") this.pause();
      });
    }
    await this.context.resume();
    if (this.context.state !== "running")
      throw Error("Tap Play again to activate audio.");
  }
  async loadInstrument(program: number) {
    this.pause();
    await this.activate();
    await this.instruments.load(program);
    if (this.timeline) await this.prepare();
  }
  async prepare() {
    if (!Object.keys(this.instruments.bank).length)
      await this.instruments.load(0);
    await this.instruments.prepare(
      this.context!,
      this.timeline?.notes
        .map((n) => n.pitch + this.transpose)
        .filter((p) => p >= 0 && p <= 127) || [],
    );
  }
  voiceKey(n: Note) {
    return `${n.track}:${n.staff}:${n.voice}`;
  }
  audible(n: Note) {
    const state = this.voices.get(this.voiceKey(n));
    const solo = [...this.voices.values()].some((s) => s.solo);
    return !state?.mute && (!solo || !!state?.solo);
  }
  now() {
    if (!this.playing || !this.context || !this.timeline) return this.position;
    const sec = this.origin + this.context.currentTime - this.anchor;
    return secondsToBeat(sec, this.timeline.tempos, this.speed);
  }
  async play() {
    if (!this.timeline?.notes.length)
      throw Error("Open a score containing playable notes first.");
    await this.activate();
    await this.prepare();
    if (this.position >= this.timeline.duration) this.position = 0;
    if (
      this.loop &&
      (this.position < this.loop[0] || this.position >= this.loop[1])
    )
      this.position = this.loop[0];
    this.origin = beatToSeconds(
      this.position,
      this.timeline.tempos,
      this.speed,
    );
    this.anchor = this.context!.currentTime + 0.04;
    this.scheduled.clear();
    this.clickBeat = -1;
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }
  pause() {
    if (this.playing) this.position = this.now();
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    for (const g of this.gains.values()) g.disconnect();
    this.gains.clear();
    this.scheduled.clear();
  }
  stop() {
    this.pause();
    this.position = 0;
  }
  seek(beat: number) {
    const was = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.timeline?.duration || 0, beat));
    if (was) void this.play().catch(console.error);
  }
  setSpeed(speed: number) {
    const was = this.playing;
    this.pause();
    this.speed = speed;
    if (was) void this.play().catch(console.error);
  }
  setVolume(value: number) {
    this.volume = value;
    if (this.master)
      this.master.gain.setTargetAtTime(value, this.context!.currentTime, 0.01);
  }
  private tick() {
    if (!this.playing || !this.timeline || !this.context) return;
    const beat = this.now();
    const end = this.loop?.[1] ?? this.timeline.duration;
    if (beat >= end) {
      if (this.loop) {
        this.seek(this.loop[0]);
      } else {
        this.pause();
        this.position = this.timeline.duration;
      }
      return;
    }
    const horizon = this.context.currentTime + 0.12;
    for (const n of this.timeline.notes) {
      const pitch = n.pitch + this.transpose;
      if (
        n.beat >= end ||
        n.beat + n.duration <= this.position ||
        !this.audible(n) ||
        pitch < 0 ||
        pitch > 127 ||
        this.scheduled.has(n.id)
      )
        continue;
      const when =
        this.anchor +
        beatToSeconds(
          Math.max(n.beat, this.position),
          this.timeline.tempos,
          this.speed,
        ) -
        this.origin;
      if (when > horizon) break;
      const until =
        this.anchor +
        beatToSeconds(
          Math.min(n.beat + n.duration, end),
          this.timeline.tempos,
          this.speed,
        ) -
        this.origin;
      if (until > this.context.currentTime)
        this.note(
          pitch,
          Math.max(when, this.context.currentTime),
          until - Math.max(when, this.context.currentTime),
          n.velocity,
          this.timeline.tracks.find((t) => t.id === n.track)?.drums,
        );
      this.scheduled.add(n.id);
    }
    if (this.metronome) {
      for (
        let b = Math.max(0, Math.ceil(this.position), this.clickBeat + 1);
        ;
        b++
      ) {
        if (b >= end) break;
        const when =
          this.anchor +
          beatToSeconds(b, this.timeline.tempos, this.speed) -
          this.origin;
        if (when > horizon) break;
        this.clickBeat = b;
        if (when >= this.context.currentTime) this.click(when, b % 4 === 0);
      }
    }
  }
  private track(source: AudioScheduledSourceNode, gain: GainNode) {
    this.sources.add(source);
    this.gains.set(source, gain);
    source.onended = () => {
      this.sources.delete(source);
      this.gains.delete(source);
      source.disconnect();
      gain.disconnect();
    };
  }
  note(
    pitch: number,
    when: number,
    duration: number,
    velocity = 0.7,
    drum = false,
  ) {
    if (!this.context || !this.master) return () => {};
    return scheduleVoice(
      this.context,
      this.master,
      this.instruments,
      pitch,
      when,
      duration,
      velocity,
      drum,
      (s, g) => this.track(s, g),
    );
  }
  private liveLoading?: Promise<void>;
  async touch(pitch: number, velocity = 0.8) {
    await this.activate();
    if (!Object.keys(this.instruments.bank).length) {
      this.liveLoading ??= this.instruments
        .load(this.instruments.program)
        .finally(() => (this.liveLoading = undefined));
      await this.liveLoading;
    }
    await this.instruments.prepare(this.context!, [pitch]);
    return this.note(pitch, this.context!.currentTime, 60, velocity);
  }
  private click(when: number, accent: boolean) {
    const o = this.context!.createOscillator(),
      g = this.context!.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.12, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    o.connect(g).connect(this.master!);
    o.start(when);
    o.stop(when + 0.05);
    this.track(o, g);
  }
  async wav() {
    if (!this.timeline) throw Error("No score");
    const seconds =
      beatToSeconds(this.timeline.duration, this.timeline.tempos, this.speed) +
      2;
    const rate = 22050;
    const bytes = seconds * rate * 4;
    const estimate = await navigator.storage?.estimate?.();
    void estimate;
    if (bytes > 128 * 1024 * 1024)
      throw Error(
        "This score needs more than the mobile WAV memory budget. Export MIDI or MusicXML instead.",
      );
    const c = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
    const g = c.createGain();
    g.gain.value = this.volume;
    g.connect(c.destination);
    await this.instruments.prepare(
      c,
      this.timeline.notes.map((n) => n.pitch + this.transpose),
    );
    for (const n of this.timeline.notes) {
      const p = n.pitch + this.transpose;
      if (p < 0 || p > 127 || !this.audible(n)) continue;
      const start = beatToSeconds(n.beat, this.timeline.tempos, this.speed);
      const dur =
        beatToSeconds(n.beat + n.duration, this.timeline.tempos, this.speed) -
        start;
      scheduleVoice(
        c,
        g,
        this.instruments,
        p,
        start,
        dur,
        n.velocity,
        this.timeline.tracks.find((t) => t.id === n.track)?.drums,
      );
    }
    const buffer = await c.startRendering();
    return encodeWav(buffer);
  }
}
function scheduleVoice(
  ctx: BaseAudioContext,
  output: AudioNode,
  bank: Instruments,
  pitch: number,
  when: number,
  duration: number,
  velocity: number,
  drum = false,
  track?: (s: AudioScheduledSourceNode, g: GainNode) => void,
) {
  const gain = ctx.createGain();
  gain.connect(output);
  const release = 0.07;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(velocity * 0.6, when + 0.006);
  gain.gain.setValueAtTime(velocity * 0.6, when + Math.max(0.007, duration));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + release);
  let source: AudioScheduledSourceNode;
  if (drum) {
    const osc = ctx.createOscillator();
    osc.type = pitch < 45 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(pitch < 45 ? 150 : 600, when);
    osc.frequency.exponentialRampToValueAtTime(
      pitch < 45 ? 45 : 180,
      when + 0.12,
    );
    source = osc;
  } else {
    const buf = bank.buffers.get(pitch);
    if (!buf) {
      gain.disconnect();
      return () => {};
    }
    const sample = ctx.createBufferSource();
    sample.buffer = buf;
    sample.playbackRate.value = 2 ** ((pitch - bank.samplePitch(pitch)) / 12);
    source = sample;
  }
  source.connect(gain);
  source.start(when);
  source.stop(when + duration + release + 0.01);
  track?.(source, gain);
  if (!track)
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  return () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, 0.015);
    try {
      source.stop(now + 0.08);
    } catch {}
  };
}
export function encodeWav(buffer: AudioBuffer) {
  const samples = buffer.getChannelData(0),
    view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) =>
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true),
  );
  return new Blob([view.buffer], { type: "audio/wav" });
}
