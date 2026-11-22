# 0.6 — notation fidelity, audio controls and free browsing

## What failed in 0.5

The 0.5 Basic Music demo used raw Basic Pitch detections and a fixed C-major/4/4 writer. It omitted the three-flat key signature, missed notes in the opening, produced excessive rhythmic fragmentation and stopped at an arbitrary 32 bars. Browser smoke tests established that a file could render/play; they did not establish musical fidelity. That edition is superseded.

## Basic Music reference edition

The composer supplied seven score screenshots. An optical draft was checked against their notation, corrected for short-note rhythm errors and reconstructed into reviewable data at `public/demos/basic-music.score.json`. The edition preserves:

- C minor, three flats; B naturals and other chromatic notes remain chromatic.
- The opening C4–F4–G4–F4–D4–B3–E♭4–F4–E♭4–C4 motif and its lower-octave accompaniment, with explicit durations.
- All 35 written measures, including the short closing measures, for **136 quarter beats** per traversal.
- Written treble/bass/upper-octave clef changes and explicit staff allocation, including lower-staff passages above middle C.
- Encoded chords, rests and ties. No articulations are invented from audio amplitude or duration noise.
- A bounded repeat: **272 performed quarter beats at 110 BPM**, approximately **148.36 seconds**, after the recording's lead-in. There are **657 sustained note events per traversal / 1,314 performed events**. Event counts are not accuracy percentages.

The first 0.5 ID remains intact if it exists in a user's library. Its banner offers the corrected v2 edition; opening it does not overwrite edits in the earlier copy. Existing 32-bar download URLs now provide corrected excerpts. The full edition uses `basic-music.musicxml` and `basic-music.mid`.

Rebuild the score and both MIDI assets with `node scripts/build-basic-demo.mjs`. It reads the public notation data and uses the same notation/MIDI writer as the app. Private screenshots, original audio and intermediate recognition files remain excluded from source archives.

## Audio module

- Balanced piano, Cleaner and Detailed profiles use explicit onset/frame/minimum-duration/amplitude thresholds. Same-pitch overlap handling retains stronger repeated attacks and truncates the preceding tail.
- BPM is an onset-energy suggestion with a guarded half-time correction. The user can turn it off and enter BPM. Meter is explicitly selected (4/4, 3/4 or 6/8).
- Key is suggested from duration-weighted pitch classes or selected manually. Key changes spelling; it does not force notes into a scale or erase legitimate chromaticism.
- The default notation grid is 1/16 notes; 1/8 and 1/32 are available. Performance MIDI is separate and retains detected timing before grid quantization. It is explicitly labeled as the original detection, while ordinary MIDI follows current score edits.
- Start time and an audio preview let the user inspect the recording excerpt. Saved projects/backups retain the detected performance and source start, and Original playback starts at that excerpt.
- Optional chord suggestions label supported pitch-class groups without adding, replacing or reharmonizing notes. They remain estimates.

### Single-recording comparison

The same cached model frames/onsets from the first 90 seconds of Basic Music were decoded with the old and new profiles. The first complete reference traversal is compared using equal pitch and onset within **80 ms**, aligned to the 9.525317-second lead-in at 110 BPM. No duration/velocity accuracy claim is made.

| Decoder | Detected events | Reference events | Matched pitch + onset |
| --- | ---: | ---: | ---: |
| 0.5 thresholds | 612 | 657 | 502 |
| 0.6 Balanced | 610 | 657 | 528 |
| 0.6 Cleaner | 453 | 657 | 421 |
| 0.6 Detailed | 948 | 657 | 567 |

Cleaner rejects more extras but omits real short/quiet notes. Detailed recovers more reference notes while introducing many extra detections. Balanced is the default. This is a calibration example using the supplied notation, not an independent repertoire-wide benchmark. The bundled reference demo is built from notation, not passed off as a newly perfect audio-model result.

## Musical playback and interchange

Simple, non-nested forward/backward repeats of 2–8 traversals expand into the performance timeline with a written-position map for cursor/seek. Repeats do not add duplicate written systems. Unsupported endings/navigation/nesting retain review warnings and written-order fallback; expansion is bounded.

Explicit staccato/staccatissimo release lengths and accent velocity affect sampled playback, WAV and MIDI without changing the written duration. Tied sustains retain their last segment's release. Clefs do not apply an extra octave transposition to explicit sounding pitch data.

A regression in `@tonejs/midi@2.0.28` writes the signed key-signature byte using the wrong index. modScore writes that standard meta event through the pinned underlying `midi-file@1.2.4` codec. Three flats/minor is verified as `sf=-3, mi=1`, and import restores the key and flat spelling. Time-signature metadata is exported as well.

## Browsing

Score and keyboard auto-positioning default off. Follow is an explicit preference. Cursor following scrolls the notation pane only, never `scrollIntoView` across the whole document. Manual wheel/touch/scrollbar browsing disables follow until the user enables it again. Pane scrolling is instantaneous at boundaries, so no leftover smooth-scroll animation pulls against manual scrolling. Scroll anchoring is disabled for the notation pane. Keyboard panning similarly releases auto-positioning.

See automated tests in `tests/score-fidelity.spec.ts`, the actual audio test in `tests/demos-audio.spec.ts` and the production/offline verifier. Physical MIDI/audio hardware and mobile-device performance remain unverified.

## Verification results

The complete desktop Chrome and mobile-width suite passed **113 tests**, with **3 intentional duplicate mobile skips**. Coverage includes the reference opening and repeat boundary, correct signed MIDI key bytes, chromatic/key/meter spelling, performed articulations, actual audio-model inference, original-performance MIDI download/backup, preserved earlier-demo edits, manual pane browsing, PDF import and actual optical recognition.

The final focused checks also passed for collapsing near attacks onto one notation position while retaining both original performance attacks, touch-release of keyboard auto-positioning and first-launch behavior. Production `/modScore/` verification passed without cross-origin isolation, including actual OMR, PDF selection, the 35-bar reference/repeat, signed MIDI key metadata, local audio inference and network-disabled new audio transcription. There were **zero page errors and zero missing asset responses**. All **270 distribution asset hashes** and corresponding-source exclusions passed. On the example recording, the tempo suggestion was **110.5 BPM** and the key suggestion **C minor / three flats**; the reference edition explicitly uses 110 BPM.
