# Recognition and rhythm review — 0.4.0

Date: 2026-11-22. Target: local browser processing and GitHub Pages distribution.

## Findings

A supplied eight-page piano PDF was visually inspected and all eight supplied MusicXML outputs were structurally analyzed. The first-page output could be reproduced with the same failure pattern: correct initial staff detection followed by five artificial parts. Partsong's post-decoding layout required a bass clef below a grand staff. A valid lower treble clef triggered a split into independent parts; later systems with different clefs were then combined as simultaneous instruments. This made sequential passages overlap in playback even where their individual pitches were recognized correctly.

The reader now accepts lower F, G and C clefs in an already detected grand staff. It does not pair arbitrary neighboring staves or assume all two-staff scores are piano.

A second issue affected crowded systems: segmentation sometimes found only the right-hand fragment of one staff. Grand-staff merging kept only grid columns common to both staves, cropping away valid opening notes. The reader now extends a fragmented grid only after verifying all five printed lines over the missing range (at least 85% sampled dark-line support) and light spaces between them (at least 55%). Plain white, black/noise-filled, hidden and ambiguous areas do not qualify. The model then re-reads the restored region. In the fourth supplied page this recovered 20 additional note/rest elements and changed 20 measures to the printed 21.

Connected-barline counting was also evaluated. Automatic insertion produced extra/empty measures on some otherwise correctly counted systems because attention drift and cross-staff notation can confuse the association. The released version therefore uses those counts only as review notices and never inserts barlines from that heuristic. This limit is deliberate; a structural count is not enough to prove a note or boundary correction.

## Rhythm editing and review

Pitch-only editing previously rebuilt the note's type and removed its tuplet data even when duration was unchanged. The tick grid now increases exactly when a 128th note or fine onset cannot be represented by the original divisions, preserving all other durations and offsets. Duration editing previously changed a note without adjusting interleaved MusicXML backup movements. Those paths now preserve pitch-only rhythm and reconstruct cursor movements for a duration edit, retaining the other staff/voice's onsets. The editor supports short binary values and explicit triplet values, including 64th/128th notes.

The structural checker flags dense tuplet groups and model positions that move backwards within a staff. These are review prompts, not proof of an error or an accuracy percentage. Source excerpts use approximate attention coordinates, enlarged locally from the correct original page. Page association and recognition notices survive merging. Decoder length limits are reported instead of silently treating a truncated staff as complete.

Use **Score actions → Recognize again (copy)** to process stored images with the current reader. It creates a new draft and preserves the previous project and its corrections.

## Validation and limits

The public CC0 clef-change fixture exercises actual image recognition with treble clefs on both staves followed by a lower bass clef. Separate tests cover pitch-only tuplet preservation, short-note duration reflow with a stationary other voice, exact triplet export, tied pitch corrections, source-page mapping, persistent review notices and non-destructive re-recognition.

Four native geometry tests cover connected lines versus stems, double/broken lines, complete measure counts and staff-fragment recovery with white/black/cutaway rejection. The reader was rebuilt for WASM with Rust 1.96, locked Cargo dependencies and both SIMD variants. Updated hashes and original upstream hashes are retained in `docs/UPSTREAM.lock.json`.

User PDF/images, raw XML and derived notation are confined to gitignored `omr-validation/user/` and are excluded from the repository, public fixtures and corresponding-source archive. Aggregate results may be documented without publishing score content.

Recognition still misreads some crowded groups, tuplets, pitches, text and ties. The first-page dense passages retain false tuplet predictions that cannot be safely changed solely because they look statistically unusual. Three beam-count columns, for example, can be misleading when attention points are displaced; the release does not apply an unvalidated blanket rhythm rewrite. Review remains necessary. Physical iPhone and MIDI/audio hardware tests are still pending.

## Final aggregate result

All eight supplied pages were reprocessed with the released reader, using actual local models. These counts are structural observations, not a note-accuracy benchmark.

| Page | Previous parts | New parts | New measures | Previous note/rest elements | New note/rest elements |
| --- | --- | --- | --- | --- | --- |
| 1 | 5 | 1 | 14 | 486 | 486 |
| 2 | 3 | 1 | 15 | 622 | 619 |
| 3 | 3 | 1 | 24 | 617 | 618 |
| 4 | 5 | 1 | 21 | 505 | 525 |
| 5 | 3 | 1 | 18 | 552 | 552 |
| 6 | 1 | 1 | 18 | 482 | 509 |
| 7 | 1 | 1 | 17 | 516 | 520 |
| 8 | 1 | 1 | 15 | 484 | 484 |

The first five pages no longer become artificial independent parts. The fourth and sixth pages recover clipped opening regions; the seventh page also recovers a clipped right edge. The seventh page still has 17 decoded measures versus 18 implied by printed system numbering, and some dense first-page groups still contain false tuplets. These remaining failures are not concealed by inserting empty measures or changing rhythm values.

Final local validation: **82 browser tests passed, 2 intensive mobile-profile recognition cases skipped; 4 native geometry tests passed**. The mobile profile is simulation. Full source and raster fixtures for the public tests are CC0 and contain no supplied score content. Production/HTTPS verification is recorded separately.

Production verification under `/modScore/`, without cross-origin isolation headers, passed real recognition, PDF page selection, sampled playback, saved-draft reopening and offline reload/playback with zero browser errors or missing assets. See `validation/revision04-production.json`. The private combined eight-page project opens with one part, 142 measures and 4,072 sustained playback events; its sampled playback and source excerpt were checked with zero page errors. This is a functional check, not ground-truth accuracy validation.

Distribution checks verify all 257 built asset hashes, the content-derived service-worker version and source-archive exclusions. Re-running the packager preserves the service-worker version and asset manifest; generated archives/manifests are excluded from their own digest inputs.

Final HTTPS check passed on the published GitHub Pages address: 19 reference events recognized, PDF page selection, sampled playback, source download, responsive About page, offline reopening/playback and zero browser errors/missing assets. See `validation/github-live04.json`. No physical device claim is implied.
