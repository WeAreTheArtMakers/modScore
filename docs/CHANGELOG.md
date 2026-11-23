# Changelog

## 0.6.1 — held notes, reference engraving and classical repertoire

- Correct Basic Music adjacent-pitch artifacts in 13/27/28; retain pitch-specific ties (including the recurring G4/B4 and lower F3), rests and rhythmic segmentation. Restate effective clefs after mid-measure changes.
- Preserve earlier saved v1/v2 edits and offer reference v3 as a separate project.
- Add complete Bach BWV 772 and BWV 846 Prelude, and Mozart K.545 Allegro measures 1–12, with source PDFs, attribution, original encodings/MIDIs and SHA256 lock.
- Compare every source-demo pitch, onset and notated duration against independently supplied source MIDI; correct the Mozart source's bar-7 lower-chord C4.
- Add a demo chooser and source PDF links within the player. Existing Beethoven practice arrangement remains available.

## 0.6 — reference notation, audio controls and free browsing

- Replace the inaccurate Basic Music demo with a 35-bar C-minor/three-flat reference edition, explicit clefs, short ending and a played repeat; preserve earlier saved edits.
- Add Balanced/Cleaner/Detailed audio detection, key/BPM suggestions and overrides, meter/grid/start controls, source preview and chord suggestions.
- Keep detected performance in backups and export it separately from edited score MIDI.
- Play bounded simple repeats and explicit release/accent articulations; encode MIDI key signatures correctly with the pinned underlying codec.
- Default follow off, release it on manual browsing and scroll only the notation pane, without residual smooth-scroll animation.

## 0.5 — demos, local audio transcription and practice

- Composer-authorized Basic Music first-run demo and an original 32-bar Ode to Joy piano study, with explicit music rights and MIDI/MusicXML assets.
- Guided score/piano/roll tour with reduced-motion support; existing libraries and demo edits preserved.
- Free local Basic Pitch audio transcription and optional loopback-only YouTube downloader; no cloud or paid API.
- Continuous loop-clock scheduling, two-click measure-range selection and cancellation of stale Play requests.
- Meter-aware accented metronome, independent volume and pulse indicator.
- Compact keyboard map and octave controls; original recording playback and source metadata in saved audio projects.

## 0.4 — piano layout, image verification and rhythm corrections

- Preserve grand staffs with lower treble/C clefs.
- Recover clipped staff extents using five-line image evidence; review barline counts and report truncation.
- Preserve tuplets on pitch edits and reflow the edited voice on duration changes.
- Add short-note/triplet presets, source excerpts, source-page mapping and safe re-recognition copies.
- Retain corresponding Rust source, modified binary integrity and regression fixtures.

## 0.3 — GitHub distribution

- GitHub Pages subpath support for the PWA, recognition workers, PDF resources, samples and offline preparation.
- Branded introduction and setup guide at `about/`.
- Verified cross-platform Node setup and Pages production verification.
- Public repository documentation, contributing and issue templates.

## 0.2 — recognition review and update fixes

The current release adds responsive three-/two-measure engraving with auto-beaming, an original/reconstruction Compare view, structural timing auditing, saved numeric tempo/instruction corrections, and explicit tie join/remove tools. Automatic engraving does not repair missing recognized ties or recover omitted lyrics/chord text. Update prompts are managed by one lifecycle controller; saved scores are preserved before explicit activation. Missing-host-model HTML responses now fail immediately rather than retrying as corrupt downloads. See [the November 22 review](docs/REVIEW_2026-11-22.md) for findings on the user-provided image, console attribution and next priorities.

## 0.2.1 — PDF compatibility and import validation

PDF import uses the pinned PDF.js 6.4.299 **legacy** main module and matching legacy Worker, with bundled core-js polyfills. Standard font, CMap and WASM resources are served locally and included in offline preparation. A fresh source checkout must run `npm run assets:pdf` before `npm run assets`/`npm run build`; the download verifies npm package SHA-512 and the build verifies each selected asset SHA-256 using `docs/PDFJS.lock.json`. This covers missing modern Map/WeakMap methods without downgrading PDF.js.

Import validates content headers before changing scan state, accepts extensionless recognized files, rejects incompatible mixed batches, releases PDF resources on cancellation/error, preserves completed pages and original files on partial failure, and resets file inputs after failures. Imported project backups now preserve completed recognition checkpoints. As of 0.3, password-protected PDFs have a local password dialog; compressed MusicXML remains unsupported.

## 0.3 — page layout recovery and live piano input

Different OMR part counts no longer prevent combining a scan: mismatching pages use named page-specific tracks, retain every encoded note and play in page order with a review notice. Reopen saved failed scans and choose Recognize locally to reuse completed checkpoints. This does not infer missing notes or guarantee cross-page part identity.

In Virtual piano, enable audio and play with A W S E D F T G Y H U J K; Z/X change octave. Settings contains MIDI input and permitted audio output selection. MIDI requires browser permission and Web MIDI support (Chrome/Edge on a secure origin); unsupported output selection uses the OS default audio interface. The selected instrument is shared by mouse/touch, typing and MIDI. Physical devices were not tested here.

PDF import now offers page ranges/thumbnails, local password entry and automatically saved completed-page drafts. See [the 0.3 report](docs/MULTIPAGE_LIVE_2026-11-22.md) for exact behavior, test evidence and remaining limits.

