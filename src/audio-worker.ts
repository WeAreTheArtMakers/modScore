/// <reference lib="webworker" />
import {
  outputToNotesPoly,
  noteFramesToTime,
} from "../vendor/basic-pitch/toMidi.js";
self.onmessage = async ({ data }) => {
  let session: any;
  try {
    const ort: any = await import(
      /* @vite-ignore */ data.runtimeUrl + "ort.webgpu.min.mjs"
    );
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = data.runtimeUrl;
    session = await ort.InferenceSession.create(data.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    const audio = new Float32Array(data.samples),
      window = 43844,
      hop = 36164,
      pad = 3840;
    const total = Math.ceil((audio.length + pad) / hop),
      limit = Math.floor((audio.length * 86) / 22050);
    const frames: number[][] = [],
      onsets: number[][] = [];
    for (let i = 0; i < total && frames.length < limit; i++) {
      const input = new Float32Array(window),
        start = i * hop - pad;
      for (let j = 0; j < window; j++) {
        const k = start + j;
        if (k >= 0 && k < audio.length) input[j] = audio[k];
      }
      const result = await session.run(
        {
          "serving_default_input_2:0": new ort.Tensor("float32", input, [
            1,
            window,
            1,
          ]),
        },
        ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2"],
      );
      for (let row = 15; row < 157 && frames.length < limit; row++) {
        frames.push(
          Array.from(
            result["StatefulPartitionedCall:1"].data.subarray(
              row * 88,
              (row + 1) * 88,
            ),
          ),
        );
        onsets.push(
          Array.from(
            result["StatefulPartitionedCall:2"].data.subarray(
              row * 88,
              (row + 1) * 88,
            ),
          ),
        );
      }
      for (const tensor of Object.values(result) as any[]) tensor.dispose?.();
      self.postMessage({ type: "progress", value: (i + 1) / total });
    }
    const notes = noteFramesToTime(
      outputToNotesPoly(frames, onsets, 0.5, 0.3, 8, true, null, null, false),
    ).filter(
      (n: any) =>
        n.amplitude >= 0.25 && n.pitchMidi >= 21 && n.pitchMidi <= 108,
    );
    self.postMessage({ type: "result", notes });
  } catch (e) {
    self.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await session?.release();
  }
};
