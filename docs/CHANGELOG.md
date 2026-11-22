# Changelog

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

