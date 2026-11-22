# Deployment

## GitHub Pages

- Application: https://wearetheartmakers.github.io/modScore/
- Introduction and local setup: https://wearetheartmakers.github.io/modScore/about/
- Source: https://github.com/WeAreTheArtMakers/modScore

Visitors need a supported browser, not Node.js. Node is used to install dependencies and build the static distribution. Recognition, the library and audio run locally in the browser.

Build the Pages distribution:

```sh
npm ci
npm run setup
npm run build:pages
node scripts/verify-pages.mjs
```

`build:pages` sets Vite's base to `/modScore/`. The app, recognition worker, PDF worker/resources, samples, manifest and service worker use this deployment path. Offline shell caches are scoped to the deployment so another project on the same origin is not deleted by an update. Model cache entries retain full URLs.

The Actions workflow in `.github/workflows/pages.yml` builds, verifies the production subpath and publishes the artifact. It has read-only repository access in the build job; only the deployment job receives `pages:write` and `id-token:write`. All actions are pinned to exact commit SHAs. Enable **Settings → Pages → Source → GitHub Actions**. A push to `main` or a manual dispatch publishes only after verification succeeds. Asset/model integrity is checked from the committed lock manifests during setup and build.

GitHub Pages ignores `_headers` and cannot configure custom response headers from that file. modScore uses a single CPU WASM thread and does not require COOP/COEP for this path. Production verification explicitly serves without isolation headers. Pages should serve `.wasm` as `application/wasm`, `.mjs` as JavaScript and missing assets as 404. Do not use a SPA fallback that returns HTML for missing model or worker URLs.

Large runtime models are downloaded by the build, verified and included in the Pages artifact. They are intentionally excluded from the Git source branch. The deployment is around 200 MB; monitor GitHub Pages hosting limits and upstream download availability as usage grows. See [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) and [Vite static deployment](https://vite.dev/guide/static-deploy#github-pages).

## Other static HTTPS hosts

Run `npm run build` and upload only `dist/`. For a non-root host path, set `VITE_BASE_PATH` to that path (leading and trailing `/`) during the build. Keep paths stable so the installed PWA and local library continue to use the same origin.

1. Serve `sw.js`, `index.html` and `offline-assets.json` with revalidation/no-cache where the host permits it. Hashed JS/CSS can use immutable caching.
2. Serve WASM as `application/wasm`, modules as JavaScript and ONNX as binary. Translate `public/_headers` to your host configuration if supported.
3. Keep `source.tar.gz`, `LICENSE` and `THIRD_PARTY_NOTICES.md` public. The source archive must correspond to the deployed build.
4. Serve model files without HTML rewriting. HTTP Range is useful; a full-file 200 response is supported too.
5. Test saved projects, explicit updates, PDF, recognition, audio and offline reopening on the final HTTPS URL.

No custom domain or existing WeAreTheArtMakers website is modified by this deployment. `music.wearetheartmakers.com` remains an optional future custom domain, requiring a separate DNS change.

## Device verification still needed

Desktop Chrome and simulated narrow layouts do not establish physical iPhone compatibility. On a real iPhone XS/iOS 18, test camera/import, recognition, comparison, overlapping notes, instruments, seeking, loops, multitouch, orientation, background/resume and audio interruption. Install through Safari → Share → Add to Home Screen, prepare offline use in the installed app and verify in airplane mode after reopening and rebooting.

Measure memory, per-page time and audio latency on the actual device. Test real MIDI keyboards/pedals and USB audio interfaces separately. Export backups before clearing browser data; storage persistence can be refused or evicted.
