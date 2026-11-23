interface ScanSettings {
  rotation: number;
  levels?: { paper: number; gain: number };
}

function luminance(data: Uint8ClampedArray, i: number) {
  return (54 * data[i] + 183 * data[i + 1] + 19 * data[i + 2]) >> 8;
}

/** Look for five equally spaced dark lines in multiple horizontal projections. */
function staffAngle(pixels: Uint8Array, width: number, height: number, dark: number) {
  const points: [number, number][] = [];
  const margin = Math.round(width * 0.07);
  for (let y = 3; y < height - 3; y++) {
    for (let x = margin; x < width - margin; x += 2) {
      if (pixels[y * width + x] <= dark) points.push([x - width / 2, y]);
    }
  }

  const rows = new Uint16Array(height + 2 * margin + width);
  const center = margin + Math.round(width / 2);
  const minimum = Math.max(9, width * 0.12);
  let bestAngle = 0, best = 0, level = 0;
  for (let angle = -12; angle <= 12; angle += 0.5) {
    rows.fill(0);
    const slope = Math.tan(angle * Math.PI / 180);
    for (const [x, y] of points) rows[Math.round(y - slope * x) + center]++;
    let score = 0;
    for (let y = 1; y < rows.length - 1; y++) {
      if (rows[y] < minimum) continue;
      for (let spacing = 3; spacing <= 28 && y + 4 * spacing < rows.length - 1; spacing++) {
        let strength = rows[y];
        for (let line = 1; line <= 4 && strength >= minimum; line++) {
          const row = y + line * spacing;
          strength = Math.min(strength, Math.max(rows[row - 1], rows[row], rows[row + 1]));
        }
        score = Math.max(score, strength);
      }
    }
    if (angle === 0) level = score;
    if (score > best) {
      best = score;
      bestAngle = angle;
    }
  }
  return Math.abs(bestAngle) >= 1 && best > Math.max(minimum, level * 1.35) ? bestAngle : 0;
}

export function inspectScan(bitmap: ImageBitmap): ScanSettings {
  const sample = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const width = sample.width = Math.max(1, Math.round(bitmap.width * scale));
  const height = sample.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  sample.width = sample.height = 0;
  const histogram = new Uint32Array(256);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const gray = luminance(image.data, 4 * i);
    pixels[i] = gray;
    histogram[gray]++;
  }
  const percentile = (fraction: number) => {
    let count = 0;
    for (let level = 0; level < histogram.length; level++) {
      count += histogram[level];
      if (count >= fraction * pixels.length) return level;
    }
    return 255;
  };
  const ink = percentile(0.006), paper = percentile(0.98);
  const contrast = paper - ink;
  if (contrast < 12 || width < 200) return { rotation: 0 };
  return {
    rotation: -staffAngle(pixels, width, height, ink + contrast * 0.54),
    levels: contrast < 145 && paper - percentile(0.85) < 24 && ink > 70
      ? { paper, gain: Math.min(5, 211 / contrast) }
      : undefined,
  };
}

export function restoreScanContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  levels: NonNullable<ScanSettings["levels"]>,
) {
  // Process stripes so the page-sized canvas does not require a second full-size pixel buffer.
  for (let y = 0; y < height; y += 128) {
    const stripe = ctx.getImageData(0, y, width, Math.min(height - y, 128));
    const { data } = stripe;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 249 + (luminance(data, i) - levels.paper) * levels.gain;
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(stripe, 0, y);
  }
}
