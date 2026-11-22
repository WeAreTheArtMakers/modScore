import { estimateAudioTempo, type AudioProfile } from "./audio-analysis";
import { assetPath } from "./paths";
export async function transcribeAudio(
  file: Blob,
  options: {
    seconds: number;
    signal?: AbortSignal;
    progress?: (value: number) => void;
    start?: number;
    profile?: AudioProfile;
    onTempo?: (bpm: number) => void;
  },
) {
  if (file.size > 40 * 1024 * 1024)
    throw Error("Choose an audio file smaller than 40 MB.");
  if (!(options.seconds > 0 && options.seconds <= 180))
    throw Error("Choose up to 180 seconds of audio.");
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Transcription cancelled", "AbortError");
  };
  check();
  // Decode locally, then retain only the bounded excerpt for the worker.
  const context = new AudioContext();
  let samples: Float32Array;
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    check();
    const start = options.start ?? 0;
    if (!Number.isFinite(start) || start < 0 || start >= buffer.duration)
      throw Error("Choose a start time within the recording.");
    const seconds = Math.min(options.seconds, buffer.duration - start);
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(seconds * 22050)),
      22050,
    );
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0, start);
    samples = (await offline.startRendering()).getChannelData(0).slice();
  } finally {
    await context.close();
  }
  check();
  options.onTempo?.(estimateAudioTempo(samples));
  const worker = new Worker(new URL("./audio-worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<
    {
      pitchMidi: number;
      startTimeSeconds: number;
      durationSeconds: number;
      amplitude: number;
    }[]
  >((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Transcription cancelled", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      cleanup();
      reject(Error(e.message || "Audio worker failed"));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") options.progress?.(data.value);
      if (data.type === "result") {
        cleanup();
        resolve(data.notes);
      }
      if (data.type === "error") {
        cleanup();
        reject(Error(data.message));
      }
    };
    worker.postMessage(
      {
        samples: samples.buffer,
        profile: options.profile || "piano",
        runtimeUrl: new URL(
          assetPath("recognition/lib/onnxruntime-web@1.30.0/dist/"),
          location.origin,
        ).href,
        modelUrl: new URL(assetPath("audio-pitch/nmp.onnx"), location.origin)
          .href,
      },
      [samples.buffer],
    );
  });
}
