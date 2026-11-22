# 0.3 — varying page layouts, live instruments and PDF workflow

## Recovery of different recognized part counts

The previous merger required each recognized page to have exactly the same part count. A change of layout, omitted staff or a recognition grouping difference prevented opening the entire score. Completed page XML was saved, so the data was recoverable but not playable.

The merger now checks names/staff layouts as well as counts. Matching layouts use the existing continuous-part path. Mismatching layouts use explicitly named **page-specific tracks**, preserving every encoded note at its original within-page time and placing pages sequentially. Inactive page-track spans use rest-only alignment measures; these do not invent pitches or reconstruct missing recognized staves. The result includes a review notice. This deliberately avoids guessing whether a newly detected part is the left hand or another instrument. Automatic cross-page identity matching is not asserted. A very long document with many changing layouts can produce a large engraving; page selection limits unnecessary work.

The unequal-layout test retains all 57 events from a 19-event page and a 38-event two-part page, with 32 quarter beats total. A checkpoint-recovery UI test imports completed page checkpoints, finishes the merge without another inference run, renders the score and plays real sampled audio with active keys. A second defect surfaced in this test: OSMD treats declaration-less XML strings as potential URLs. The renderer now passes a validated XML Document, which also avoids accidental score-string requests and supports serialized correction/merge results consistently.

Users can reopen an unfinished saved scan and select Recognize locally; completed page checkpoints are reused. Recognition may still miss a note, tie or staff. Merge recovery does not claim to repair OMR accuracy.

## Live instruments

`src/live-input.ts` owns one computer-keyboard/MIDI input controller. Computer keys A W S E D F T G Y H U J K play chromatic notes starting at C4; Z/X change octave. Key repeat is suppressed, editable fields/dialogs are ignored, and blur/page hiding releases held live notes. Multiple notes may sound together. MIDI input uses permission-gated Web MIDI with sysex disabled; note on/off, velocity, CC64 sustain and all-notes-off are handled. The active input can be chosen, and disconnected inputs release held notes. Both sources use the same AudioEngine and selected sample bank as the virtual piano. Live keys have a separate highlight. The emergency button stops live notes and score playback.

Settings provides a typing toggle, Connect MIDI, authorized audio output selection, a test tone and All notes off. AudioContext.setSinkId routes the shared audio engine when supported. If the browser cannot expose/select an interface, the user must select it in OS sound settings. Microphone capture is not requested. ASIO driver selection, audio-to-MIDI detection and outgoing MIDI sequencing are not implemented.

## Approved PDF improvements

Multi-page PDFs show a page-range dialog before full-resolution rasterization. A bounded first-six-page preview provides thumbnails; any valid page in the document can be selected using a range such as 1, 3-5. Single-page PDFs skip the range dialog. Completed imported pages, originals and recognized-page checkpoints are stored in IndexedDB drafts. A reloaded app can reopen the imported draft. This preserves completed raster pages; resuming an interrupted PDF's remaining original pages automatically is not implemented.

Encrypted PDFs show a local password field, permit retry after an incorrect password and clean up on cancellation. Passwords are not stored in the project or transmitted. Test fixtures use original CC0 notation encrypted with a known test-only password; no user score is bundled.

## Validation and limits

The desktop/mobile regression suite passed 61 tests with one explicitly skipped mobile multipage inference scenario. Seven focused desktop tests then passed for unequal layouts, actual checkpoint playback/rendering, computer typing polyphony and blur cleanup, MIDI message/sustain handling, page selection/draft reload, encrypted PDF retry and output-routing integration. MIDI protocol tests use a fake input transport; output-routing tests mock device authorization and setSinkId. No physical MIDI keyboard/audio interface or iPhone XS was connected or verified. Actual score playback and PDF decoding use real browser engines and sample/PDF assets.

Further priorities: an explicit cross-page part-mapping editor; local live-performance recording/export; source PDF page-number metadata for selected ranges; measured latency and a physical Chrome/interface/Safari test matrix. No cloud service, subscription or account is added.

Production verification: with networking disabled, an encrypted PDF was unlocked locally, only selected page 2 was rasterized, its draft survived a reload, and typing activated/released a live piano key. No page errors occurred. This evidence is `validation/revision03-production.json`; hardware protocol/route tests remain simulated. Settings was also checked at 375 px width without horizontal overflow.
