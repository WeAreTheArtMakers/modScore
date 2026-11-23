# Test fixtures

`study-two-pages.pdf` and `study-encrypted.pdf` are rendered from the project's original CC0 grand-staff study. The public test password is `modscore-test`; it is not a credential.

`treble-clef-piano.musicxml` adapts that same original CC0 study to put treble clefs on both staves in the first system, then a bass clef below in the next system. `treble-clef-piano.png` is its actual OSMD rendering at 2x pixel density. It tests actual OMR staff/part preservation; recognition is never replaced with predefined results. These fixtures are CC0.

User-provided scores and their recognition outputs are excluded from this directory and from Git/source distributions.

`recognition-study.pdf` is an original CC0 piano study engraved from
`recognition-study.ly`. The paired `recognition-study.musicxml` records the
written pitches and timing. Its three measures contain 16 sixteenths, four
eighth-note triplets and four close-spaced chords, respectively, against a
quarter-note bass line. The reference contains 56 pitched notes.

The two photo-like fixtures are generated from the same CC0 engraving. Render
the PDF at 150 DPI, then make these deterministic variants with ImageMagick:

```sh
pdftoppm -r 150 -png -singlefile tests/fixtures/recognition-study.pdf /tmp/modscore-reference
magick /tmp/modscore-reference.png -background '#ddd8d0' -rotate 10 -strip -quality 83 tests/fixtures/recognition-study-skewed.jpg
magick /tmp/modscore-reference.png -colorspace Gray +level 70%,88% -strip tests/fixtures/recognition-study-low-contrast.png
```

The skewed JPEG models a 10° camera roll. The contrast fixture compresses the
full gray range to 70–88%. The Bach BWV 772 case uses both pages of the pinned
[Mutopia engraving](../../public/demos/LICENSE.md) already included with the
app and its corresponding MusicXML. It exercises continuous sixteenths in
both staves, ties, ornaments and a page boundary.
