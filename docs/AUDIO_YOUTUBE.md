# Audio and YouTube → piano, MIDI and MusicXML

modScore 0.5 runs Spotify Basic Pitch locally in a dedicated WebAssembly Worker. There is no paid transcription API, account or subscription. Audio decoding, note extraction, notation and MIDI export stay on your computer. The first use loads the bundled 230 KB model plus the shared ONNX runtime.

## Use an audio file — no helper needed

1. Open **Audio & YouTube** in the app.
2. Choose a WAV, MP3, M4A, OGG, WebM or other audio file your browser can decode (maximum 40 MB).
3. Give the score a title, set an approximate BPM and choose 8, 16, 32 or 64 bars.
4. Choose **Create piano score**. Keep the app open while the progress runs; **Cancel** terminates the Worker.
5. Play the score with the piano, use **Original** to hear the source recording, then correct notes in **Review notes**. Choose **Export → MIDI (.mid)** or MusicXML to save the result.

## Use a YouTube link — optional local helper

A static GitHub Pages application cannot directly read YouTube's audio streams because of browser cross-origin restrictions. The helper downloads an accessible public video to your computer; the browser then performs transcription locally. It is a separate optional process, not a remote modScore service.

1. [Download and set up modScore](../README.md#run-on-your-computer). Node.js 22.23+ is required for the helper.
2. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation), or install [uv](https://docs.astral.sh/uv/getting-started/installation/). If `yt-dlp` is absent, the helper uses `uvx` to run the pinned `yt-dlp==2026.10.26` package. This first download requires internet. Follow yt-dlp's instructions for any JavaScript runtime required by YouTube; keep the downloader current if the site changes.
3. In a terminal in the modScore project directory, run:

   ```sh
   npm run youtube:helper
   ```

4. Keep that terminal open. Open the [published app](https://wearetheartmakers.github.io/modScore/) or `http://localhost:5173`, select **Audio & YouTube** and paste an HTTPS YouTube link. Chrome may request **Local network access**; allow it for this app to reach your helper.
5. Set BPM and score length, then choose **Create piano score**. Use **Export → MIDI (.mid)** after reviewing the result. Stop the helper with **Ctrl+C** when finished.

The helper binds only to `127.0.0.1:8790`, accepts the official app and documented localhost origins, validates YouTube hosts and video IDs, and invokes the downloader with argument arrays rather than a shell. It allows one job at a time, with a three-minute download timeout, ten-minute source-video limit and 40 MB audio limit. Temporary downloaded files are removed after delivery/cancellation. The original audio is stored in the browser project so you can compare it and include it in your own backup.

Use music you own or have permission to process. The helper does not use cookies, login credentials, access-control bypasses or DRM removal. Some videos, regions or networks will not work. If the browser blocks the local connection or a public download fails, use an authorized local audio file. YouTube access requires internet; already saved scores and local-file transcription can work offline after **Settings → Prepare offline use** completes.

## What the generated score means

Basic Pitch estimates note pitches, attacks, releases and amplitudes. It is most effective on a clean single-instrument recording. Drums, vocals, reverb and dense mixed music can create missing or extra notes. This is not a source-separation or guaranteed full-orchestra transcription system.

- BPM is supplied by the user; the notation uses 4/4 and rounds onsets/releases to a 1/8-quarter-beat grid (32nd notes). This can simplify swing, rubato and tuplets. A deliberately wrong BPM produces wrong written rhythm.
- The first detected onset is placed at the beginning of the score. Up to 180 seconds are analyzed; requested bars bound the generated score. A short recording can leave trailing rests.
- Notes below MIDI 60 are placed on the lower piano staff; higher notes on the upper staff. This is a pitch split, not inferred physical left/right hand fingering.
- Equal note intervals form chords; overlapping releases use independent voices. Sustains are tied only where notation values or barlines require it. Tempo, velocity, pitch and duration are included in MIDI export.
- Automatic transcriptions remain marked **Review required**. Structural checks cannot prove musical accuracy. Compare with the original recording before relying on the notes.

## Included demos

First launch opens **Basic Music — Baran Gulesen**, with the composer's permission. The 32-bar demo derives from the actual public recording, with a 9.525-second lead-in trimmed and an estimated 112 BPM. It contains 566 detected/quantized note events; it is not a composer-approved engraved score. The original recording is not distributed with the app.

**Ode to Joy — Ludwig van Beethoven** is a second 32-bar piano study: the public-domain 16-bar melody is played twice with an original accompaniment and an octave variation. It uses 96 BPM. Both demos are editable and available from the home screen; existing libraries are preserved and the welcome demo is opened automatically only once. Playback always requires a user gesture.

A guided demo shows synchronized notation/falling notes/keys, then looping bars 1–4, metronome and keyboard controls. Reduced-motion preferences disable decorative animation. MusicXML and MIDI files are in [`public/demos`](../public/demos); read their [music rights](../public/demos/LICENSE.md).

## Model and corresponding source

- Model: [Spotify basic-pitch](https://github.com/spotify/basic-pitch), revision `fa5997af0a8210982619003269994a1be25eddf3`, `basic_pitch/saved_models/icassp_2022/nmp.onnx`.
- Note creation: [Spotify basic-pitch-ts](https://github.com/spotify/basic-pitch-ts), `@spotify/basic-pitch@1.0.1`, revision `16d4c6a68e2c070726ba7c26a64c13eab4a434c4`.
- Both are Apache-2.0. [AUDIO.lock.json](AUDIO.lock.json) pins model and modified note-creation hashes. Original source and licenses are retained under `vendor/basic-pitch`. modScore removes the Node MIDI-writing dependency and its helper from the vendored note-creation module; note extraction is retained. modScore's own MIDI export uses the existing @tonejs/midi integration.
- Inference reuses ONNX Runtime Web 1.30.0, one CPU WASM thread. No TensorFlow.js runtime or cloud inference is required.
