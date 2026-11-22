# Audio and YouTube → piano, MIDI and MusicXML

modScore 0.6 runs Spotify Basic Pitch locally in a dedicated WebAssembly Worker. There is no paid transcription API, account or subscription. Audio decoding, note extraction, notation and MIDI export stay on your computer. The first use loads the bundled 230 KB model plus the shared ONNX runtime.

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

## Tune the transcription

Choose **Piano · balanced** for ordinary use. **Cleaner** suppresses weak/short detections and may omit real quiet/fast notes. **Detailed** retains faster passages but may add extra notes. Listen to the source preview before converting.

Suggested BPM comes from onset energy; turn its checkbox off to enter BPM yourself. Key is a duration-weighted suggestion or a manual choice, including **C minor · three flats**. The key affects spelling and leaves chromatic notes intact. Meter is selected explicitly (4/4, 3/4 or 6/8).

Under **Notation and recording excerpt**, choose 1/8, 1/16 (default) or 1/32 notation and a starting second. Optional chord suggestions label pitch groups without creating accompaniment or changing any pitches. They require review.

After conversion, **Export → Performance MIDI (.mid)** preserves detected timing before notation quantization/edits. **MIDI (.mid)** exports the current edited score; MusicXML preserves its notation. Both follow tempo/transpose export controls. Backups retain the original detected performance and audio. **Original** starts at the selected excerpt's first detected onset.

Basic Pitch is most effective on a clean single-instrument recording. Drums, vocals, reverb and dense mixes can create missing/extra notes. Up to 180 seconds are analyzed; the requested bars bound the output. A short recording can leave trailing rests. Staff allocation uses a middle-C pitch split for automatic audio, rather than claimed physical-hand inference. Overlapping releases use independent voices; notes are tied only where the chosen values/barlines require it. The model does not infer expressive articulations or authoritative harmony.

## Included demos

The **Basic Music — Baran Gulesen** demo now uses the composer's supplied notation reference: **C minor, three flats, 35 written measures / 136 quarter beats, 110 BPM and two traversals**. It replaces the inaccurate 0.5 audio-only demo. The source event data is reviewable in `public/demos/basic-music.score.json`. Earlier saved demo edits are preserved; open the corrected edition through its banner or home card. The original recording and screenshots are not bundled.

**Ode to Joy — Ludwig van Beethoven** remains a 32-bar / 96 BPM original piano study of a public-domain melody. Both demos require a user gesture to play. Their [musical rights](../public/demos/LICENSE.md) are separate from the application license.

Score/keyboard following defaults off. Manual scrolling releases follow; explicitly enabling **Follow score** moves only the notation pane, without moving the whole page. Simple forward/backward repeats of 2–8 traversals are played; endings, navigation and nested repeats need external review. See the [0.6 verification report](SCORE_FIDELITY_06_2026-11-23.md).

## Model and corresponding source

- Model: [Spotify basic-pitch](https://github.com/spotify/basic-pitch), revision `fa5997af0a8210982619003269994a1be25eddf3`, `basic_pitch/saved_models/icassp_2022/nmp.onnx`.
- Note creation: [Spotify basic-pitch-ts](https://github.com/spotify/basic-pitch-ts), `@spotify/basic-pitch@1.0.1`, revision `16d4c6a68e2c070726ba7c26a64c13eab4a434c4`.
- Both are Apache-2.0. [AUDIO.lock.json](AUDIO.lock.json) pins model and modified note-creation hashes. Original source and licenses are retained under `vendor/basic-pitch`. modScore removes the Node MIDI-writing dependency and its helper from the vendored note-creation module; note extraction is retained. modScore's own MIDI export uses the existing @tonejs/midi integration.
- Inference reuses ONNX Runtime Web 1.30.0, one CPU WASM thread. No TensorFlow.js runtime or cloud inference is required.
