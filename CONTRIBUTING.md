# Contributing to modScore

Start with the [README](README.md), then read [ARCHITECTURE.md](ARCHITECTURE.md). Use Node.js 22.23 or newer, run `npm ci`, `npm run setup` and `npm run dev`.

Keep recognition and score processing local. Do not add telemetry, automatic uploads, paid recognition services or authentication requirements. New downloads must be pinned and their licenses documented. Runtime assets are verified against `docs/UPSTREAM.lock.json` and `docs/PDFJS.lock.json`.

Before submitting a pull request:

- Run `npm run build` and relevant Playwright tests. The current tests use installed Chrome; run `npm run dev` first.
- For deployment changes, run `npm run build:pages` and `node scripts/verify-pages.mjs`.
- Describe the concrete behavior change and evidence. Distinguish simulated browser/device behavior from physical hardware testing.
- Keep personal scores, credentials, generated model copies and build outputs out of Git. Add only fixtures you are allowed to redistribute.
- Preserve AGPL source availability and third-party notices. Contributions are distributed under the repository's AGPL-3.0-only license.

Use Issues for reproducible bugs and proposed improvements. Recognition reports are most useful with a small, licensed example and the expected pitches/rhythm.
