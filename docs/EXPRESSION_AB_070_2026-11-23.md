# modScore 0.7.0 — source comparison and expressive playback

Reviewed 2026-11-23. This report supersedes the 0.6.1 report for Basic Music measures 13–14 and ornament playback. Earlier reports remain historical evidence.

## Basic Music: measures 13 and 14

The composer's supplied notation was checked against a fresh download of [Basic Music — Baran Gulesen](https://www.youtube.com/watch?v=AN0wGBUxkIk). Decoding the fresh recording produced 15,127,894 signed 16-bit samples identical to the previously analysed PCM. The source-score alignment is 9.525317 seconds at 110 BPM: measure 13 begins at 35.707135 seconds, measure 14 at 37.888953, and measure 15 at 40.070772.

The unsupported Ab3–G3–Ab3 movement in the second half of measure 13's lower staff is replaced by held F3. Both hands in measures 13 and 14 now encode recording-based releases and overlaps, using MusicXML's `note release` attribute. Written rhythmic positions, the right-hand turn, rests, ties and the three-flat signature are retained. The note release estimates are rounded to 1/16 of a quarter beat; they are a reviewed interpretation of the recording, not a claim of sample-perfect automatic transcription.

Only measures 13 and 14 differ from the v3 principal note data. The remaining 33 written measures, including 27/28, are unchanged. Their recursively key-sorted JSON SHA-256 is `61211cf2a1da2cf2fb40e6c5bc074d855bae7a58a8fdc3b0d6b667d9469bb4ce`. [Machine-readable evidence and changed events](BASIC_MUSIC_13_14_070.json).

The resulting v4 score has 614 principal attacks per traversal, 35 written measures and 136 quarter beats. Its full repeat contains 1,228 attacks and 272 quarter beats. Overlapping repeated pitches retain independent MIDI lanes. Earlier saved editions are preserved and offer an explicit action to open the corrected edition.

## Same-point source/piano listening

The Source ↔ Piano panel uses one native audio player. A and B restart at the same stored comparison anchor, stopping the other player. “Compare from here” captures either the chosen recording position or the piano's written beat. “Review measures 13–14” jumps to measure 13 without enabling ongoing automatic scrolling. Source offset and recording BPM can be calibrated independently of edited score tempo, and survive backups. Attached recordings are retained locally; the authorized Basic Music MP3 also works offline after caching.

Source listener cleanup, pending metadata cancellation, repeated switching and project changes are handled explicitly. A generation guard prevents an older asynchronous play request from starting after a newer action. Changing playback speed updates the recording rate. Offset/BPM alignment is linear: expressive rubato recordings may require manual recalibration. A/B provides a common start position; it does not claim continuous automatic audio-score tracking.

## Shared performance layer

Written principal notes remain editable and unchanged. A separate performance timeline drives sampled piano, active piano keys, MIDI and WAV consistently:

- Trills use diatonic neighbours from the local key/accidentals; explicit ornament accidental marks and start-note instructions take precedence. Auto selects a Baroque upper-note default for Bach and a main-note default otherwise.
- Lower and upper mordents use three or five attacks, then sustain the principal note. Explicit starting neighbours are respected.
- Chord arpeggios respect up/down direction and bounded roll time; a single marked chord member can identify the whole chord.
- Note and rest fermatas stretch the common clock, including the other staff and repeated passages. Their strength is adjustable; written beat locations remain intact.
- Literal mode disables these embellishments. The raw detected-performance MIDI remains literal.

These are configurable performance conventions. Historical editions and performers differ. Barline fermatas, compound ornament combinations and full grace-note realization are outside this implementation; do not treat it as a definitive historical interpretation.

## Verification

- Full desktop/mobile Chrome suite: **138 passed, 4 intentional skips** (142 cases). Includes real sampled WAV rendering, source/piano switching, release durations, unchanged-measure hash, MIDI realization, note/rest fermatas, repeat clocks, source alignment backups and earlier-demo migration.
- Production root and GitHub Pages subpath checks cover the built app, sampled playback, PDF page selection, local/offline audio transcription, offline score/PDF opening, same-point source listening and expressive Bach MIDI. Both passed with zero browser errors and zero missing assets. The Pages run also performed actual optical recognition. [Production results](validation/release-070-production.json).
- Physical MIDI devices, physical audio interfaces and real iOS devices were not part of these browser checks.
