# Demo music

## Basic Music — Baran Gulesen

Composition © Baran Gulesen. Included as modScore's first demo with the composer's explicit permission. Musical rights remain with the composer; the application's software license does not grant a separate general license to the composition.

The current reference edition follows the composer's seven supplied score screenshots: C minor (three flats), 35 written measures / 136 quarter beats, 110 BPM, played twice. Note data is retained in `basic-music.score.json`; `scripts/build-basic-demo.mjs` rebuilds the MusicXML and MIDI. The two short closing measures are retained. Original screenshots and private PCM analysis files are not distributed. `basic-music-source.mp3` is the composer-authorized recording from https://www.youtube.com/watch?v=AN0wGBUxkIk, encoded as mono MP3 (96 kbit/s) for local/offline comparison. Composition and recording rights remain with Baran Gulesen; neither is relicensed under AGPL.

The 0.5 audio-only, 0.6 v2 and 0.6.1 v3 editions are superseded by reference v4. The earlier reference review corrected adjacent-pitch artifacts in measures 13/27/28 and retained recurring ties and source rhythm/rest/clef boundaries. Version 0.7 revises only measures 13–14 against the recording: held F3 in measure 13 and recording-based release offsets in both hands; all other 33 written measures are unchanged. Earlier saved demo edits are preserved. Existing `basic-music-32` downloads now contain corrected first-32-bar excerpts. The full reference edition is `basic-music.musicxml` / `basic-music.mid`. The composer's recording remains at https://www.youtube.com/watch?v=AN0wGBUxkIk .

## Ode to Joy — Ludwig van Beethoven

The melody is in the public domain. Melody reference: Peter Chubb's public-domain Mutopia edition, https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=528 . modScore transposes the 16-bar melody into C and presents it twice, with an original piano accompaniment and an octave variation in the second half, for a 32-bar practice arrangement. This arrangement is dedicated to the public domain under CC0 by WeAreTheArtMakers.

No third-party classical performance recording or paid-site export is included. The Basic Music recording is included with its composer’s permission.

## Invention No. 1 — J. S. Bach, BWV 772

Complete 22-measure two-part score. Source: [Mutopia-2008/06/15-40](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40), Bach-Gesellschaft, typeset by **jeff covey**, © 2008, **CC BY-SA 3.0 Unported** (https://creativecommons.org/licenses/by-sa/3.0/). The original LilyPond, PDF and MIDI are retained under `sources/bach-invention-01.*`. The MusicXML conversion and its metadata/clef/tempo adjustments are adaptations under the same CC BY-SA 3.0 license. Practice tempo 96 BPM is an app choice, not a newly attributed composer marking. The composition itself is public domain. Trill/mordent/arpeggio and fermata symbols are retained; 0.7 adds configurable expressive playback while preserving the written score.

## Prelude in C major — J. S. Bach, BWV 846

Complete 35-measure score. Source: [Mutopia-2011/09/12-5](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5), entered by **Shay Rojansky**, edited by **Han-Wen Nienhuys** and **Tobias Erbsland**, version updated by **Javier Ruiz-Alma**. This Mutopia typesetting was placed in the **public domain** by its typesetter. Original LilyPond, PDF and MIDI are retained under `sources/wtk1-prelude1.*`. The MusicXML conversion applies the source's explicit upper-staff octave transposition, includes all three notes of its closing upper chord, and removes an empty converter-created terminal measure. Source tempo is 60 BPM.

## Piano Sonata K. 545 — W. A. Mozart, Allegro opening

Original measures **1–12**, not the complete movement or a newly invented arrangement. MusicXML source: [music21 corpus, movement1_exposition.mxl](https://github.com/cuthbertLab/music21/blob/master/music21/corpus/mozart/k545/movement1_exposition.mxl). The original compressed file is retained as `sources/mozart-k545-source.mxl`. The music21 repository's **BSD-3-Clause** copyright notice and license are included verbatim in `sources/music21-LICENSE.txt` (Copyright © 2006–2026 Michael Scott Asato Cuthbert). The composition is public domain. The source's first lower-staff chord in measure 7 contains B3; it is corrected to C4 against the independently typeset Mutopia score/MIDI (the later B3 in that measure is retained). Title, attribution and numeric practice tempo 132 BPM are added.

The separately supplied comparison PDF, LilyPond and MIDI (`sources/K545-1.*`) are [Mutopia-2013/09/01-998](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=998), typeset by **Alejandro Sierra**, © 2013, **CC BY-SA 3.0 Unported** (https://creativecommons.org/licenses/by-sa/3.0/). They contain the full movement; the app's playable excerpt is explicitly labeled 1–12. They are retained with their original notices and are not relicensed under the software's AGPL.

SHA-256 hashes of the bundled original sources are recorded in `docs/DEMO_SOURCES.lock.json`. These music assets retain the terms above, separately from the application software license.
