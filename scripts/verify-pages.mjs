import { parseMidi } from "midi-file";
// Exercise the actual production build under a project subpath, without COOP/COEP.
// Use a separate verification origin. Never serve an HTML fallback for missing assets.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
const base = process.env.MODSCORE_VERIFY_BASE || "/modScore/";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".musicxml": "application/xml",
  ".mp3": "audio/mpeg",
};
const root = resolve("dist");
const simulateMissingOptional = process.env.MODSCORE_VERIFY_OPTIONAL_MISS === "1";
let missedOptional = false;
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    if (simulateMissingOptional && !missedOptional && pathname === base + "_headers") {
      missedOptional = true;
      res.writeHead(503).end("Simulated interruption of an optional asset");
      return;
    }
    let file = resolve(root, pathname.slice(base.length) || "index.html");
    if (!file.startsWith(root + "/") && file !== root) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file += "/index.html";
    const content = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(
  process.env.MODSCORE_BROWSER === "chromium" ? {} : { channel: "chrome" },
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 1060 },
});
const page = await context.newPage();
const errors = [],
  failures = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().startsWith(origin) && !r.url().endsWith("/intentional-offline-miss") &&
      !(simulateMissingOptional && r.url().endsWith("/_headers") && r.status() === 503) && r.status() >= 400)
    failures.push(r.status() + " " + r.url());
});
const { expect } = await import("@playwright/test");
try {
  await page.goto(origin + base);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
  });
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toBe(origin + base);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors.filter((error) => error.critical)).toEqual([]);
  const installedApp = JSON.parse(manifest.data);
  expect(installedApp).toMatchObject({ id: "./", start_url: "./", scope: "./", display: "standalone" });
  expect(installedApp.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", purpose: "any" }),
    expect.objectContaining({ sizes: "512x512", purpose: "any" }),
    expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
  ]));
  const icons = await page.evaluate(async (icons) => Promise.all(icons.map(async ({ src }) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })), [...installedApp.icons, { src: await page.locator('link[rel="apple-touch-icon"]').getAttribute("href") }]);
  expect(icons).toEqual([[192, 192], [512, 512], [512, 512], [180, 180]]);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await expect(page.locator("h1")).toHaveText("Basic Music");
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await expect(page.locator("[data-measure]")).toHaveCount(70);
  await expect(page.locator("#demo-banner")).toContainText("three flats");
  await expect(page.locator("#follow")).not.toBeChecked();
  if (simulateMissingOptional) {
    expect(missedOptional).toBe(true);
    expect(await page.evaluate(async () => ({
      optional: !!await caches.match(new URL("./_headers", location.href).href),
      piano: !!await caches.match(new URL("./instruments/acoustic_grand_piano.json", location.href).href),
      lastWorker: !!await caches.match(new URL("./recognition/omr-worker.js", location.href).href),
    }))).toEqual({ optional: false, piano: true, lastWorker: true });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Prepare offline use", exact: true }).click();
    await expect(page.getByRole("status").filter({hasText: "The app and piano are ready to use offline"})).toBeVisible({timeout: 45000});
    await page.getByRole("button", { name: "My scores", exact: true }).first().click();
    await page.locator(".score-open").filter({hasText:"Basic Music"}).first().click();
  }
  const response = await fetch(origin + base + "demos/basic-music.mid");
  const midi = parseMidi(new Uint8Array(await response.arrayBuffer()));
  expect(midi.tracks.flat().filter((e) => e.type === "noteOn")).toHaveLength(
    1228,
  );
  expect(
    midi.tracks.flat().find((e) => e.type === "keySignature"),
  ).toMatchObject({ key: -3, scale: 1 });
  await page.getByRole("button", {name:"Review measures 13–14",exact:true}).click();
  await expect(page.locator("#ab-position")).toContainText("Measure 13");
  await page.getByRole("button", {name:"A · Listen to source",exact:true}).click();
  expect(await page.locator("#original-audio").evaluate(e=>e.currentTime)).toBeGreaterThan(35.65);
  await page.getByRole("button", {name:"B · Listen to piano",exact:true}).click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  expect(await page.locator("#original-audio").evaluate(e=>e.paused)).toBe(true);
  await page.getByRole("button", {name:"Pause comparison",exact:true}).click();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({
    path: "docs/validation/demo-desktop.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Start guided demo", exact: true })
    .click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  await page.getByRole("button", { name: "Stop tour", exact: true }).click();
  await page.getByRole("button", { name: "Loop 1–4", exact: true }).click();
  await expect(page.locator("#loop-on")).toBeChecked();
  await page.locator("#metronome-volume").fill("0.18");
  await page.locator("#metronome-volume").dispatchEvent("input");
  await expect(page.locator("#metronome-level")).toHaveText("18%");
  await page
    .getByRole("button", { name: "Try Beethoven", exact: true })
    .click();
  await expect(page.locator("[data-measure]")).toHaveCount(32);
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page
    .locator("#files")
    .setInputFiles("public/fixtures/grand-staff.musicxml");
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "docs/preview.png", fullPage: false });
  await page.goto(origin + base + "about/");
  await expect(page.getByRole("heading", { name: /Your music/ })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/validation/about-mobile.png",
    fullPage: false,
  });
  await page.goto(origin + base);
  await page
    .locator("#files")
    .setInputFiles("tests/fixtures/study-two-pages.pdf");
  await page.getByRole("textbox", { name: "Page range" }).fill("2");
  await page
    .getByRole("button", { name: "Import selected pages", exact: true })
    .click();
  await expect(page.locator(".scan-preview img")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  await expect(page.locator(".score-open")).toHaveCount(4);
  if (process.env.MODSCORE_VERIFY_OMR === "1") {
    await page.goto(origin + base);
    await page.locator("#files").setInputFiles("tests/fixtures/recognition-study-skewed.jpg");
    await page
      .getByRole("button", { name: "Recognize locally", exact: true })
      .click();
    await expect(page.locator(".score-meta")).toContainText("3 measures · 56 notes", {
      timeout: 240000,
    });
    await expect(page.locator("#notation svg").first()).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".key.active").first()).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  }
  // Exercise the built audio Worker and ONNX paths through the public UI.
  const { audioFixture } = await import("./audio-fixture.mjs");
  const verifyAudio = async (title) => {
    await page
      .getByRole("button", { name: "Audio & YouTube", exact: true })
      .click();
    await page.locator("#audio-file").setInputFiles({
      name: "Original arpeggio.wav",
      mimeType: "audio/wav",
      buffer: audioFixture(),
    });
    await page.locator("#audio-title").fill(title);
    await page.locator("#audio-bars").selectOption("8");
    await page.locator("#audio-auto-tempo").uncheck();
    await page.locator("#audio-bpm").fill("60");
    await page
      .getByRole("button", { name: "Create piano score", exact: true })
      .click();
    await expect(page.locator("h1")).toHaveText(title, {
      timeout: 120000,
    });
    await expect(page.locator("#notation svg").first()).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".key.active").first()).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  };
  await verifyAudio("Production audio study");
  // Wait for the complete shell precache before taking the origin offline.
  await page.waitForFunction(
    async () => {
      const response = await fetch("./offline-assets.json");
      const paths = await response.json();
      const entries = await Promise.all(
        paths.map((p) =>
          caches.match(
            new URL("./" + p.replace(/^\//, ""), location.href).href,
          ),
        ),
      );
      return entries.every(Boolean);
    },
    null,
    { timeout: 120000 },
  );
  await context.setOffline(true);
  await page.goto(origin + base);
  const offlineRequests = await page.evaluate(async () => {
    const range = await fetch("./demos/basic-music-source.mp3", { headers: { Range: "bytes=0-1" } });
    const absent = await fetch("./intentional-offline-miss");
    return { range: range.status, rangeLength: (await range.arrayBuffer()).byteLength,
      contentRange: range.headers.get("Content-Range"), absent: absent.status };
  });
  expect(offlineRequests).toMatchObject({ range: 206, rangeLength: 2, absent: 503 });
  expect(offlineRequests.contentRange).toMatch(/^bytes 0-1\/\d+$/);
  await page
    .getByRole("button", { name: "My scores", exact: true })
    .first()
    .click();
  // The first imported reference score remains available independently of PDF/OMR drafts.
  const reference = page
    .locator(".score-open")
    .filter({ hasText: "modScore — Recognition study" });
  if (await reference.count()) await reference.first().click();
  else await page.locator(".score-open").last().click();
  await expect(page.locator("#notation svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".key.active").first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await verifyAudio("Offline audio study");
  // The new repertoire and original PDFs must open for the first time offline,
  // not merely from an already-saved project.
  await page.getByRole("button", { name: "My scores", exact: true }).first().click();
  await page.locator(".score-open").filter({hasText:"Basic Music"}).first().click();
  for (const [key, bars] of [["bach-invention",22],["bach-prelude",35],["mozart",12]]) {
    await page.locator("#demo-select").selectOption(key);
    await expect(page.locator("[data-measure]")).toHaveCount(bars);
    await expect(page.locator("#notation svg").first()).toBeVisible();
    const pdfMagic = await page.evaluate(async () => {
      const link = [...document.querySelectorAll("a")].find(a => a.textContent === "Source score PDF");
      const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
      return new TextDecoder().decode(bytes.subarray(0,5));
    });
    expect(pdfMagic).toBe("%PDF-");
    await page.getByRole("button", { name:"Play", exact:true }).click();
    await expect(page.locator(".key.active").first()).toBeVisible();
    await page.getByRole("button", { name:"Pause", exact:true }).click();
  }
  await page.getByRole("button", {name:"My scores",exact:true}).first().click();
  await page.locator(".score-open").filter({hasText:"Basic Music"}).first().click();
  await page.getByRole("button", {name:"Review measures 13–14",exact:true}).click();
  await page.getByRole("button", {name:"A · Listen to source",exact:true}).click();
  expect(await page.locator("#original-audio").evaluate(e=>e.currentTime)).toBeGreaterThan(35.65);
  await page.getByRole("button", {name:"Pause comparison",exact:true}).click();
  await page.locator("#demo-select").selectOption("bach-invention");
  await page.getByRole("button",{name:"Export",exact:true}).click();
  const expressiveDownload=page.waitForEvent("download");
  await page.getByRole("button",{name:"MIDI (.mid)",exact:true}).click();
  const expressiveBytes=await readFile(await(await expressiveDownload).path());
  expect(parseMidi(expressiveBytes).tracks.flat().filter(e=>e.type==="noteOn").length).toBeGreaterThan(458);
  expect(errors, "Browser errors").toEqual([]);
  expect(failures, "Missing production assets").toEqual([]);
  console.log(
    JSON.stringify(
      {
        productionSubpath: base,
        installManifestAndMobileIcons: true,
        crossOriginIsolated: false,
        notation: true,
        sampledPlayback: true,
        pdfPageSelection: true,
        savedDraftReload: true,
        offlineReloadAndPlayback: true,
        referenceDemo35Bars: true,
        beethoven32Bars: true,
        signedMidiKey: true,
        audioTranscription: true,
        offlineAudioTranscription: true,
        independentMetronomeVolume: true,
        offlineSourceDemosAndPDFs: 3,
        samePointSourcePianoAB: true,
        offlineSourceListening: true,
        offlineAudioByteRange206: true,
        readableMissingAsset503: true,
        repairedInterruptedOptionalAsset: simulateMissingOptional,
        expressiveBachMidi: true,
        actualRecognition: process.env.MODSCORE_VERIFY_OMR === "1",
        errors,
        failures,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
