// Original CC0 four-note A-minor test recording, synthesized without a sound bank.
export function audioFixture() {
  const rate = 22050,
    seconds = 5,
    data = Buffer.alloc(44 + rate * seconds * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(rate * seconds * 2, 40);
  const pitches = [57, 60, 64, 69];
  for (let i = 0; i < rate * seconds; i++) {
    const t = i / rate,
      j = Math.floor(t),
      age = t - j;
    let x = 0;
    if (j < 4) {
      const f = 440 * 2 ** ((pitches[j] - 69) / 12);
      x =
        0.45 *
        Math.exp(-age * 3) *
        Math.min(1, age * 150) *
        (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, x)) * 32767),
      44 + i * 2,
    );
  }
  return data;
}
