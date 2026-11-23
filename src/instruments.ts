import { assetPath } from "./paths";
import names from "./instrument-names.json";
export { names as instrumentNames };
const REV = "044fab8e1456bfafc5776e86dfd6bb8697149aef";
const CACHE = "modscore-instruments-v1";
const asciiNote = (pitch: number) =>
  ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][
    pitch % 12
  ] +
  (Math.floor(pitch / 12) - 1);
export class Instruments {
  program = 0;
  bank: Record<string, string> = {};
  buffers = new Map<number, AudioBuffer>();
  async load(program: number) {
    if (!Number.isInteger(program) || !names[program])
      throw Error("Invalid GM program");
    const name = names[program];
    const key = new URL(assetPath(`instruments/${name}.json`), location.origin).href;
    // Playback can still use the application cache or network if the dedicated
    // instrument cache is unavailable (for example, after storage eviction).
    const cache = await globalThis.caches?.open(CACHE).catch(() => undefined);
    let response = await cache?.match(key).catch(() => undefined);
    if (!response) {
      if (program === 0) {
        try {
          response = await fetch(key);
        } catch {
          throw Error("Piano samples could not be loaded. Reconnect and use Settings → Prepare offline use.");
        }
        if (!response.ok)
          throw Error("Piano samples could not be loaded. Reconnect and use Settings → Prepare offline use.");
      } else {
        const r = await fetch(
          `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/${REV}/FluidR3_GM/${name}-mp3.js`,
        );
        if (!r.ok)
          throw Error(
            "Instrument download failed. The bundled piano remains available.",
          );
        const text = await r.text();
        const marker = `MIDI.Soundfont.${name} =`;
        const start = text.indexOf(marker);
        if (start < 0) throw Error("Unexpected instrument format");
        const value = JSON.parse(
          text
            .slice(text.indexOf("{", start))
            .replace(/;\s*$/, "")
            .replace(/,\s*}/g, "}"),
        );
        response = new Response(JSON.stringify(value), {
          headers: { "Content-Type": "application/json" },
        });
      }
      await cache?.put(key, response.clone()).catch(() => {});
    }
    const bank = await response.json();
    if (!bank || typeof bank !== "object") throw Error("Invalid sample bank");
    this.bank = bank;
    this.program = program;
    this.buffers.clear();
    // Keep the bundled piano and only the current downloaded bank on disk.
    for (const req of (await cache?.keys().catch(() => [])) ?? [])
      if (req.url !== key && !req.url.endsWith("/acoustic_grand_piano.json"))
        await cache?.delete(req).catch(() => {});
  }
  async prepare(context: BaseAudioContext, pitches: number[]) {
    for (const pitch of new Set(pitches)) {
      if (pitch < 0 || pitch > 127 || this.buffers.has(pitch)) continue;
      let samplePitch = pitch;
      while (samplePitch < 21) samplePitch += 12;
      while (samplePitch > 108) samplePitch -= 12;
      const data = this.bank[asciiNote(samplePitch)];
      if (!data) throw Error(`Sample missing for MIDI ${pitch}`);
      const decoded = Uint8Array.from(atob(data.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      const buffer = await context.decodeAudioData(decoded.buffer);
      this.buffers.set(pitch, buffer);
    }
  }
  samplePitch(pitch: number) {
    let sample = pitch;
    while (sample < 21) sample += 12;
    while (sample > 108) sample -= 12;
    return sample;
  }
}
