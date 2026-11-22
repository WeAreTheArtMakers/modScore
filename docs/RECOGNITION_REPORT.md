# Recognition, performance and verification report

Date: 2026-11-20. Application: modScore 0.1. This report distinguishes measured results from target-device requirements.

## Real recognition smoke test

Input: an **actual 2200×892 PNG raster of printed notation**, rendered by OSMD from the original CC0 study in `public/fixtures/grand-staff.musicxml`. The test is not a photograph of physical paper. The recognizer receives only PNG bytes, not the reference XML. No mock recognition API, predetermined note response or substituted model output is used.

The four-measure piano study contains treble and bass clefs, a two-note left-hand chord with simultaneous right-hand notation, two staff/voice streams, rests, dotted notes, a sharp followed by a natural, and a tied note. After contiguous ties are merged, the reference has **19 sustained note events**. This is a small clean engraving smoke test; it does not establish general piano-score, camera-photo, dense-polyphony or repertoire accuracy.

Actual evidence is retained in `docs/validation/`:

- `input.png`: exact raster input.
- `recognized.musicxml`: real MusicXML output from the models.
- `metrics.json`: reference/output event comparison and measured environment.
- `log.json`: worker model/staff timing logs.
- `upstream-artifacts.json`: OMR artifact Git blob hashes verified against the pinned upstream Git tree.
- `browser-tests.txt`: final desktop/mobile browser suite results.
- `offline-result.json` and `offline-player.png`: production offline integration evidence.

### Result

| Measurement | Observed |
| --- | --- |
| Reference sustained events | 19 |
| Recognized sustained events | 19 |
| Exact pitch + onset + duration + staff matches | 19 |
| Exact event precision / recall on this image | 19/19 each |
| Extra or missing events | 0 on this image |
| Printed tempo | 96 BPM |
| Recognized numeric tempo | Absent; player explicitly warns and defaults to 120 BPM |

Voice numeric IDs may differ between source and output and are not used as an exact-match key. Staff identity, pitch, onset and duration are compared. Key signatures are represented in XML, while pitches and accidentals follow explicit chromatic pitch data. The standalone smoke test does not include alto-clef recognition or tuplets; those are covered only by XML-parser tests, not by an OMR accuracy claim.

## Measured environment and runtime

- Mac with Apple M1 Pro, arm64, 16 GiB memory.
- Desktop Google Chrome `157.0.8103.79`.
- ONNX Runtime Web `1.30.0`, forced CPU WASM, **one thread**, no WebGPU.
- Existing Partsong/homr-rs SIMD pipeline, relaxed-SIMD decoder selected after its runtime probe.
- Two-step processing: segmentation/layout, release its ONNX session, then encoder/decoder recognition.
- `ios: true` activates an upstream resource-disposal path; it is **not** iPhone hardware or Safari emulation.
- Assets were served over loopback. WAN first-download duration is not measured.

| Stage | Measured time |
| --- | --- |
| Staff layout, including segmentation/setup | 9,838 ms |
| Semantic recognition after layout | 2,751 ms |
| Total worker initialization + both passes | 13,537 ms |

These are one recorded run, not a statistically stable benchmark. Concurrent browser tests later took roughly 15–26 seconds for the UI recognition workflow under varying host load. Earlier direct one-pass CPU runs also produced XML; an initial four-thread run took 4,861 ms. That faster result is not the shipped one-thread mobile-oriented configuration.

### Memory accounting

At recognition completion, the exposed Rust page-reader WASM memory was **39,452,672 bytes**, and the separate decoder WASM memory was **106,364,928 bytes**. These are linear-memory allocation sizes, a **lower bound** rather than total/peak RAM. ONNX Runtime's allocation arena, temporary tensors, source/model/cache blobs, JPEG/PNG decode buffers, canvases, compiled code and browser process overhead are additional and were not captured as a peak-RSS measurement.

Model downloads total **157,528,486 bytes**. CPU segmentation processes one 320×320 tile at a time; semantic inference processes one staff group at a time. The segmentation session is released before the encoder is created. The Worker is terminated after completion/cancellation. None of these measures establishes that a physical iPhone XS can stay below Safari's termination threshold on full-size repertoire pages.

## Browser/application checks

The final Playwright suite ran **13 tests in desktop Chrome and the same 13 in a 375×812 touch/mobile Chrome simulation: 26 passed**. It covers:

- Standard MIDI pitch conversion and explicit A0/C8 keyboard bounds.
- Grand-staff MusicXML, accidental/natural pitches, rests, chords, backup/forward and tie merging.
- Piecewise tempo integration/inversion, offset tempo changes, alto-clef XML, explicit tuplet durations.
- Corrections to pitch, duration and within-measure onset.
- MIDI event/tempo/polyphony round trip, including UTF-8 metadata handling.
- IndexedDB transaction completion and project backup/import identity separation.
- MusicXML import, actual sampled playback, key activation/release, pause/seek and MIDI file export.
- Library correction, rename/search/reload, dark/light and Turkish navigation.
- Actual image → real OMR → XML → audio → active piano keys, with no off-host requests in that test.
- Two-page PDF rasterization and editable scan pages.
- Multiple-page XML merge with event offsets preserved.

After the main suite, a focused desktop test recognized **two separate real PNG inputs sequentially**, combined them into **8 measures / 38 sustained notes**, and passed in 32.8 seconds. This exercises disposing/recreating the OMR Worker between pages to prevent a previous encoder session overlapping the next segmentation pass. Its log is `multipage-test.txt`. The mobile copy of this additional multipage scenario is explicitly skipped; the mobile profile already exercises single-page real inference.

The mobile Chrome run is a viewport/touch simulation on a Mac, **not Safari, an iOS simulator or physical iPhone testing**. The suite's note assertions are not a timing-jitter or acoustic latency measurement.

### Production offline integration

`node scripts/validate-offline.mjs` tests the built static package against Vite preview. A clean browser:

1. Activates the production service worker.
2. Recognizes the actual printed PNG and saves its score.
3. Prepares local application/recognition assets.
4. Disconnects the browser's network completely and reloads.
5. Opens the saved library score and plays actual cached piano samples with active key highlights.
6. Exports **441,044 bytes** of valid, non-silent PCM WAV locally.
7. Imports a new PNG and recognizes it using the real cached models while still offline.

The run completed without page errors. Its JSON records the application cache identity and elapsed milestones. This proves that the tested desktop build does not require an online recognition API after caching. It does not guarantee storage permanence or device compatibility.

An additional instrument integration check downloaded the actual FluidR3 **violin (GM program 40, zero-based)** bank from the pinned GitHub revision, played sampled notes, confirmed local bank caching, disconnected the network and played again. `instrument-result.json` records the successful result. This is an instrument-download smoke test; all 128 banks have not been individually auditioned.

`npm run build` passes TypeScript checking and writes the static app plus matching AGPL corresponding-source archive. `npm audit --omit=dev` reported zero known vulnerabilities in the installed application dependency tree at verification time. This audit is not a security guarantee.

## Unavailable / unperformed checks

- Playwright WebKit `27.2` executable `webkit-2388` was installed, but crashed at browser launch with macOS `Segmentation fault: 11` before opening a page. The application was not exercised by that engine; no Safari pass is claimed.
- No physical iPhone XS, iOS 18 Safari/Home Screen, Android or Windows device test was performed.
- No independent peak-RSS, battery, acoustic timing, camera/EXIF correctness or low-memory interruption benchmark on a target device was performed.
- No general OMR accuracy corpus, large polyphonic piano repertoire, photographed-paper stress suite, alto-clef OMR or tuplet OMR benchmark was run.
- No new quantized encoder or retraining was introduced without accuracy evidence. The decoder is the existing upstream quantized model implementation.
- OMR binaries were verified against upstream Git objects but not rebuilt here: the vendored Rust dependency declares Rust 1.98 while the available system compiler was 1.96. Rebuild requirements and exact sources are supplied.

See `LIMITATIONS.md` and `DEPLOYMENT.md` for remaining product gaps and the physical-device verification procedure.
