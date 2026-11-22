# 0.5 practice and audio verification — 2026-11-22

> Historical 0.5 report: its automatic Basic Music edition was superseded by the composer-reference 0.6 edition. See `SCORE_FIDELITY_06_2026-11-23.md`.

## Scope

This release adds a composer-authorized Basic Music demo, a Beethoven-themed piano study, guided practice controls and local audio transcription. It preserves the 0.4 optical music recognition pipeline. It does not claim that dense printed-score OMR or mixed-audio transcription has become error-free.

## Demos and rights

- **Basic Music — Baran Gulesen:** actual Basic Pitch inference from the composer's public YouTube recording, used with explicit permission. A 9.525317-second lead-in is trimmed. Estimated 112 BPM, 32 bars / 128 quarter beats, 566 quantized note events. A 90-second private inference run supplied the opening passage; raw audio and private analysis files are excluded from public source.
- **Ode to Joy — Ludwig van Beethoven:** 32 bars / 128 quarter beats, 96 BPM, 348 note events. Public-domain 16-bar melody reference from Mutopia, transposed to C and repeated with an original accompaniment/octave variation. This is a piano study, not a claim to reproduce 32 bars of Beethoven's original orchestral score.
- Both bundled MusicXML files are parsed by the actual shared timeline and exported to Standard MIDI. Composition/arrangement rights are documented separately in `public/demos/LICENSE.md`.

First launch opens Basic Music only for an empty library without the welcome preference. No audio autoplays. Saved demo edits are reused; reload/deletion do not silently add a new copy. Both demos remain accessible on the home screen.

## Actual audio evidence

A real Chrome browser processed the first 15 seconds of the composer's WAV through the browser Worker / CPU ONNX model: **51 note events**, first detected onset **9.525317 seconds**. The resulting eight-bar score parsed and rendered, with an explicit automatic-transcription warning.

The new **Audio & YouTube** UI also received the real YouTube link through the optional loopback helper, downloaded an accessible public audio stream without credentials or access-control bypasses, analyzed the bounded excerpt and produced an **eight-bar, 127-event** score. Its source audio and canonical YouTube reference survived in IndexedDB; sampled playback and piano highlighting worked. No browser page errors were recorded. The helper returned HTTP 403 for an unapproved web origin and HTTP 400 for an unsupported source URL.

A separate original synthesized A-minor arpeggio (A3, C4, E4, A4) exercises actual audio decoding, resampling, model inference, engraving, source-audio playback and MIDI download in automated tests. The four expected pitches are present. Model outputs are not mocked. This small example is not a broad accuracy benchmark.

## Timing and notation checks

- Pulse positions and accents checked for 3/4, 6/8 and 4/4, including tempo changes.
- An absolute AudioContext loop clock checked over 10,000 turns: next-cycle start equals prior-cycle end without accumulated drift.
- The real timer scheduler tested over at least nine short loop turns. Exactly one preparation; scheduled attacks retain their 0.1-second interval across boundaries.
- Stop during pending preparation and overlapping Play requests tested; only the latest active request schedules notes.
- Metronome and instrument gains tested independently at 0.17 and 0.8. Metronome volume persists in the browser.
- Piano MusicXML round trip preserves independent overlapping releases, chord intervals, repeated attacks, cross-bar ties and velocity. MIDI export/reimport preserves the test note count and sustained bass duration.
- Overlapping intervals are allocated to independent notation voices. They do not force all other sustains to split at every attack/release. Inactive auxiliary voices omit whole-bar rest clutter; auxiliary gap rests can be hidden while retaining timing.
- Two-click range selection and numeric boundaries, metronome controls, octave buttons and view changes checked on desktop and 375-pixel mobile emulation.

## Visual and platform limits

The Songscription public Basic Music page was inspected as a workflow reference: original/transcribed playback, notation/roll and editing/export affordances. No paid score export or implementation was copied. modScore uses its own UI and locally executed open-source inference.

Desktop and mobile-width screenshots show no page-wide horizontal overflow at 375 pixels. Keyboard/note-roll containers intentionally scroll. Decorative animations respect reduced-motion preferences. Mobile emulation is not a physical iPhone/Android performance test; physical MIDI and audio interfaces remain unverified. Tempo, meter, hand allocation and automatic notes require review as described in `AUDIO_YOUTUBE.md` and `LIMITATIONS.md`.

## Automated results

The complete desktop Chrome and mobile-width suite passed **99 tests**, with **3 intentional mobile duplicate skips**. Two additional guided-tour tests passed on desktop/mobile emulation: the tour automatically enables the loop, then metronome, then opens keyboard help; reduced-motion disables equalizer animation. Thus **101 passed / 3 skipped** across the full suite and additional guide checks.

The final focused notation/audio/practice run passed **35 tests / 1 duplicate mobile inference skip**, including the lazy-loaded audio module and full guided tour. Production `/modScore/` verification passed without cross-origin-isolation headers: both 32-bar demos, real OMR, PDF page selection, saved drafts, sampled playback and offline reload. An additional network-disabled production run created and played a new audio transcription using only cached model/runtime assets. Both production runs recorded **zero page errors and zero missing asset responses**. The final helper check returned a real 2,550,243-byte `audio/mp4` stream for Basic Music, HTTP 409 for concurrent work, 403 for an unapproved origin and 400 for an unsupported URL.
