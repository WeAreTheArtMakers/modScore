# Device and browser verification

## iPhone

A user installed the released modScore from Safari using Add to Home Screen.
The icon and the app opened on the physical phone. Starting the Basic Music
tour displayed a Service Worker fetch failure. The screenshots do not identify
which resource failed. The development build caches the score, notation
renderer, recording and piano samples before activating the worker. Optional
files are retried independently, and a missing offline file returns a readable
response. Cached audio answers single byte-range requests. The [production smoke test](validation/workbench-production.json)
passed after deliberately interrupting one optional file, repairing the cache
and taking the browser offline.

To retest a hosted build on the phone:

1. Connect to the internet and open modScore from its Home Screen icon. Apply
   **Update app** if it appears. Wait for the app to reopen.
2. Open **Settings → Prepare offline use**. Wait for the app and piano to be
   ready. Use **Download recognition models** if the trial includes scanning
   without internet.
3. Close the installed app, turn on Airplane Mode, and turn off Wi-Fi if it
   remains enabled. Reopen from the icon. Play Basic Music and compare the
   source recording with the piano at measure 13.
4. Repeat the trial after backgrounding and returning to the app. Report the
   failing step and the message if one appears.

The phone evidence covers the released build. The patched build still needs
this repeat on the physical phone. The local Playwright WebKit process crashed
at launch, and Safari's local WebDriver reports that remote automation is
disabled. The Chrome device viewport checks do not measure iPhone behavior.

## Android

In Chrome, open the hosted app and use **Settings → Install app** when offered
or **⋮ → Add to home screen → Install**. Reopen from the icon and follow the
same offline preparation and playback procedure. The production test checks
the scoped manifest, standalone display mode and the separate maskable icon.
The browser suite checks the install prompt at a mobile viewport. A physical
Android device was not available.

## Optical music recognition

Start the dev server, then run `npm run test:recognition:fixtures`. The suite
imports each file through the app and runs the real on-device model. The
paired MusicXML supplies written pitch and timing. Matching is performed
within each measure and staff. It pairs attacks within 0.25 quarter-note beats
and counts timing errors beyond 1/48 of a beat.

| Input | Reference notes | Wrong pitch | Missing | Extra | Onset | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Clean study PDF | 56 | 0 | 0 | 0 | 0 | 0 |
| Study, 10° skewed JPEG | 56 | 0 | 0 | 0 | 0 | 0 |
| Study, low-contrast PNG | 56 | 0 | 0 | 0 | 0 | 0 |
| Bach BWV 772, two-page PDF | 458 | 0 | 0 | 1 | 0 | 1 |

Before preprocessing, the skew example had 33 unmatched reference notes,
23 unmatched detections and six wrong pitches among paired notes. The faded
scan had one missing note and one wrong pitch. Bach's 12–13 page turn splits
a tied D5 into two attacks. The application flags both measures for review.
The final chord now uses the leading chord tone's staff when its other
tones omit a staff number. The model also reads an arpeggio in the last
chord where the source shows fermatas. The note metrics do not grade
ornaments; compare these marks with the retained original.
The [per-measure report](validation/recognition-study-result.json) includes
both before and after results. These checks evaluate pitches and encoded
timing. The synthetic images cover rotation and contrast; real camera
perspective, shadows and narrow crops need separate coverage.

## Large PDF import

With the dev server running, `node scripts/verify-large-pdf.mjs` uses Poppler
`pdfunite` or Ghostscript to create a temporary forty-page PDF. It imports pages
1, 2 and 40 at a narrow viewport and samples Chrome's renderer JavaScript
heap. The [selective import result](validation/large-pdf-selective-import.json)
records the three stored pages. Heap sampling excludes native canvas, GPU and
PDF worker allocations. On iPhone, repeat the same selection and confirm that
the preview reopens after closing the app.

## MIDI keyboard and sustain pedal

In Chrome or Edge, connect the keyboard, open **Settings → Connect MIDI**, and
pick the device. Open **Virtual piano** and enable audio. Hold a pedal while
playing a note. Lift the key and check that it sustains. Lift the pedal and
check that the note releases. Repeat after unplugging the keyboard to check
that any active notes clear.

The automated browser test verifies Note On/Off and CC64 handling. The
[CoreMIDI bridge test](validation/midi-coremidi-bridge.json) also passed Note
On, key release under sustain and pedal release in Chrome with an isolated
macOS virtual endpoint. A physical keyboard/pedal trial remains a separate
check.
