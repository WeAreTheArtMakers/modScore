# PDF / Import score review — 0.2.1

The reported `this.#da.getOrInsertComputed is not a function` error came from selecting the modern PDF.js build. The current Chrome used for earlier testing implements that method, so the original tests did not expose the Safari/older-engine compatibility gap. Mozilla documents the new Map usage and its legacy-build polyfills: https://bugzilla.mozilla.org/show_bug.cgi?id=2017816 .

The renderer now uses the official pinned 6.4.299 legacy entry and Worker together. This is a compatibility selection, not a downgrade or a hand-written replacement Map implementation. The legacy bundle includes core-js 3.50.0. API/Worker and font/CMap/WASM resources are all served locally, hashed and included in offline assets. Missing optional ImageDecoder behavior is avoided by using PDF.js's fallback path. No score data is uploaded.

The regression test deletes `Map.prototype.getOrInsertComputed/getOrInsert` and their WeakMap counterparts in both the page and the actual PDF Worker before loading the legacy modules. It renders the real two-page CC0 PDF fixture successfully in desktop and touch/mobile Chrome profiles. This simulates the specific missing APIs; it is not a physical Safari/iPhone test.

Import audit and changes:

- Header-based classification precedes clearing an existing scan. Extensionless PDF, MIDI and XML inputs are recognized by content. Empty, malformed/unsupported files and incompatible mixed selections report actionable errors.
- Image/PDF batches remain supported; document/project imports are one file at a time. Compressed MXL/ZIP is explicitly rejected rather than parsed as XML.
- The file input resets in `finally`, so the same file can be selected again after a failure.
- AbortSignal controls the PDF loading task and current RenderTask. Canvas dimensions are reset and pages/tasks released in `finally`, including errors and cancellation. The file-read stage checks cancellation before creating a loading task.
- Successfully imported pages and their original file are retained on partial failures. A failed added PDF does not remove previous pages. Busy state remains owned by the active operation until cleanup completes.
- Password-required and damaged PDFs receive specific messages. This release does not add a password-entry UI.
- Project/library imports retain and validate recognized-page checkpoints. Opening a new score resets the prior score's playback speed, transposition and selected editor note.

Validation: full desktop/mobile suite: 45 passed, one explicitly skipped mobile multipage OMR scenario. Focused import suite: 14 passed, including absent APIs in both realms, damaged PDF/retry preserving pages, pre-cancel and cancellation after a completed rendered page, checkpoint backup round trip, and binary WebP/HEIC header classification. Physical iPhone XS/Safari verification is still pending.

Recommended next steps: PDF page-range selection with thumbnails (avoid rasterizing unwanted pages), persisted import drafts/checkpoints for very long PDFs, an explicit encrypted-PDF unlock dialog if needed, and a physical Safari device matrix. Large PDFs still require memory proportional to the input bytes and retained compressed page images; sequential rendering does not make memory unlimited.

Production offline PDF check: the built 0.2.1 shell was reopened with the network disconnected and the new Map APIs deleted. The real two-page PDF imported successfully; the scaled first-page raster contained 2,815 nonwhite pixels, ruling out a blank-page success. No page errors were recorded. See `validation/revision021-offline-pdf.json`.
