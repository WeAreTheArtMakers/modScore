import { version } from "../package.json";

import { advanceHistory, historyTarget, type HistoryMove, type ScoreSnapshot } from "./score-history";
import { validAlignmentPoints, type SourceAlignment } from "./source-alignment";
import {
  accidentalNames, insertionTargets, insertWrittenNote, noteLetters, pitchChoiceForMidi,
  readWrittenPitch, removeWrittenNote, replaceWrittenPitch, type PitchChoice, type InsertionTarget,
} from "./note-editor";
import { SourceComparison, sourceSeconds } from "./source-comparison";
import type { ExpressionOptions } from "./performance";
import { audioControls, type AudioSettings } from "./audio-controls";
import { keyChoices } from "./notation";
import { type AudioProfile } from "./audio-analysis";
import { writtenBeat } from "./repeats";
import { demos, demoProject, DEMO_SEEN } from "./demos";
import { youtubeId } from "./youtube";
import { metronomePulses } from "./transport-clock";
import { sourceLocation } from "./recognition-review";
import { assetPath } from "./paths";
import { LiveInput } from "./live-input";
import { planImport } from "./imports";
import { watchUpdates } from "./updates";
import { reviewEncoding, setScoreTempo, tieNext, untie } from "./review";
import "./style.css";
import { uprightPhoto } from "../vendor/partsong/orient.js";
import {
  parseMusicXML,
  xmlDocument,
  activeNotes,
  amendNote,
  amendOnset,
  mergePages,
  noteName,
  beatToSeconds,
  type Timeline,
  type Note,
  type Measure,
} from "./music";
import { AudioEngine } from "./audio";
import { Piano, colors } from "./piano";
import { Sheet } from "./sheet";
import { Recognizer, normalise, pdfImages } from "./omr";
import {
  listScores,
  saveScore,
  updateScore,
  type ScoreChanges,
  deleteScore,
  download,
  exportProject,
  validateProject,
  storageStatus,
  type Project,
} from "./storage";
import { exportMidi, midiToXml } from "./midi";
import { instrumentNames } from "./instruments";
import { t, language, setLanguage } from "./i18n";
const app = document.querySelector<HTMLDivElement>("#app")!;
const audio = new AudioEngine(),
  recognizer = new Recognizer();
const comparison = new SourceComparison(audio);
const expressionSettings:ExpressionOptions = {style:(["auto","baroque","classical","literal"].includes(localStorage.getItem("modscore-expression")||"")?localStorage.getItem("modscore-expression"):"auto") as ExpressionOptions["style"],fermata:Math.max(1,Math.min(2.5,Number(localStorage.getItem("modscore-fermata"))||1.5))};
function scoreTimeline(xml:string,title?:string) {const t=parseMusicXML(xml,title);t.expression={...expressionSettings};return t;}
const sheet = new Sheet();
sheet.onManualBrowse = () => {
  if (!follow) return;
  follow = false;
  localStorage.setItem("modscore-follow", "off");
  const input = document.querySelector<HTMLInputElement>("#follow");
  if (input) input.checked = false;
};
sheet.onSeek = (measure) => {
  if (timeline) {
    const candidates = timeline.measures.filter(
      (m) => (m.sourceMeasure ?? m.index) === measure,
    );
    const target = candidates.sort(
      (a, b) => Math.abs(a.beat - audio.now()) - Math.abs(b.beat - audio.now()),
    )[0];
    if (target) {comparison.pause();comparison.anchor=target.beat;audio.seek(target.beat);}
  }
};
let piano: Piano | undefined;
let view = "home",
  mode = "score",
  project: Project | undefined,
  timeline: Timeline | undefined,
  library: Project[] = [];
let pages: Blob[] = [],
  originals: Blob[] = [],
  scanXml: string[] = [],
  pageIndex = 0,
  scanName = "",
  busy = false,
  cancelled = false,
  status = "",
  scanId: string = crypto.randomUUID();
let urls: string[] = [],
  follow = localStorage.getItem("modscore-follow") === "on",
  auto = localStorage.getItem("modscore-auto-keys") === "on",
  roll = false,
  zoom = 32,
  selectedNote = 0,
  revision = 0,
  lastMeasure = -1,
  updateCleanup: (() => void) | undefined;
let editorMeasure: number | undefined;
let editOnScore = false;
let showAlignment = false;
let selectedHead: number | undefined;
let previewRequest = 0;
let stopPreview: (() => void) | undefined;
let editSaving = false;
let useMidiPitch = false;
let importAbort: AbortController | undefined;
let loopStart = 1,
  loopEnd = 4,
  loopPicking = false,
  loopPickAnchor: number | undefined;
let guideActive = false,
  guideStep = 0,
  guideSeconds = 0,
  guideLastFrame = 0;
let audioFile: File | undefined,
  audioSourceUrl = "",
  audioTitle = "",
  audioBpm = 112,
  audioBars = 32,
  audioAbort: AbortController | undefined;
const audioSettings: AudioSettings = {
  bpm: 120,
  bars: 32,
  key: "auto",
  meter: "4/4",
  grid: 0.25,
  profile: "piano",
  start: 0,
  autoTempo: true,
  chords: false,
};
const storedMetronome = Number(
  localStorage.getItem("modscore-metronome-volume") ?? 0.35,
);
audio.setMetronomeVolume(
  Number.isFinite(storedMetronome) ? storedMetronome : 0.35,
);
let theme = localStorage.getItem("modscore-theme") || "dark";
document.documentElement.dataset.theme = theme;
document.documentElement.lang = language;
const e = (s: unknown) =>
  String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const live = new LiveInput(audio, () => view === "piano" || view === "player");
const hardwareTr = () => language === "tr";
function hardwarePanel() {
  const tr = hardwareTr();
  return `<section class="panel"><h2>${tr ? "Klavye, MIDI ve ses çıkışı" : "Keyboard, MIDI & audio output"}</h2><label class="check-label"><input id="typing-enable" type="checkbox" ${live.enabled ? "checked" : ""}>${tr ? "Bilgisayar klavyesiyle çal" : "Play with computer keyboard"}</label><p class="fine">${tr ? "Nota ve oktav tuşları Sanal piyano bölümündeki tek klavye panelinde gösterilir." : "Note keys and octave controls are grouped in the Virtual piano keyboard panel."}</p><div class="row">${button("Connect MIDI", "connect-midi")}${button("Audio outputs", "audio-outputs")}${button("Test audio", "test-audio")}${button("All notes off", "panic")}</div><label>MIDI giriş<select id="midi-input"><option value="">${tr ? "Bağlı giriş yok" : "No input selected"}</option></select></label><label>${tr ? "Ses çıkışı" : "Audio output"}<select id="audio-output"><option value="">${tr ? "Sistem varsayılanı" : "System default"}</option></select></label><p id="hardware-status" role="status"></p><p class="fine">${tr ? "MIDI için tarayıcı izni gerekir. Ses kartı listede yoksa işletim sisteminin ses çıkışından seçin. MIDI ve ses kartı aynı bağlantı türü değildir." : "MIDI requires browser permission. If your audio interface is not listed, select it in system sound settings. MIDI input and audio output are separate connections."}</p></section>`;
}
function refreshHardware() {
  const status = document.querySelector("#hardware-status");
  if (status) status.textContent = live.status;
  const select = document.querySelector<HTMLSelectElement>("#midi-input");
  if (select) {
    const inputs = live.inputs(),
      signature = inputs.map((i: any) => i.id + i.state).join();
    if (select.dataset.ports !== signature) {
      select.dataset.ports = signature;
      select.replaceChildren(
        new Option("No MIDI input", ""),
        ...inputs
          .filter((i: any) => i.state === "connected")
          .map((i: any) => new Option(i.name || i.id, i.id)),
      );
    }
    select.value = live.selected;
  }
  const hint = document.querySelector("#live-status");
  if (hint) hint.textContent = live.status;
  const octave = document.querySelector("#keyboard-octave");
  if (octave) octave.textContent = String(live.octave);
  document.querySelectorAll<HTMLElement>("[data-code]").forEach((node) => {
    node.classList.toggle(
      "is-down",
      live.active.has("key:" + node.dataset.code),
    );
    const text = node.querySelector("small");
    if (text)
      text.textContent = noteName(
        (live.octave + 1) * 12 + Number(node.dataset.offset),
      );
  });
}
live.onchange = () => {
  piano?.setLive(live.pitches());
  refreshHardware();
};
const paths: Record<string, string> = {
  home: "M3 10 12 3l9 7v10H3Z M9 20v-7h6v7",
  library: "M4 4h5v16H4z M12 4h3v16h-3z M18 4l3 15",
  piano: "M3 5h18v14H3z M7 5v8h3V5 M14 5v8h3V5 M9 13v6 M15 13v6",
  scan: "M7 3H3v4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4 M6 11h12 M6 15h8",
  import: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  play: "m9 5 10 7-10 7Z",
  pause: "M8 5v14 M16 5v14",
  stop: "M6 6h12v12H6Z",
  restart: "M5 6v12 M18 6 7 12l11 6Z",
  download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  plus: "M12 4v16 M4 12h16",
  close: "M5 5l14 14 M19 5 5 19",
  chevron: "m9 5 7 7-7 7",
  music:
    "M9 18V5l11-2v13 M9 8l11-2 M9 18c0 4-6 4-6 1 0-2 6-4 6-1 M20 16c0 4-6 4-6 1 0-2 6-4 6-1",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  check: "m5 12 4 4L20 5",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z m-4 9 3 3 5-6",
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
const label = (s: string) => e(t(s));
const button = (s: string, action: string, cls = "", ic?: string) =>
  `<button class="${cls}" data-action="${action}">${ic ? icon(ic) : ""}${label(s)}</button>`;
function toast(message: string, error = false) {
  const node = document.createElement("div");
  node.className = "toast" + (error ? " error" : "");
  node.role = "status";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 6500);
}
function safe(fn: () => Promise<unknown> | unknown) {
  return () => {
    try {
      Promise.resolve(fn()).catch((err) =>
        toast(err.message || String(err), true),
      );
    } catch (err) {
      toast((err as Error).message, true);
    }
  };
}
async function refreshLibrary() {
  library = (await listScores()).sort((a, b) => b.updated - a.updated);
}
const shortDate = (n: number) =>
  new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(
    n,
  );
function rows(scores: Project[]) {
  return scores.length
    ? scores
        .map(
          (p) =>
            `<div class="score-row"><button class="score-open" data-open="${e(p.id)}"><span class="score-icon">${icon("music")}</span><span><strong>${e(p.title)}</strong><small>${shortDate(p.updated)} · ${p.pages.length ? `${p.pages.length} ${language === "tr" ? "sayfa" : "pages"}` : "MusicXML / MIDI"} · ${label(p.reviewed ? "Saved on this device" : "Review required")}</small></span></button><button class="icon-button" data-export="${e(p.id)}" aria-label="${label("Export")}">${icon("download")}</button></div>`,
        )
        .join("")
    : `<div class="empty"><span>${icon("library")}</span><h3>${label("No scores yet")}</h3><p>${label("Scan or import your first score to begin.")}</p></div>`;
}
function keyboardHelp() {
  const whites = [
    ["A", "KeyA", 0, 1],
    ["S", "KeyS", 2, 3],
    ["D", "KeyD", 4, 5],
    ["F", "KeyF", 5, 6],
    ["G", "KeyG", 7, 8],
    ["H", "KeyH", 9, 10],
    ["J", "KeyJ", 11, 12],
    ["K", "KeyK", 12, 13],
    ["L", "KeyL", 14, 15],
    [";", "Semicolon", 16, 17],
  ] as const;
  const blacks = [
    ["W", "KeyW", 1, 2],
    ["E", "KeyE", 3, 4],
    ["T", "KeyT", 6, 7],
    ["Y", "KeyY", 8, 9],
    ["U", "KeyU", 10, 11],
    ["O", "KeyO", 13, 14],
    ["P", "KeyP", 15, 16],
  ] as const;
  return `<details class="typing-help" id="typing-help"><summary>${language === "tr" ? "Bilgisayar klavyesi" : "Computer keyboard"} <span><kbd>Z</kbd> / <kbd>X</kbd> ${language === "tr" ? "oktav" : "octave"}</span></summary><div class="typing-map" aria-label="Piano keyboard mapping">${[...whites, ...blacks].map(([key, code, offset, col]) => `<div class="typing-key ${blacks.some((k) => k[1] === code) ? "black" : "white"}" style="grid-column:${col}" data-code="${code}" data-offset="${offset}"><kbd>${key}</kbd><small>${noteName((live.octave + 1) * 12 + offset)}</small></div>`).join("")}</div><p class="fine">${language === "tr" ? "Tuşu bırakınca nota susar. Yazı alanlarında piyano tuşları devre dışıdır." : "Release a key to stop the note. Typing in text fields does not play notes."}</p></details>`;
}
function keyboardControls() {
  return `<section class="keyboard-controls"><div class="live-toolbar">${button("Enable audio", "enable-live")}${button("Connect MIDI", "connect-midi")}${button("All notes off", "panic")}<div class="octave-control"><button data-action="octave-down" aria-label="Lower octave">−</button><span>${language === "tr" ? "Oktav" : "Octave"} <output id="keyboard-octave">${live.octave}</output></span><button data-action="octave-up" aria-label="Higher octave">+</button></div><span id="live-status" role="status"></span></div>${keyboardHelp()}</section>`;
}
function demoCards() {
  return `<section class="demo-library"><div class="section-heading"><h2>${language === "tr" ? "Demolarla keşfet" : "Explore the demos"}</h2><span class="muted">${language === "tr" ? "Nota ve piyano" : "Score & piano"}</span></div><div class="demo-cards">${demos.map((d) => `<button data-demo="${d.key}" class="demo-card"><span class="demo-icon">${icon("music")}</span><span><strong>${e(d.title)}</strong><small>${e(d.composer)}</small><small>${e(d.subtitle)}</small></span>${icon("play")}</button>`).join("")}</div></section>`;
}
function demoBanner() {
  if (
    ["modscore-demo-basic-v1", "modscore-demo-basic-v2", "modscore-demo-basic-v3"].includes(
      project?.id || ""
    )
  )
    return `<section class="demo-banner"><p>${
      language === "tr"
        ? "Bu, önceki demo sürümü. 13–14. ölçüleri kayıtla karşılaştırılmış partisyon hazır; bu kayıttaki düzenlemelerin korunuyor."
        : "This is an earlier demo edition. The score with recording-checked measures 13–14 is available; your edits to this copy are preserved."
    }</p>${button(
      language === "tr" ? "Düzeltilmiş partisyonu aç" : "Open corrected score",
      "demo-basic",
      "primary"
    )}</section>`;
  const demo = demos.find((d) => d.id === project?.id);
  if (!demo) return "";
  return `<section class="demo-banner" id="demo-banner" data-playing="${
    audio.playing
  }"><div class="demo-intro"><div class="demo-bars" aria-hidden="true">${[
    0, 1, 2, 3, 4,
  ]
    .map((i) => `<i style="--i:${i}"></i>`)
    .join("")}</div><div><p class="eyebrow">${
    language === "tr" ? "ETKİLEŞİMLİ DEMO" : "INTERACTIVE DEMO"
  } · ${demo.bars} ${language === "tr" ? "ÖLÇÜ" : "MEASURES"}</p><strong>${e(
    demo.composer
  )}</strong><p class="fine">${e(
    language === "tr" ? demo.descriptionTr : demo.description
  )} <a href="${demo.source}" target="_blank" rel="noopener">${
    language === "tr" ? "Kaynak" : "Source"
  }</a>${
    demo.pdf
      ? ` · <a href="${assetPath(demo.pdf)}" target="_blank" rel="noopener">${
          language === "tr" ? "Kaynak nota PDF" : "Source score PDF"
        }</a>`
      : ""
  }</p></div></div><div class="demo-actions">${button(
    guideActive ? "Stop tour" : "Start guided demo",
    guideActive ? "demo-stop" : "demo-start",
    "primary"
  )}${button(
    demo.key === "basic" ? "Try Beethoven" : "Try Basic Music",
    demo.key === "basic" ? "demo-beethoven" : "demo-basic",
    "text-button"
  )}<label class="demo-select">${
    language === "tr" ? "Demo seç" : "Choose demo"
  }<select id="demo-select" aria-label="Choose demo">${demos
    .map(
      (d) =>
        `<option value="${d.key}" ${d.key === demo.key ? "selected" : ""}>${e(
          d.title
        )} · ${e(d.composer)}</option>`
    )
    .join("")}</select></label></div><div class="demo-features">${[
    ["demo-follow", "Score & piano"],
    ["demo-loop", "Loop 1–4"],
    ["demo-metronome", "Metronome"],
    ["demo-keyboard", "Keyboard"],
  ]
    .map(
      ([action, title], i) =>
        `<button data-action="${action}" data-guide-step="${i}" aria-pressed="${
          guideActive && guideStep === i
        }">${label(title)}</button>`
    )
    .join(
      ""
    )}</div><p class="demo-caption" id="demo-caption" aria-live="polite">${
    language === "tr"
      ? "Başlatın; nota, piyano, döngü ve metronomu birlikte deneyin."
      : "Start the tour to see the score, piano, loops and metronome work together."
  }</p></section>`;
}
function audioView() {
  return `<div class="page-heading"><div><p class="eyebrow">AUDIO TO PIANO / LOCAL AI</p><h1>${language === "tr" ? "Sesten piyano notalarına" : "Turn audio into piano"}</h1><p class="lede">${language === "tr" ? "Bir kayıt veya YouTube bağlantısından düzenlenebilir nota, MIDI ve piyano takibi oluşturun." : "Create editable notation, MIDI and piano playback from a recording or YouTube link."}</p></div></div><div class="audio-flow"><section class="panel audio-source"><h2>${language === "tr" ? "Müziği seç" : "Choose your music"}</h2><label class="audio-file-label">${language === "tr" ? "Ses dosyası" : "Audio file"}<input id="audio-file" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac"></label><p id="audio-file-name" class="fine">MP3, WAV, M4A, OGG, WebM · max. 40 MB</p><audio id="audio-preview" controls hidden aria-label="Source recording preview"></audio><div class="audio-divider">${language === "tr" ? "veya" : "or"}</div><label>YouTube<input id="youtube-url" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${e(audioSourceUrl)}"></label><p class="fine">${language === "tr" ? "YouTube için bilgisayarınızdaki ücretsiz yerel yardımcı kullanılır. Ses dosyaları doğrudan tarayıcıda işlenir." : "YouTube uses the free helper running on your computer. Audio files are processed directly in your browser."}</p><details><summary>${language === "tr" ? "YouTube yardımcısını bağla" : "Connect the YouTube helper"}</summary><p>${language === "tr" ? "Proje klasöründe terminal açıp aşağıdaki komutu çalıştırın; terminal açık kalsın." : "In a terminal inside the project folder, run this command and keep it open."}</p><pre><code>npm run youtube:helper</code></pre><p class="fine">${language === "tr" ? "yt-dlp veya uv kurulu olmalı. Tarayıcı sorarsa yerel ağ iznini verin." : "Install yt-dlp or uv first. If prompted by your browser, allow the local network connection."} <a href="https://github.com/WeAreTheArtMakers/modScore/blob/main/docs/AUDIO_YOUTUBE.md" target="_blank" rel="noopener">${language === "tr" ? "Kurulum kılavuzu" : "Setup guide"}</a></p></details></section><section class="panel audio-options"><h2>${language === "tr" ? "Piyano partisyonu" : "Piano score"}</h2><label>${language === "tr" ? "Başlık" : "Title"}<input id="audio-title" value="${e(audioTitle)}"></label>${audioControls({ ...audioSettings, bpm: audioBpm, bars: audioBars }, language === "tr")}<p class="fine">${language === "tr" ? "Önerilen BPM ve tonu kontrol edin. Temiz algılama zayıf/kısa sesleri azaltır; Ayrıntılı hızlı pasajları korur. Tek enstrümanlı, temiz kayıtlar daha iyi sonuç verir." : "Review the suggested BPM and key. Cleaner detection suppresses weak/short notes; Detailed keeps faster passages. Clean, single-instrument recordings work best."}</p>${button("Create piano score", "transcribe-audio", "primary wide")}${button("Try Basic Music", "demo-basic", "text-button")}<div id="audio-progress" role="status" aria-live="polite"></div><button data-action="cancel-audio" id="cancel-audio" hidden>${label("Cancel")}</button><p class="fine">${language === "tr" ? "Model: Spotify Basic Pitch · otomatik tahmin; perde, ritim ve akorları kayıtla karşılaştırın." : "Model: Spotify Basic Pitch · automatic estimates; compare pitches, rhythm and chords with the recording."}</p></section></div>`;
}
function syncPracticeUI() {
  const first = document.querySelector<HTMLInputElement>("#loop-start"),
    last = document.querySelector<HTMLInputElement>("#loop-end"),
    toggle = document.querySelector<HTMLInputElement>("#loop-on");
  if (first && document.activeElement !== first)
    first.value = String(loopStart);
  if (last && document.activeElement !== last) last.value = String(loopEnd);
  if (toggle) toggle.checked = !!audio.loop;
  const count = document.querySelector("#loop-status");
  if (count)
    count.textContent = `${language === "tr" ? "Ölçü" : "Measures"} ${loopStart}–${loopEnd} · ${loopEnd - loopStart + 1} ${language === "tr" ? "ölçü" : "bars"}`;
  const metro = document.querySelector<HTMLInputElement>("#metronome");
  if (metro) metro.checked = audio.metronome;
  const volume = document.querySelector<HTMLOutputElement>("#metronome-level");
  if (volume) volume.value = `${Math.round(audio.metronomeVolume * 100)}%`;
  document
    .querySelectorAll<HTMLElement>("[data-measure]")
    .forEach((n) =>
      n.classList.toggle(
        "in-loop",
        !!audio.loop &&
          Number(n.dataset.measure) >= loopStart - 1 &&
          Number(n.dataset.measure) < loopEnd,
      ),
    );
  const pick = document.querySelector<HTMLElement>('[data-action="pick-loop"]');
  pick?.setAttribute("aria-pressed", String(loopPicking));
}
function applyLoop(enabled: boolean) {
  if (!timeline) return;
  audio.setLoop(
    enabled
      ? [
          timeline.measures[loopStart - 1].beat,
          timeline.measures[loopEnd - 1].beat +
            timeline.measures[loopEnd - 1].duration,
        ]
      : undefined,
  );
  syncPracticeUI();
}
async function transcribeSource() {
  if (busy) throw Error("Finish or cancel the current operation first.");
  const url = (
    document.querySelector("#youtube-url") as HTMLInputElement
  ).value.trim();
  const title = (
    document.querySelector("#audio-title") as HTMLInputElement
  ).value.trim();
  let bpm = Number(
      (document.querySelector("#audio-bpm") as HTMLInputElement).value,
    ),
    bars = Number(
      (document.querySelector("#audio-bars") as HTMLSelectElement).value,
    );
  const selectedKey = (
    document.querySelector("#audio-key") as HTMLSelectElement
  ).value;
  const key = keyChoices.find((k) => `${k.fifths}:${k.mode}` === selectedKey);
  const meterValue = (
    document.querySelector("#audio-meter") as HTMLSelectElement
  ).value;
  const [beats, beatType] = meterValue.split("/").map(Number),
    meter = { beats, beatType };
  const grid = Number(
    (document.querySelector("#audio-grid") as HTMLSelectElement).value,
  );
  const profile = (
    document.querySelector("#audio-profile") as HTMLSelectElement
  ).value as AudioProfile;
  const start = Number(
    (document.querySelector("#audio-start") as HTMLInputElement).value,
  );
  const autoTempo = (
    document.querySelector("#audio-auto-tempo") as HTMLInputElement
  ).checked;
  const chordSuggestions = (
    document.querySelector("#audio-chords") as HTMLInputElement
  ).checked;
  if (
    !["4/4", "3/4", "6/8"].includes(meterValue) ||
    ![0.125, 0.25, 0.5].includes(grid) ||
    !["piano", "clean", "detailed"].includes(profile) ||
    !Number.isFinite(start) ||
    start < 0 ||
    start > 600 ||
    (selectedKey !== "auto" && !key)
  )
    throw Error("Choose valid audio settings.");
  Object.assign(audioSettings, {
    key: selectedKey,
    meter: meterValue,
    grid,
    profile,
    start,
    autoTempo,
    chords: chordSuggestions,
  });
  if (!(bpm >= 40 && bpm <= 240) || ![8, 16, 32, 64].includes(bars))
    throw Error("Choose a valid tempo and score length.");
  if (!audioFile && !url)
    throw Error("Choose an audio file or enter a YouTube link.");
  if (url) youtubeId(url);
  audioSourceUrl = url;
  audioTitle = title;
  audioBpm = bpm;
  audioBars = bars;
  audio.stop();
  busy = true;
  audioAbort = new AbortController();
  const signal = audioAbort.signal;
  const status = (text: string) => {
    const node = document.querySelector("#audio-progress");
    if (node) node.textContent = text;
  };
  const cancel = document.querySelector<HTMLButtonElement>("#cancel-audio");
  if (cancel) cancel.hidden = false;
  const submit = document.querySelector<HTMLButtonElement>(
    '[data-action="transcribe-audio"]',
  );
  if (submit) submit.disabled = true;
  try {
    let file = audioFile,
      reference = url;
    if (url && !file) {
      status(
        language === "tr"
          ? "Yerel YouTube yardımcısı hazırlanıyor…"
          : "Preparing the video with your local YouTube helper…",
      );
      let response: Response;
      try {
        response = await fetch("http://127.0.0.1:8790/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw e;
        throw Error(
          language === "tr"
            ? "Yerel yardımcıya bağlanılamadı. npm run youtube:helper ile başlatın ve yerel ağ iznini kontrol edin; veya ses dosyası seçin."
            : "Could not connect to the local helper. Start npm run youtube:helper and check local network permission, or choose an audio file.",
        );
      }
      if (!response.ok)
        throw Error(
          (await response.json()).error ||
            "The video could not be downloaded locally.",
        );
      const blob = await response.blob();
      file = new File(
        [blob],
        decodeURIComponent(
          response.headers.get("X-Modscore-Title") || "YouTube recording",
        ),
        { type: blob.type },
      );
    }
    if (!file) throw Error("No audio file");
    const { transcribeAudio } = await import("./audio-transcription");
    const notes = await transcribeAudio(file, {
      seconds: Math.min(
        180,
        (bars * ((beats * 4) / beatType) * 60) / (autoTempo ? 80 : bpm) + 15,
      ),
      start,
      profile,
      onTempo: autoTempo
        ? (value) => {
            bpm = value;
            audioBpm = value;
            const input =
              document.querySelector<HTMLInputElement>("#audio-bpm");
            if (input) input.value = String(value);
          }
        : undefined,
      signal,
      progress: (p) =>
        status(
          `${language === "tr" ? "Notalar okunuyor" : "Reading notes"} · ${Math.round(p * 100)}%`,
        ),
    });
    const { audioNotesToScore } = await import("./piano-score");
    const result = audioNotesToScore(notes, {
      title: title || file.name.replace(/\.[^.]+$/, ""),
      bpm,
      bars,
      key,
      meter,
      grid,
      chordSuggestions,
    });
    const p: Project = {
      id: crypto.randomUUID(),
      title: title || file.name.replace(/\.[^.]+$/, ""),
      xml: result.xml,
      performance: {
        notes: result.performance
          .filter((n) => n.beat < (bars * beats * 4) / beatType)
          .map((n) => ({
            ...n,
            duration: Math.min(
              n.duration,
              (bars * beats * 4) / beatType - n.beat,
            ),
          })),
        bpm,
        key: result.key,
        sourceStart: start + result.offset,
        grid,
        meter,
      },
      pages: [],
      originals: [file],
      created: Date.now(),
      updated: Date.now(),
      reviewed: false,
      reference: reference
        ? {
            url: `https://www.youtube.com/watch?v=${youtubeId(reference)}`,
            title: file.name,
          }
        : undefined,
    };
    await saveScore(p);
    busy = false;
    await openProject(p);
    toast(
      language === "tr"
        ? "Otomatik transkripsiyon hazır. Notaları kayıtla karşılaştırın; Export ile MIDI indirin."
        : "Transcription ready. Compare the notes with the recording; use Export to download MIDI.",
    );
  } finally {
    busy = false;
    audioAbort = undefined;
    if (cancel?.isConnected) cancel.hidden = true;
    if (submit?.isConnected) submit.disabled = false;
  }
}

function home() {
  return `<section class="intro"><p class="eyebrow">SCAN. LISTEN. LEARN.</p><h1>${label("Your music, in motion.")}</h1><p class="lede">${label("Turn printed music into something you can hear, see, and learn. All on your device.")}</p><div class="entry-cards"><button class="entry-card primary" data-action="capture"><span class="entry-icon">${icon("scan")}</span><strong>${label("Scan sheet music")}</strong><span>${label("Camera")}</span><span class="card-end">${icon("plus")}</span></button><button class="entry-card" data-action="import"><span class="entry-icon">${icon("import")}</span><strong>${label("Import score")}</strong><span>${label("Image, PDF, MusicXML or MIDI")}</span><span class="card-end">${icon("plus")}</span></button></div><p class="privacy-note">${icon("shield")}${label("No uploads. No accounts. Yours.")}</p></section>${demoCards()}<section class="library-section"><div class="section-heading"><h2>${label("Local library")}</h2>${button("My scores", "library", "text-button")}</div><div class="score-list">${rows(library.slice(0, 4))}</div><button class="text-button test-study" data-action="study">${label("Original test score (CC0)")}</button></section>`;
}
function libraryView() {
  return `<div class="page-heading"><div><p class="eyebrow">LOCAL / PRIVATE</p><h1>${label("My scores")}</h1></div>${button("Import score", "import", "primary", "plus")}</div><label class="search">${icon("search")}<input id="search" placeholder="${label("Search your scores")}" aria-label="${label("Search your scores")}"></label><div id="library-list" class="score-list">${rows(library)}</div><p class="muted">${label("Storage is not a backup. Export your projects regularly.")}</p>`;
}
function scanView() {
  const url = pages[pageIndex] ? URL.createObjectURL(pages[pageIndex]) : "";
  if (url) urls.push(url);
  return `<div class="page-heading"><div><p class="eyebrow">ON-DEVICE OMR / CPU WASM</p><h1>${label("Scan sheet music")}</h1></div>${button("Add pages", "add-pages", "", "plus")}</div><div class="scan-layout"><div class="scan-preview">${url ? `<img src="${url}" alt="Score page ${pageIndex + 1}">` : `<div class="empty">${icon("scan")}<p>${label("Select a page to review before recognition.")}</p>${button("Camera", "capture", "primary", "scan")}${button("Import score", "add-pages", "", "import")}</div>`}</div><div class="scan-tools panel"><label>Title<input id="scan-title" value="${e(scanName)}" placeholder="Untitled score" ${busy ? "disabled" : ""}></label><div class="page-strip">${pages.map((_, i) => `<button data-page="${i}" class="${i === pageIndex ? "selected" : ""}" ${busy ? "disabled" : ""}>${i + 1}${i < scanXml.length ? " ✓" : ""}</button>`).join("")}</div><p class="muted">${label("Select a page to review before recognition.")}</p><div class="row">${button("Rotate", "rotate")}${button("Delete", "remove-page", "danger")}</div><label>${label("Deskew (degrees)")}<input id="deskew" type="number" min="-15" max="15" value="0" step="0.5"></label><label>${label("Crop left / top / right / bottom (%)")}</label><div class="crop-inputs">${[0, 0, 100, 100].map((v, i) => `<input id="crop-${i}" aria-label="${["Left", "Top", "Right", "Bottom"][i]} percent" type="number" min="0" max="100" value="${v}">`).join("")}</div><label class="check-label"><input id="enhance" type="checkbox">${label("Enhance contrast")}</label>${button("Apply to page", "apply-page")}<hr><p class="fine">${editText("Recognition checks the page angle and contrast automatically. Crop the page or adjust rotation if the preview is hard to read.", "Tanıma sırasında sayfa açısı ve kontrast otomatik kontrol edilir. Önizleme zor okunuyorsa sayfayı kırp veya açısını düzelt.")}</p><p class="fine">${language === "tr" ? "İlk kullanımda yaklaşık 158 MB model indirilir. Tanıma yereldir." : "First use downloads about 158 MB of models. Recognition stays on this device."}</p><div id="scan-status" class="status-text" role="status" aria-live="polite">${e(status)}</div>${busy ? `<progress aria-label="Recognition in progress"></progress>${button("Cancel", "cancel-scan", "danger")}` : button("Recognize locally", "recognize", "primary wide", "scan")}<p class="fine">${scanXml.length} / ${pages.length} pages recognized. ${scanXml.length ? button("Export", "export-progress", "text-button") : ""}</p></div></div>`;
}
function voiceControls() {
  if (!timeline) return "";
  const keys = [...new Set(timeline.notes.map((n) => audio.voiceKey(n)))];
  return `<details class="mixer"><summary>Tracks & voices · ${keys.length}</summary><div class="voice-grid">${keys
    .map((key, i) => {
      const n = timeline!.notes.find((n) => audio.voiceKey(n) === key)!;
      const state = audio.voices.get(key);
      return `<div class="voice-row"><label class="voice-color"><input type="color" data-color="${e(key)}" value="${colors[i % colors.length]}" aria-label="Voice color"></label><span>${e(timeline!.tracks.find((t) => t.id === n.track)?.name || n.track)} · staff ${n.staff} · voice ${e(n.voice)}</span><label><input data-mute="${e(key)}" type="checkbox" ${state?.mute ? "checked" : ""}>${label("Mute")}</label><label><input data-solo="${e(key)}" type="checkbox" ${state?.solo ? "checked" : ""}>${label("Solo")}</label></div>`;
    })
    .join(
      "",
    )}</div><p class="fine">Staff/voice labels come from MusicXML. Staff 1/2 are not guaranteed to mean right/left hand.</p></details>`;
}
function playerView(pianoOnly = false) {
  return `<div class="player-heading"><div><p class="eyebrow">${pianoOnly ? "INSTRUMENT / A0–C8" : project?.pages.length ? "RECOGNIZED SCORE" : "MUSIC WORKSPACE"}</p><h1>${e(pianoOnly ? t("Virtual piano") : project?.title || t("Workspace"))}</h1><p class="score-meta">${timeline && !pianoOnly ? `${timeline.writtenMeasures ?? timeline.measures.length} measures${timeline.writtenMeasures ? " · repeats included" : ""} · ${timeline.writtenMeasures ? new Set(timeline.notes.map((n) => n.source.join(","))).size : timeline.notes.length} notes · ${label(project?.reviewed ? "Saved on this device" : "Review required")}` : label("No uploads. No accounts. Yours.")}</p></div><div class="row">${project ? button("Export", "export", "", "download") : ""}${button("Fullscreen", "fullscreen", "text-button")}</div></div>${!pianoOnly && timeline ? demoBanner() : ""}${!pianoOnly && timeline ? comparisonPanel() : ""}${!pianoOnly && timeline ? `<div class="workspace-tabs" role="tablist">${["score", "compare", "original", "editor"].map((m) => `<button role="tab" aria-selected="${mode === m}" data-mode="${m}" class="${mode === m ? "selected" : ""}">${label(m === "score" ? "Score" : m === "compare" ? "Compare" : m === "original" ? "Original" : "Review notes")}</button>`).join("")}<span class="review-count">${timeline.warnings.length ? `${timeline.warnings.length} review notes` : "Review recognition before practice"}</span></div>${timeline.warnings.length ? `<details class="warnings"><summary>${timeline.warnings.length} playback / recognition notices</summary><ul>${timeline.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></details>` : ""}${reviewPanel()}${scoreToolbar()}<div class="score-workspace">${mode === "editor" ? editor() : mode === "original" ? originalView() : mode === "compare" ? `<div class="score-compare"><section><h3>${label("Original")}</h3>${originalView()}</section><section><h3>${label("Score")}</h3><div id="notation" class="notation"></div></section></div>` : `<div id="notation" class="notation" aria-label="Reconstructed sheet music"></div>`}</div><div class="measure-navigation"><span>${label("Select measures below to seek.")}</span><button class="text-button" data-action="pick-loop" aria-pressed="${loopPicking}">${language === "tr" ? "Döngü aralığı seç" : "Select loop range"}</button><div class="measure-strip">${measureButtons()}</div></div>${voiceControls()}` : pianoOnly ? "" : `<div class="empty">${icon("music")}<p>${label("Open a score to start listening.")}</p>${button("Import score", "import", "primary")}</div>`}<div class="instrument-strip"><label>${label("Instrument")}<select id="instrument" aria-label="${label("Instrument")}">${instrumentNames.map((n, i) => `<option value="${i}" ${i === audio.instruments.program ? "selected" : ""}>${String(i + 1).padStart(3, "0")} · ${n.replaceAll("_", " ")}</option>`).join("")}</select></label><label>${label("Transpose")}<input id="transpose" type="number" value="${audio.transpose}" min="-24" max="24"></label><label>${label("Volume")}<input id="volume" type="range" value="${audio.volume}" min="0" max="1" step="0.01"></label><div class="piano-mode">${button(roll ? "Keyboard" : "Piano roll", "toggle-roll", "text-button")}${button("Zoom", "zoom", "text-button")}</div></div>${keyboardControls()}<div id="piano" class="piano-scroll"></div><div class="keyboard-meta"><span>A0 — C8 · 88 keys</span><span id="active-names" aria-live="off"></span><label><input id="auto-keys" type="checkbox" ${auto ? "checked" : ""}>${label("Auto-position keys")}</label></div>${!pianoOnly ? transport()+expressionPanel() : ""}`;
}
type MeasureReview = {
  index: number;
  number: string;
  page: number;
  reasons: string[];
  issue: boolean;
};
let reviewCache: { xml: string; rows: Map<number, MeasureReview> } | undefined;
function measureReviews() {
  if (!project || !timeline || (!project.pages.length && !project.performance &&
    !project.xml.includes("Automatic audio transcription"))) return undefined;
  if (reviewCache?.xml === project.xml) return reviewCache.rows;
  const rows = new Map<number, MeasureReview>();
  const measures = writtenMeasures();
  const written = new Map(measures.map((m) => [m.sourceMeasure ?? m.index, m]));
  const mark = (m: Measure, reasons: string[], issue = false) => {
    const index = m.sourceMeasure ?? m.index;
    const row = rows.get(index) ?? { index: m.index, number: m.number, page: m.page, reasons: [], issue: false };
    row.reasons = [...new Set([...row.reasons, ...reasons])];
    row.issue ||= issue;
    rows.set(index, row);
  };
  for (const r of reviewEncoding(project.xml)) {
    const m = written.get(r.index);
    if (!m) continue;
    const reasons = [
      ...r.issues,
      ...(r.shortNotes >= 4 ? [editText("Short notes", "Kısa notalar")] : []),
      ...(r.tuplets ? [editText("Tuplets", "Üçleme ve bölünmüş ritimler")] : []),
      ...(r.cluster >= 3 ? [editText("Stacked chord tones", "Üst üste akor sesleri")] : []),
    ];
    if (reasons.length) mark(m, reasons, r.issues.length > 0);
  }
  const transitions = measures.flatMap((m, index) => {
    const preceding = index > 0 ? measures[index - 1] : undefined;
    return preceding && preceding.page !== m.page && Math.abs(preceding.beat + preceding.duration - m.beat) < 1e-6
      ? [{ preceding, m }] : [];
  });
  if (transitions.length) {
    const notes = new Map<number, Note[]>();
    for (const note of timeline.notes) {
      const group = notes.get(note.measure) ?? [];
      group.push(note);
      notes.set(note.measure, group);
    }
    const voicePitch = (note: Note) => `${note.track}:${note.staff}:${note.voice}:${note.pitch}`;
    for (const { preceding, m } of transitions) {
      const ending = new Set((notes.get(preceding.index) ?? [])
        .filter((note) => Math.abs(note.beat + note.duration - m.beat) < 1e-6).map(voicePitch));
      if (!(notes.get(m.index) ?? []).some((note) =>
        Math.abs(note.beat - m.beat) < 1e-6 && ending.has(voicePitch(note)))) continue;
      const reason = editText("Check ties across the page break", "Sayfa geçişindeki uzatma bağlarını kontrol et");
      mark(preceding, [reason]);
      mark(m, [reason]);
    }
  }
  reviewCache = { xml: project.xml, rows };
  return rows;
}
function measureButtons() {
  const flags = measureReviews();
  return timeline?.measures.map((m) => {
    const flagged = flags?.get(m.sourceMeasure ?? m.index);
    const title = flagged ? `${editText("Review measure", "Ölçüyü incele")} ${m.number}: ${flagged.reasons.join(" · ")}` :
      `${editText("Seek to measure", "Ölçüye git")} ${m.number}`;
    return `<button data-measure="${m.index}" class="${flagged ? "measure-review-mark" : ""}" title="${e(title)}" ${flagged ? `aria-label="${e(title)}"` : ""}>${e(m.number)}</button>`;
  }).join("") ?? "";
}

function reviewPanel() {
  const flags = measureReviews();
  if (!flags?.size) return "";
  const rows = [...flags.values()].sort((a, b) => a.index - b.index);
  const count = rows.filter((row) => row.issue).length;
  const summary = editText("Measures to review", "İncelenecek ölçüler");
  return `<details class="encoding-review">
    <summary>${summary} · ${rows.length}</summary>
    <p>${editText("Timing notices and notation cues help you choose where to compare with the original.", "Zamanlama uyarıları ve nota işaretleri orijinalle karşılaştırılacak ölçüleri gösterir.")}</p>
    <div class="audit-scroll"><table><thead><tr>
      <th>${editText("Measure", "Ölçü")}</th>
      <th>${editText("Source page", "Kaynak sayfa")}</th>
      <th>${editText("Review cues", "İnceleme işaretleri")}</th>
    </tr></thead><tbody>${rows.map((row) => `<tr>
      <td><button class="text-button" data-review-measure="${row.index}">${e(row.number)}</button></td>
      <td>${project?.pages.length ? row.page + 1 : "–"}</td>
      <td>${row.reasons.map(e).join("<br>")}</td>
    </tr>`).join("")}</tbody></table></div>
    ${count ? `<p class="fine">${count} ${editText("measures have a structural timing notice.", "ölçüde yapısal zamanlama uyarısı var.")}</p>` : ""}
  </details>`;
}
function alignmentPanel(p: Project, recording: boolean) {
  if (!timeline || !recording) return "";
  const points = p.sourceAlignment?.points ?? [];
  const current = [...timeline.measures].reverse().find((m) => m.beat <= comparison.anchor);
  return `<fieldset class="source-marks">
    <legend>${editText("Recording alignment points", "Kayıt hizalama noktaları")}</legend>
    <p class="fine">${editText("Set where a measure starts in the recording. Mark repeat visits separately.", "Ölçünün kayıtta başladığı saniyeyi yaz. Tekrar geçişlerini ayrı işaretle.")}</p>
    <div class="comparison-alignment">
      <label>${editText("Measure start", "Ölçü başlangıcı")}<select id="mark-measure">
        ${timeline.measures.map((m) => `<option value="${m.index}" ${current?.index === m.index ? "selected" : ""}>${e(m.number)}</option>`).join("")}
      </select></label>
      <label>${editText("Recording second", "Kayıttaki saniye")}<input id="mark-seconds" type="number" min="0" step="0.001"></label>
    </div>
    <div class="row source-mark-actions">
      ${button(editText("Use current recording time", "Kayıttaki mevcut konumu al"), "mark-recording-time")}
      ${button(editText("Save alignment point", "Hizalama noktasını kaydet"), "save-alignment-point", "primary")}
    </div>
    ${points.length ? `<ul class="source-mark-list">${points.map((point) => `<li><span>${editText("Measure", "Ölçü")} ${e(timeline!.measures[point.measure]?.number ?? String(point.measure + 1))} · ${point.seconds.toFixed(3)} s</span><button class="text-button" data-remove-mark="${point.measure}">${editText("Remove point", "Noktayı kaldır")}</button></li>`).join("")}</ul>` : ""}
  </fieldset>`;
}

function comparisonPanel() {
  if (!project || !timeline) return "";
  const blob = project.originals.find((b) => b.type.startsWith("audio/"));
  const url = blob ? URL.createObjectURL(blob) : "";
  if (url) urls.push(url);
  const tr = language === "tr";
  const offset = project.sourceAlignment?.offset ?? project.performance?.sourceStart ?? 0;
  const bpm = project.sourceAlignment?.bpm ?? project.performance?.bpm;
  const demo = project.id === "modscore-demo-basic-v4";
  return `<section class="source-comparison panel" id="source-comparison">
    <div class="section-heading"><strong>${tr ? "Kaynak ↔ Piyano" : "Source ↔ Piano"}</strong><output id="ab-position"></output></div>
    ${blob ? `<div class="comparison-actions">
      ${demo ? button(tr ? "13–14. ölçülere git" : "Review measures 13–14", "ab-passage", "text-button") : ""}
      ${button(tr ? "Buradan karşılaştır" : "Compare from here", "ab-here", "text-button")}
      ${button(tr ? "A · Kaydı dinle" : "A · Listen to source", "ab-source")}
      ${button(tr ? "B · Piyanoyu dinle" : "B · Listen to piano", "ab-piano")}
      ${button(tr ? "Durdur" : "Pause comparison", "ab-pause", "text-button")}
    </div><audio id="original-audio" controls src="${url}" preload="metadata"></audio>` :
    `<p class="fine">${tr ? "Aynı nota konumundan karşılaştırmak için bir kayıt ekleyin." : "Attach a recording to compare from the same score position."}</p>${demo ? button(tr ? "Demo kaydını yükle" : "Load demo recording", "ab-load-demo") : ""}`}
    <details id="alignment-details" ${showAlignment ? "open" : ""}>
      <summary>${tr ? "Kaydı bağla ve hizala" : "Attach and align recording"}</summary>
      <div class="comparison-alignment">
        <label>${tr ? "Ses dosyası" : "Recording"}<input id="comparison-file" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"></label>
        <label>${tr ? "İlk nota (saniye)" : "First score beat (seconds)"}<input id="source-offset" type="number" min="-3600" max="3600" step="0.001" value="${offset}"></label>
        <label>${tr ? "Kayıt BPM (isteğe bağlı)" : "Recording BPM (optional)"}<input id="source-bpm" type="number" min="20" max="300" value="${bpm ?? ""}" placeholder="Score tempo"></label>
      </div>
      <p class="fine">${tr ? "İki düğme de seçilen konumu kullanır. Hizalama noktaları arasındaki konumlar hesaplanır." : "Both buttons use the selected position. Positions between saved points are interpolated."}</p>
      ${alignmentPanel(project, !!blob)}
    </details>
  </section>`;
}
function expressionPanel(){const tr=language==="tr";return `<details class="expression-settings panel"><summary>${tr?"Süsleme ve ifade çalımı":"Ornaments & expression"}</summary><div class="comparison-alignment"><label>${tr?"Yorum":"Interpretation"}<select id="expression-style"><option value="auto" ${expressionSettings.style==="auto"?"selected":""}>${tr?"Besteciye göre":"Follow composer"}</option><option value="baroque" ${expressionSettings.style==="baroque"?"selected":""}>Baroque</option><option value="classical" ${expressionSettings.style==="classical"?"selected":""}>Classical</option><option value="literal" ${expressionSettings.style==="literal"?"selected":""}>${tr?"Yalın ana notalar":"Literal principal notes"}</option></select></label><label>${tr?"Fermata uzatma":"Fermata stretch"}<input id="fermata-stretch" type="number" min="1" max="2.5" step="0.05" value="${expressionSettings.fermata}"></label></div><p class="fine">${tr?"Tril ve mordentler tona/değiştiricilere göre, arpejler işaretin yönünde çalınır. Barok yorumda belirtilmemiş triller üst komşudan; klasik yorumda ana notadan başlar. Yorum icracı ve edisyona göre değişebilir. Aynı yorum piyano, MIDI ve WAV için kullanılır.":"Trills/mordents follow the key and explicit accidentals; arpeggios follow their marked direction. Unspecified trills start above in Baroque and on the main note in Classical. Interpretations vary by performer and edition. Piano, MIDI and WAV use the same realization."}</p></details>`;}
function originalView() {
  if (project && !project.pages.length) {
    const audio = project.originals.find((b) => b.type.startsWith("audio/"));
    if (audio) {
      return `<div class="audio-original"><p>${language==="tr"?"Özgün kaydı yukarıdaki Kaynak ↔ Piyano panelinden aynı noktadan dinleyebilirsiniz.":"Use Source ↔ Piano above to listen to the recording and piano from the same point."}</p>${project.reference?`<a href="${e(project.reference.url)}" target="_blank" rel="noopener">${e(project.reference.title)}</a>`:""}</div>`;
    }
  }
  return project?.pages.length
    ? `<div class="original-pages">${project.pages
        .map((p, i) => {
          const url = URL.createObjectURL(p);
          urls.push(url);
          return `<figure><img src="${url}" alt="Original page ${i + 1}"><figcaption>Page ${i + 1}</figcaption></figure>`;
        })
        .join("")}</div>`
    : `<div class="empty">No original images for this imported score.</div>`;
}
async function drawSourceExcerpt() {
  if (!project || !timeline) return;
  const note =
    timeline.notes[Math.min(selectedNote, timeline.notes.length - 1)];
  if (!note) return;
  const source = xmlDocument(project.xml).querySelectorAll(
    "part > measure > note",
  )[note?.source[0]];
  const position = source && sourceLocation(source);
  const pageNumber = timeline.measures[note?.measure]?.page ?? 0;
  const image = project.pages[pageNumber];
  const canvas = document.querySelector<HTMLCanvasElement>("#source-canvas");
  const figure = document.querySelector<HTMLElement>("#source-excerpt");
  if (!image || !position || !canvas || !figure) return;
  const bitmap = await createImageBitmap(image);
  try {
    if (!canvas.isConnected) return;
    const unit = (position.box[3] - position.box[1]) / 4;
    const left = Math.max(0, position.x - 10 * unit),
      right = Math.min(bitmap.width, position.x + 10 * unit);
    const top = Math.max(0, position.box[1] - 5 * unit),
      bottom = Math.min(bitmap.height, position.box[3] + 5 * unit);
    if (right <= left || bottom <= top) return;
    const scale = Math.min(3, 900 / (right - left));
    canvas.width = Math.round((right - left) * scale);
    canvas.height = Math.round((bottom - top) * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(
      bitmap,
      left,
      top,
      right - left,
      bottom - top,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    ctx.strokeStyle = "#3770cc";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    const x = (position.x - left) * scale;
    ctx.strokeRect(
      Math.max(0, x - unit * scale),
      0,
      2 * unit * scale,
      canvas.height,
    );
    figure.hidden = false;
    figure.querySelector("figcaption")!.textContent =
      `Original · page ${pageNumber + 1} · approximate model position`;
  } finally {
    bitmap.close();
  }
}
const rhythms = [
  [4, "Whole", "Birlik"], [2, "Half", "İkilik"], [1, "Quarter", "Dörtlük"],
  [0.5, "Eighth", "Sekizlik"], [0.25, "16th", "Onaltılık"],
  [0.125, "32nd", "Otuzikilik"], [0.0625, "64th", "Altmışdörtlük"],
  [0.03125, "128th", "Yüzyirmisekizlik"], [1.5, "Dotted quarter", "Noktalı dörtlük"],
  [0.75, "Dotted eighth", "Noktalı sekizlik"], [1 / 3, "Eighth triplet", "Sekizlik üçleme"],
  [1 / 6, "16th triplet", "Onaltılık üçleme"], [1 / 12, "32nd triplet", "Otuzikilik üçleme"],
] as const;
const editText = (en: string, tr: string) => language === "tr" ? tr : en;
const rhythmOptions = (duration: number) => rhythms.map(([value, en, tr]) =>
  `<option value="${value}" ${value === duration ? "selected" : ""}>${editText(en, tr)}</option>`,
).join("");
const writtenMeasures = () => timeline?.measures.filter((m) => (m.pass ?? 1) === 1) ?? [];
const quarterBeatsPerPulse = (measure: Measure) =>
  4 / (measure.meter?.beatType || 4);
const selectedScoreNote = () => timeline?.notes[selectedNote];

function selectEditorMeasure(index: number) {
  const measure = timeline?.measures[index];
  if (!timeline || !measure) return;
  editorMeasure = measure.sourceMeasure ?? measure.index;
  const written = writtenMeasures().find((m) => (m.sourceMeasure ?? m.index) === editorMeasure);
  const note = timeline.notes.findIndex((n) => n.measure === written?.index);
  selectedNote = note;
}

function pitchPalette(
  id: string, step = "C", octave = 4, alter: number | "keep" | "key" = "key",
) {
  const names = editText("C D E F G A B", "Do Re Mi Fa Sol La Si").split(" ");
  const accidentals = [
    ["key", "Key signature", "Donanıma göre"], ["0", "♮ Natural", "♮ Natürel"],
    ["1", "♯ Sharp", "♯ Diyez"], ["-1", "♭ Flat", "♭ Bemol"],
    ["2", "𝄪 Double sharp", "𝄪 Çift diyez"], ["-2", "𝄫 Double flat", "𝄫 Çift bemol"],
  ];
  if (id !== "add") accidentals.unshift(["keep", "Keep as written", "Mevcut işaret"]);
  return `<div class="note-palette">
    <label>${editText("Note name", "Nota adı")}<select id="${id}-step">${noteLetters.map((name, i) => `<option value="${name}" ${name === step ? "selected" : ""}>${names[i]}</option>`).join("")}</select></label>
    <label>${editText("Octave", "Oktav")}<input id="${id}-octave" type="number" min="0" max="9" step="1" value="${octave}"></label>
    <label>${editText("Accidental", "Değiştirici")}<select id="${id}-accidental">${accidentals.map(([value, en, tr]) => `<option value="${value}" ${value === String(alter) ? "selected" : ""}>${editText(en, tr)}</option>`).join("")}</select></label>
  </div>`;
}

function addNoteFields(doc: Document, measureIndex: number, note?: Note) {
  const targets = insertionTargets(doc, measureIndex);
  const names = new Map(timeline!.tracks.map((track) => [track.id, track.name]));
  const initial = targets.findIndex((target) => target.part === note?.track &&
    target.staff === note.staff && target.voice === note.voice);
  return targets.map((target, i) => `<option value="${e(JSON.stringify(target))}" ${i === initial ? "selected" : ""}>${e(names.get(target.part) ?? target.part)} · ${editText("Staff", "Dizek")} ${target.staff} · ${editText("Voice", "Ses")} ${e(target.voice)}</option>`).join("");
}

function historyButtons() {
  const history = project?.editHistory;
  return [
    historyTarget(history, "undo") ?
      button(editText("Undo last note edit", "Son nota düzenlemesini geri al"), "undo-note") : "",
    historyTarget(history, "redo") ?
      button(editText("Redo note edit", "Nota düzenlemesini yinele"), "redo-note") : "",
  ].join("");
}

function scoreToolbar() {
  if (!project || !timeline || view !== "player" || (mode !== "score" && mode !== "compare")) return "";
  return `<div class="score-edit-toolbar">
    <button data-action="toggle-score-edit" aria-pressed="${editOnScore}">${editText("Edit on score", "Partisyon üzerinde düzenle")}</button>
    ${historyButtons()}
    <div id="score-note-inspector"></div>
  </div>`;
}

function paintScoreNote() {
  const inspector = document.getElementById("score-note-inspector");
  if (!inspector || !editOnScore || !project) return;
  const note = selectedHead === undefined ? undefined : selectedScoreNote();
  const node = note ? xmlDocument(project.xml).querySelectorAll("part > measure > note")[note.source[0]] : undefined;
  if (!node || !note) {
    inspector.innerHTML = `<p class="fine">${editText("Select a notehead to hear and edit it.", "Dinlemek ve düzenlemek için nota başını seç.")}</p>`;
    return;
  }
  const pitch = readWrittenPitch(node);
  inspector.innerHTML = `<div class="inline-score-note">
    <div class="inline-note-pitch">${pitchPalette("inline", pitch.step, pitch.octave, "keep")}</div>
    <div class="row">${button(editText("Hear note", "Notayı dinle"), "hear-note")}
    ${button(editText("Save pitch", "Perdeyi kaydet"), "save-inline-note", "primary")}
    ${button(editText("Delete note", "Notayı sil"), "delete-inline-note", "danger")}</div>
  </div>`;
}

function cancelPreview() {
  previewRequest++;
  stopPreview?.();
  stopPreview = undefined;
}
async function auditionNote(note: Note) {
  cancelPreview();
  comparison.pause();
  audio.pause();
  const pitch = note.pitch + audio.transpose;
  if (pitch < 0 || pitch > 127) return;
  const request = previewRequest;
  const stop = await audio.touch(pitch, note.velocity);
  if (request !== previewRequest) return stop();
  stopPreview = stop;
  window.setTimeout(() => {
    if (request === previewRequest) cancelPreview();
  }, 420);
}
sheet.onSelect = (source) => {
  if (!editOnScore || !timeline || editSaving) return;
  const index = timeline.notes.findIndex((note) => note.source.includes(source));
  if (index < 0) return;
  selectedNote = index;
  selectedHead = source;
  sheet.onManualBrowse();
  sheet.setEditing(true, source);
  paintScoreNote();
  safe(() => auditionNote(timeline!.notes[index]))();
};

function editor() {
  if (!timeline || !project) return "";
  const doc = xmlDocument(project.xml);
  const n = selectedScoreNote();
  const measures = writtenMeasures();
  const selectedMeasure = measures.find((m) =>
    (m.sourceMeasure ?? m.index) === editorMeasure,
  ) ?? measures.find((m) => m.index === n?.measure) ?? measures[0];
  const measureIndex = selectedMeasure ? selectedMeasure.sourceMeasure ?? selectedMeasure.index : 0;
  const noteNodes = doc.querySelectorAll("part > measure > note");
  const pitch = n ? readWrittenPitch(noteNodes[n.source[0]]) : undefined;
  const seen = new Set<number>();
  const notes = timeline.notes.flatMap((note, i) => {
    if (seen.has(note.source[0])) return [];
    seen.add(note.source[0]);
    const m = timeline!.measures[note.measure];
    const written = readWrittenPitch(noteNodes[note.source[0]]);
    const symbol = ({[-2]: "𝄫", [-1]: "♭", 0: "", 1: "♯", 2: "𝄪"})[written.alter] ?? "";
    return [`<option value="${i}" ${i === selectedNote ? "selected" : ""}>${editText("Measure", "Ölçü")} ${e(m.number)} · ${e(written.step)}${symbol}${written.octave} · ${editText("staff", "dizek")} ${note.staff} / ${editText("voice", "ses")} ${e(note.voice)} · ${+(note.beat - m.beat + 1).toFixed(4)}</option>`];
  }).join("");
  return `<div class="editor"><div class="note-editor-controls">
    <h2>${editText("Edit notes", "Nota düzenle")}</h2>
    ${n && pitch ? `
      <label>${editText("Select note", "Nota seç")}<select id="edit-select">${notes}</select></label>
      ${pitchPalette("edit", pitch.step, pitch.octave, pitch.accidental === accidentalNames[pitch.alter] ? pitch.alter : "keep")}
      <details class="note-editor-detail"><summary>${editText("MIDI pitch and timing", "MIDI perdesi ve zamanlama")}</summary>
        <div class="edit-fields">
          <label>${label("Pitch")}<select id="edit-pitch">${Array.from({ length: 128 }, (_, p) => `<option value="${p}" ${p === n.pitch ? "selected" : ""}>${noteName(p)} · MIDI ${p}</option>`).join("")}</select></label>
          <label>${editText("Rhythm preset", "Ritim kalıbı")}<select id="edit-rhythm"><option value="">${editText("Keep encoded rhythm", "Mevcut ritmi koru")}</option>${rhythmOptions(0)}</select></label>
          <label>${label("Duration (beats)")}<input id="edit-duration" type="number" min="0.00390625" step="any" value="${n.duration}"></label>
          <label>${label("Start (beats)")}<input id="edit-onset" type="number" min="0" step="any" value="${n.beat}"></label>
        </div>
        <p class="fine">${editText("Changing duration moves later notes in the same voice. Moving a chord requires selecting its leading note.", "Süreyi değiştirmek aynı sesteki sonraki notaları kaydırır. Akorun yerini değiştirmek için ilk akor sesini seç.")}</p>
        <div class="row">${button("Tie to next note", "tie-next")}${button("Remove tie", "untie")}</div>
      </details>
      <div class="row note-editor-actions">
        ${button(editText("Apply correction", "Düzeltmeyi uygula"), "correct", "primary")}
        ${button(editText("Delete note", "Notayı sil"), "delete-note", "danger")}
      </div>` : `<p>${editText("This score has no playable notes. Use the palette to add one.", "Bu partide çalınabilir nota yok. Paletten nota ekleyebilirsin.")}</p>`}
    ${measures.length ? `<details class="note-editor-detail" id="add-note-panel" ${n ? "" : "open"}>
      <summary>${editText("Add a note", "Nota ekle")}</summary>
      <div class="edit-fields">
        <label>${editText("Measure", "Ölçü")}<select id="add-measure">${measures.map((m) => `<option value="${m.sourceMeasure ?? m.index}" ${m === selectedMeasure ? "selected" : ""}>${e(m.number)}</option>`).join("")}</select></label>
        <label>${editText("Part, staff and voice", "Parti, dizek ve ses")}<select id="add-target">${addNoteFields(doc, measureIndex, n)}</select></label>
        <label>${editText("Beat in measure", "Ölçü içindeki vuruş")}<input id="add-beat" type="number" min="1" step="any" value="${n && selectedMeasure?.index === n.measure ? +((n.beat - selectedMeasure.beat) / quarterBeatsPerPulse(selectedMeasure) + 1).toFixed(8) : 1}"></label>
        <label>${editText("Duration", "Süre")}<select id="add-duration">${rhythmOptions(1)}</select></label>
      </div>
      ${pitchPalette("add", pitch?.step ?? "C", pitch?.octave ?? 4)}
      <p class="fine">${editText("Beat 1 starts the measure. Beat units follow its time signature. Matching timing adds a chord tone. Other overlaps use a separate voice.", "1, ölçünün başlangıcıdır. Vuruş birimi ölçü işaretine bağlıdır. Başlangıcı ve süresi eşleşen nota akora katılır. Diğer çakışmalar ayrı sese yazılır.")}</p>
      ${button(editText("Insert note", "Notayı yerleştir"), "add-note", "primary")}
    </details>` : ""}
    <div class="row note-editor-actions">
      ${historyButtons()}
      ${button("Mark reviewed", "reviewed")}
    </div>
    <details class="note-editor-detail"><summary>${editText("Score tempo", "Partisyon temposu")}</summary>
      <div class="edit-fields">
        <label>Score tempo (BPM)<input id="score-tempo" type="number" min="20" max="300" value="${timeline.tempos[0].bpm}"></label>
        <label>${editText("Tempo instruction", "Tempo ifadesi")}<input id="tempo-words" placeholder="Slowly, steady tempo"></label>
      </div>${button("Save score tempo", "save-tempo")}
    </details>
  </div><div class="review-original"><figure id="source-excerpt" hidden><canvas id="source-canvas"></canvas><figcaption></figcaption></figure>${originalView()}</div></div>`;
}
function transport() {
  const tr = language === "tr";
  return `<div class="transport"><div class="transport-main"><div class="transport-buttons"><button data-action="restart" class="icon-button" aria-label="${label("Restart")}">${icon("restart")}</button><button data-action="play" id="play" class="play-button" aria-label="${label(audio.playing ? "Pause" : "Play")}">${icon(audio.playing ? "pause" : "play")}</button><button data-action="stop" class="icon-button" aria-label="${label("Stop")}">${icon("stop")}</button></div><output id="clock">0:00 / ${clock(timeline ? beatToSeconds(timeline.duration, audio.performance!.tempos, audio.speed) : 0)}</output><input id="seek" type="range" min="0" max="${timeline?.duration || 1}" step="0.01" value="${audio.position}" aria-label="Seek playback"><label class="tempo-label">${label("Tempo")}<span><input id="tempo" type="number" min="20" max="300" value="${Math.round((timeline?.tempos[0]?.bpm || 120) * audio.speed)}"> BPM</span></label></div><div class="transport-options"><label class="follow-control"><input id="follow" type="checkbox" ${follow ? "checked" : ""}>${label("Follow score")}</label><section class="practice-loop" id="practice-loop"><label class="practice-toggle"><input id="loop-on" type="checkbox" ${audio.loop ? "checked" : ""} aria-label="Enable measure loop">${label("Loop measures")}</label><div class="loop-fields"><input id="loop-start" type="number" min="1" max="${timeline?.measures.length || 1}" value="${loopStart}" aria-label="Loop first measure"><span>–</span><input id="loop-end" type="number" min="1" max="${timeline?.measures.length || 1}" value="${loopEnd}" aria-label="Loop last measure"><button data-action="loop-current" class="text-button">${tr ? "Bu ölçü" : "This measure"}</button></div><output id="loop-status" class="fine"></output></section><section class="practice-metronome" id="practice-metronome"><label class="practice-toggle"><input id="metronome" type="checkbox" ${audio.metronome ? "checked" : ""}>${label("Metronome")}</label><div class="metronome-mini"><div id="metro-pulses" class="metro-pulses" aria-hidden="true"></div><output id="metro-count" aria-label="Metronome beat"></output><label class="metronome-volume-label"><span>${tr ? "Ses" : "Volume"}</span><input id="metronome-volume" aria-label="Metronome volume" type="range" min="0" max="1" step="0.01" value="${audio.metronomeVolume}"></label><output id="metronome-level">${Math.round(audio.metronomeVolume * 100)}%</output></div></section></div></div>`;
}
interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}
let installPrompt: InstallPrompt | undefined;
const standalone = matchMedia("(display-mode: standalone)");
let installed = standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function installPanel() {
  const tr = language === "tr";
  return `<section class="panel" id="installation">
    <h2>${tr ? "Uygulamayı yükle" : "Install modScore"}</h2>
    <p id="installation-state" role="status" ${installed ? "" : "hidden"}>${tr ? "modScore ana ekran uygulaması olarak açıldı." : "modScore is open as an installed app."}</p>
    <div id="installation-steps" ${installed ? "hidden" : ""}>
      <div id="native-install" ${installPrompt ? "" : "hidden"}>${button(tr ? "Yükle" : "Install app", "install-app", "primary", "download")}</div>
      <p><strong>iPhone · Safari</strong> ${tr ? "Paylaş → Ana Ekrana Ekle. Gösteriliyorsa Web Uygulaması Olarak Aç’ı etkinleştir." : "Share → Add to Home Screen. Turn on Open as Web App if shown."}</p>
      <p><strong>Android · Chrome</strong> ${tr ? "Menü ⋮ → Ana ekrana ekle → Yükle." : "Menu ⋮ → Add to home screen → Install."}</p>
    </div>
    <p class="fine">${tr ? "modScore’u ana ekran simgesinden aç. Çevrimdışı kullanım için bu ekrandan uygulamayı hazırla. Çevrimdışı nota taraması için tanıma modellerini de indir." : "Open modScore from its home-screen icon. Prepare offline use on this screen and download the recognition models to scan sheet music offline."}</p>
  </section>`;
}
function refreshInstallation() {
  const state = document.getElementById("installation-state");
  const steps = document.getElementById("installation-steps");
  const prompt = document.getElementById("native-install");
  if (state) state.hidden = !installed;
  if (steps) steps.hidden = installed;
  if (prompt) prompt.hidden = !installPrompt;
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  refreshInstallation();
});
window.addEventListener("appinstalled", () => {
  installed = true;
  installPrompt = undefined;
  refreshInstallation();
});
standalone.addEventListener("change", () => {
  if (standalone.matches) {
    installed = true;
    refreshInstallation();
  }
});
function settings() {
  return `<div class="page-heading"><div><p class="eyebrow">YOUR DEVICE / YOUR MUSIC</p><h1>${label("Settings")}</h1></div></div><div class="settings-grid">${hardwarePanel()}<section class="panel"><h2>Appearance</h2><label>${label("Theme")}<select id="theme"><option value="dark" ${theme === "dark" ? "selected" : ""}>${label("Dark")}</option><option value="light" ${theme === "light" ? "selected" : ""}>${label("Light")}</option></select></label><label>${label("Language")}<select id="language"><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="tr" ${language === "tr" ? "selected" : ""}>Türkçe</option></select></label></section><section class="panel"><h2>${label("Offline assets")}</h2><p id="offline-detail">Checking local assets…</p><p id="storage-detail" class="muted"></p><div class="stack">${button("Prepare offline use", "offline", "primary")}${button("Download recognition models", "models")}${button("Request persistent storage", "persist")}${button("Clear recognition models", "clear-models", "text-button danger")}</div><div id="asset-status" role="status"></div><p class="fine">The app shell, piano samples and recognition assets can be stored offline. Other GM instruments download on first selection. Only the piano and latest selected bank are retained. Browser storage can be evicted.</p></section>${installPanel()}<section class="panel"><h2>${label("Privacy")}</h2><p>Photographs, scores, recognition and playback stay on your device. No accounts, analytics, ads or cloud uploads.</p><p>Initial model/library assets come from this host. Optional instrument downloads request a pinned FluidR3 bank from GitHub; no score data is sent.</p><h3>${label("Source & licenses")}</h3><p><a href="${assetPath("about/")}" target="_blank" rel="noopener">About modScore · Setup guide</a> · <a href="https://github.com/WeAreTheArtMakers/modScore" target="_blank" rel="noopener">GitHub</a></p><p>modScore is free software under AGPL-3.0-only, without warranty. You may modify and redistribute under the license.</p><div class="row"><a href="${assetPath("source.tar.gz")}" download>Corresponding source</a><a href="${assetPath("LICENSE")}" target="_blank" rel="noopener">AGPL-3.0</a><a href="${assetPath("THIRD_PARTY_NOTICES.md")}" target="_blank" rel="noopener">Attributions</a></div><p class="fine">Recognition: Partsong / homr-rs / homr. Model training-data provenance caveats are documented in the notices. Samples: FluidR3, Frank Wen, CC BY 3.0.</p></section></div>`;
}
function render() {
  revision++;
  useMidiPitch = false;
  const rev = revision;
  cancelPreview();
  piano?.dispose();
  piano = undefined;
  sheet.clear();
  comparison.detach();
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  lastMeasure = -1;
  const titles: Record<string, string> = {
    home: "Workspace",
    library: "My scores",
    player: "Workspace",
    scan: "Scan sheet music",
    piano: "Virtual piano",
    settings: "Settings",
    audio: "Audio & YouTube",
  };
  app.innerHTML = `<aside class="sidebar"><a href="#" class="brand" data-action="home"><span class="brand-mark">m<span>♮</span></span>mod<span>Score</span></a><p class="sidebar-caption">YOUR MUSIC STUDIO</p><nav aria-label="Main">${[
    ["home", "Workspace", "home"],
    ["library", "My scores", "library"],
    ["piano", "Virtual piano", "piano"],
    ["audio", "Audio & YouTube", "music"],
  ]
    .map(([id, title, ic]) =>
      button(
        title,
        id,
        `nav-item ${view === id || (id === "home" && view === "player") ? "selected" : ""}`,
        ic,
      ),
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><span class="offline-status" id="offline-status">Checking offline assets…</span>${button("Settings", "settings", `nav-item ${view === "settings" ? "selected" : ""}`, "settings")}<span class="version">modScore ${version} · Free & open source</span></div></aside><div class="shell"><header class="topbar"><span>${label(titles[view] || "Workspace")}</span><div class="topbar-right"><span class="local-badge">${icon("shield")}ON YOUR DEVICE</span>${button("Scan sheet music", "capture", "small-button", "plus")}</div></header><main class="view view-${view}">${view === "home" ? home() : view === "library" ? libraryView() : view === "scan" ? scanView() : view === "settings" ? settings() : view === "audio" ? audioView() : playerView(view === "piano")}</main></div><input id="files" type="file" accept="image/*,application/pdf,.musicxml,.xml,.mid,.midi,.json" multiple hidden><input id="camera" type="file" accept="image/*" capture="environment" hidden><dialog id="export-dialog"><form method="dialog"><button class="dialog-close icon-button" aria-label="${label("Close")}">${icon("close")}</button></form><h2>${label("Export")}</h2><div class="stack">${["Project backup (.modscore.json)", "MusicXML (.musicxml)", "MIDI (.mid)", "Audio WAV (.wav)", "Original files", "All library projects"].map((s, i) => `<button data-export-type="${i}" ${!timeline && [1, 2, 3].includes(i) ? "disabled" : ""}>${e(s)}</button>`).join("")}${project?.performance ? '<button data-export-type="6">Performance MIDI (.mid)</button>' : ""}</div><p class="fine">${project?.performance ? "Performance MIDI preserves detected timing before notation edits; MIDI above exports the current score. " : ""}Project backups preserve images, notation and edit history. MIDI and WAV reflect tempo and transpose. WAV reflects mute/solo; MIDI includes every track.</p></dialog>`;
  bind();
  paintScoreNote();
  if (mode === "editor") void drawSourceExcerpt().catch(() => {});
  if (view === "player" || view === "piano") {
    piano = new Piano(document.querySelector("#piano")!, audio);
    piano.onManualBrowse = () => {
      auto = false;
      localStorage.setItem("modscore-auto-keys", "off");
      const input = document.querySelector<HTMLInputElement>("#auto-keys");
      if (input) input.checked = false;
    };
    piano.zoom(zoom);
    piano.showRoll(roll);
    if (
      (mode === "score" || mode === "compare") &&
      view === "player" &&
      project
    ) {
      const node = document.querySelector<HTMLElement>("#notation");
      if (node)
        void sheet
          .render(node, project.xml, project.title)
          .then(() => {
            if (rev === revision) {
              sheet.setEditing(editOnScore, selectedHead);
              sheet.update(writtenBeat(timeline!, audio.position), false);
            }
          })
          .catch((err) => toast(`Notation: ${err.message}`, true));
    }
  }
  refreshHardware();
  syncPracticeUI();
  void updateReadiness();
}
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
async function navigate(next: string) {
  if (busy) {
    toast("Finish or cancel the current operation before leaving.", true);
    return;
  }
  comparison.pause();
  audio.pause();
  guideActive = false;
  live.panic();
  view = next;
  if (next === "home" || next === "library") await refreshLibrary();
  render();
}
async function openProject(p: Project) {
  comparison.pause();
  audio.stop();
  guideActive = false;
  guideSeconds = 0;
  guideStep = 0;
  loopPicking = false;
  loopPickAnchor = undefined;
  project = p;
  editOnScore = false;
  showAlignment = false;
  selectedHead = undefined;
  if (!p.xml) {
    pages = [...p.pages];
    originals = [...p.originals];
    scanId = p.id;
    scanName = p.title;
    scanXml = [...(p.recognizedPages ?? [])];
    pageIndex = 0;
    status = "Review the pages, then recognize locally.";
    timeline = undefined;
    audio.timeline = undefined;
    audio.loop = undefined;
    view = "scan";
    render();
    return;
  }
  timeline = scoreTimeline(p.xml, p.title);
  audio.timeline = timeline;
  audio.speed = 1;
  audio.transpose = 0;
  selectedNote = 0;
  editorMeasure = undefined;
  audio.loop = undefined;
  loopStart = 1;
  loopEnd = Math.min(4, timeline.measures.length);
  audio.voices.clear();
  mode = "score";
  view = "player";
  render();
}
async function saveImportDraft(
  source = originals,
  draftPages = pages,
  checkpoints = scanXml,
) {
  if (!draftPages.length) return;
  const openDraft = project?.id === scanId && !project.xml ? project : undefined;
  const draft: Project = {
    id: scanId,
    title: scanName || "Imported score",
    xml: "",
    pages: [...draftPages],
    originals: [...source],
    recognizedPages: [...checkpoints],
    created: openDraft?.created ?? Date.now(),
    updated: Date.now(),
    reviewed: false,
  };
  await saveScore(draft);
  if (openDraft && project === openDraft) project = draft;
}

async function editScanPage(change: (page: Blob) => Blob | undefined | Promise<Blob>) {
  if (busy || !pages[pageIndex]) return;
  const index = pageIndex;
  busy = true;
  try {
    const replacement = await change(pages[index]);
    const updated = [...pages];
    updated.splice(index, 1, ...(replacement ? [replacement] : []));
    // Checkpoints are a sequential prefix. Keep only pages before the edit.
    const checkpoints = scanXml.slice(0, index);
    if (updated.length) await saveImportDraft(originals, updated, checkpoints);
    else {
      await deleteScore(scanId);
      if (project?.id === scanId) project = undefined;
      originals = [];
    }
    pages = updated;
    scanXml = checkpoints;
    pageIndex = Math.max(0, Math.min(index, updated.length - 1));
    status = editText("Draft changes saved.", "Taslak değişiklikleri kaydedildi.");
  } finally {
    busy = false;
    render();
  }
}

async function importFiles(files: File[]) {
  if (!files.length) return;
  if (busy) throw Error("Finish or cancel the current operation first.");
  audio.stop();
  busy = true;
  cancelled = false;
  importAbort = new AbortController();
  try {
    const plan = await planImport(files);
    if (importAbort.signal.aborted) return;
    if (plan.raster) {
      if (view !== "scan") {
        pages = [];
        originals = [];
        scanXml = [];
        scanId = crypto.randomUUID();
        scanName = files[0].name.replace(/\.[^.]+$/, "");
      }
      view = "scan";
      status = "Importing pages…";
      render();
      for (const { file, kind } of plan.entries) {
        const beforePages = pages.length;
        try {
          if (cancelled) break;
          if (kind === "pdf") {
            for await (const blob of pdfImages(file, importAbort.signal, {
              selectPages: true,
              password: true,
            })) {
              if (cancelled) break;
              pages.push(blob);
              await saveImportDraft([...originals, file]);
              status = `Imported ${pages.length} pages`;
              render();
            }
          } else {
            try {
              pages.push(await normalise(await uprightPhoto(file)));
            } catch (error) {
              throw Error(
                `${file.name}: image decoding failed. ${(error as Error).message}`,
              );
            }
          }
        } finally {
          if (pages.length > beforePages) {
            originals.push(file);
            await saveImportDraft();
          }
        }
      }
      pageIndex = 0;
      status = "Review the pages, then recognize locally.";
    } else {
      if (files.length > 1)
        throw Error("Import MusicXML, MIDI, or project files one at a time.");
      const file = files[0];
      let p: Project;
      if (plan.entries[0].kind === "project") {
        const data = JSON.parse(await file.text());
        if (
          data.format === "modscore-library" &&
          data.version === 1 &&
          Array.isArray(data.scores)
        ) {
          const restored = data.scores.map(validateProject);
          for (const score of restored) {
            if (score.xml) parseMusicXML(score.xml, score.title);
            for (const xml of score.recognizedPages || []) parseMusicXML(xml);
          }
          for (const score of restored) await saveScore(score);
          busy = false;
          await refreshLibrary();
          view = "library";
          toast(`Imported ${restored.length} scores as new copies.`);
          return;
        }
        p = validateProject(data);
        if (p.xml) parseMusicXML(p.xml, p.title);
        for (const xml of p.recognizedPages || []) parseMusicXML(xml);
      } else {
        const title = file.name.replace(/\.[^.]+$/, "");
        const xml =
          plan.entries[0].kind === "midi"
            ? midiToXml(await file.arrayBuffer(), title)
            : await file.text();
        parseMusicXML(xml, title);
        p = {
          id: crypto.randomUUID(),
          title,
          xml,
          pages: [],
          originals: [file],
          created: Date.now(),
          updated: Date.now(),
          reviewed: false,
        };
      }
      await saveScore(p);
      busy = false;
      await openProject(p);
      return;
    }
  } catch (error) {
    const e = error as Error;
    status =
      e.name === "AbortError"
        ? "Import cancelled. Completed pages are preserved."
        : `Import failed: ${e.message}`;
    if (e.name !== "AbortError") throw error;
  } finally {
    importAbort = undefined;
    busy = false;
    render();
  }
}
async function recognize() {
  if (busy) return;
  if (!pages.length) throw Error("Import a score image first.");
  busy = true;
  cancelled = false;
  scanName = (
    document.querySelector<HTMLInputElement>("#scan-title")?.value ||
    scanName ||
    "Untitled score"
  ).trim();
  status = "Preparing local recognition…";
  render();
  recognizer.onProgress = (msg) => {
    status = msg;
    const node =
      document.querySelector("#scan-status") ||
      document.querySelector("#asset-status");
    if (node) node.textContent = msg;
  };
  const draft: Project = {
    id: scanId,
    title: scanName,
    xml: "",
    pages: [...pages],
    originals: [...originals],
    created: Date.now(),
    updated: Date.now(),
    reviewed: false,
  };
  try {
    await saveScore({ ...draft, recognizedPages: scanXml });
    for (let i = scanXml.length; i < pages.length; i++) {
      if (cancelled) break;
      pageIndex = i;
      status = `Recognizing page ${i + 1} of ${pages.length}…`;
      render();
      const { xml, image } = await recognizer.recognize(pages[i]);
      if (cancelled) break;
      if (!parseMusicXML(xml).measures.length)
        throw Error(`No measures were recognized on page ${i + 1}. Check the image and retry.`);
      const recognizedPages = [...scanXml, xml];
      const preparedPages = [...draft.pages];
      // Note locations refer to the processed page. The raw upload remains in originals.
      preparedPages[i] = image;
      await saveScore({ ...draft, pages: preparedPages, recognizedPages });
      draft.pages = pages = preparedPages;
      scanXml = recognizedPages;
    }
    if (!cancelled && scanXml.length === pages.length) {
      const xml = mergePages(scanXml, scanName);
      const p = { ...draft, xml, recognizedPages: [...scanXml] };
      await saveScore(p);
      busy = false;
      recognizer.dispose();
      await openProject(p);
      toast(
        "Recognition complete. Compare the reconstructed notation with your originals.",
      );
    }
  } catch (error) {
    if (!cancelled) {
      status = (error as Error).message;
      throw error;
    }
  } finally {
    busy = false;
    recognizer.dispose();
    if (view === "scan") render();
  }
}
async function persist(changes: ScoreChanges = {}) {
  if (!project) return;
  const current = project;
  Object.assign(current, await updateScore(current, changes));
  toast(t("Saved on this device"));
}
const editValue = (id: string) =>
  (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
const editNumber = (id: string) => editValue(id).trim() === "" ? NaN : Number(editValue(id));

function pitchChoice(id: string, keep?: ReturnType<typeof readWrittenPitch>): PitchChoice {
  const step = editValue(id + "-step");
  const octave = editNumber(id + "-octave");
  const accidental = editValue(id + "-accidental");
  if (!Number.isInteger(octave) || octave < 0 || octave > 9)
    throw Error(editText("Choose an octave from 0 to 9.", "0 ile 9 arasında bir oktav seç."));
  const alter = accidental === "key" ? "key" :
    accidental === "keep" ? (keep?.step === step ? keep.alter : "key") : Number(accidental);
  return { step, octave, alter };
}

async function commitNoteEdit(
  xml: string, source?: number, movement?: HistoryMove,
) {
  if (!project || editSaving || xml === project.xml) return;
  const current = project;
  const updated = scoreTimeline(xml, current.title);
  const restore = movement ? historyTarget(current.editHistory, movement) : undefined;
  if (movement && restore?.xml !== xml) return;
  const before: ScoreSnapshot = {
    xml: current.xml, reviewed: current.reviewed, selected: selectedNote, head: selectedHead,
  };
  const match = source === undefined ? -1 : updated.notes.findIndex((n) => n.source.includes(source));
  const next: ScoreSnapshot = restore ?? {
    xml, reviewed: false,
    selected: match >= 0 ? match : Math.max(0, Math.min(selectedNote, updated.notes.length - 1)),
    head: editOnScore && match >= 0 ? source : undefined,
  };
  editSaving = true;
  try {
    const saved = await updateScore(current, {
      xml, reviewed: next.reviewed, editHistory: advanceHistory(current.editHistory, before, movement),
    });
    Object.assign(current, saved);
    if (project !== current || view !== "player") return;
    comparison.pause();
    audio.pause();
    guideActive = false;
    timeline = updated;
    const hadLoop = !!audio.loop;
    audio.timeline = updated;
    applyLoop(hadLoop && !!updated.measures[loopStart - 1] && !!updated.measures[loopEnd - 1]);
    comparison.anchor = Math.min(comparison.anchor, updated.duration);
    selectedNote = Math.max(0, Math.min(next.selected, updated.notes.length - 1));
    selectedHead = updated.notes[selectedNote]?.source.includes(next.head ?? -1) ? next.head : undefined;
    editorMeasure = undefined;
    if (audio.position > updated.duration) audio.seek(updated.duration);
    render();
    document.querySelector<HTMLElement>("#edit-select, #add-measure")?.focus({ preventScroll: true });
    toast(editText("Saved on this device", "Bu cihaza kaydedildi"));
  } finally {
    editSaving = false;
  }
}

async function updateAlignment(next: SourceAlignment, redraw = false) {
  if (!project || editSaving) return;
  const current = project;
  editSaving = true;
  try {
    Object.assign(current, await updateScore(current, { sourceAlignment: next }));
    if (redraw && project === current && view === "player") {
      showAlignment = true;
      render();
    }
  } finally {
    editSaving = false;
  }
}

function alignmentSettings() {
  const offset = editNumber("source-offset");
  const raw = editValue("source-bpm");
  const bpm = raw ? Number(raw) : undefined;
  if (!Number.isFinite(offset) || Math.abs(offset) > 3600 ||
      (bpm !== undefined && (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)))
    throw Error(editText("Choose a valid source offset and recording BPM.", "Geçerli bir kayıt başlangıcı ve BPM seç."));
  return { offset, bpm };
}

async function action(name: string) {
  if (editSaving) return;
  switch (name) {
    case "install-app": {
      const prompt = installPrompt;
      if (!prompt || installed) break;
      installPrompt = undefined;
      refreshInstallation();
      if ((await prompt.prompt()).outcome === "accepted") {
        installed = true;
        refreshInstallation();
      }
      break;
    }
    case "ab-passage":
      if(timeline){guideActive=false;comparison.pause();audio.pause();applyLoop(false);comparison.anchor=timeline.measures[12].beat;audio.seek(comparison.anchor);sheet.update(writtenBeat(timeline,comparison.anchor),true);}break;
    case "ab-load-demo": {
      if (project?.id !== "modscore-demo-basic-v4") break;
      const current = project;
      const response = await fetch(assetPath("demos/basic-music-source.mp3"));
      if (!response.ok) throw Error("The demo recording could not be loaded. Try again when online.");
      const blob = await response.blob();
      if (project !== current || current.originals.some((item) => item.type.startsWith("audio/"))) break;
      Object.assign(current, await updateScore(current, {
        originals: [...current.originals, new Blob([blob], { type: "audio/mpeg" })],
        sourceAlignment: current.sourceAlignment ?? { offset: 9.525317, bpm: 110 },
      }));
      if (project === current && view === "player") render();
      break;
    }
    case "mark-recording-time": {
      const source = document.querySelector<HTMLAudioElement>("#original-audio");
      if (!source || source.readyState < 1) throw Error(editText("Load the recording first.", "Önce kaydı yükle."));
      document.querySelector<HTMLInputElement>("#mark-seconds")!.value = source.currentTime.toFixed(3);
      break;
    }
    case "save-alignment-point": {
      const measure = editNumber("mark-measure");
      const seconds = editNumber("mark-seconds");
      const source = document.querySelector<HTMLAudioElement>("#original-audio");
      if (!project || !timeline?.measures[measure] || !Number.isFinite(seconds) || seconds < 0 ||
          (source && Number.isFinite(source.duration) && seconds >= source.duration))
        throw Error(editText("Choose a measure and a second within the recording.", "Ölçüyü ve kaydın içindeki saniyeyi seç."));
      const points = (project.sourceAlignment?.points ?? []).filter((point) => point.measure !== measure);
      points.push({ measure, seconds });
      points.sort((a, b) => a.measure - b.measure);
      if (!validAlignmentPoints(points))
        throw Error(editText("Use up to 64 points in increasing recording order.", "Kayıtta ilerleyen sırayla en fazla 64 nokta ekle."));
      comparison.pause();
      comparison.anchor = timeline.measures[measure].beat;
      await updateAlignment({ ...alignmentSettings(), points }, true);
      break;
    }
    case "ab-here": comparison.here();break;
    case "ab-source": guideActive=false;applyLoop(false);await comparison.listenSource();break;
    case "ab-piano": guideActive=false;applyLoop(false);await comparison.listenPiano();break;
    case "ab-pause": comparison.pause(true);audio.pause();break;
    case "audio":
      await navigate("audio");
      break;
    case "demo-basic":
      await openProject(await demoProject("basic"));
      break;
    case "demo-beethoven":
      await openProject(await demoProject("beethoven"));
      break;
    case "demo-start":
      comparison.pause();
      guideActive = true;
      guideStep = 0;
      guideSeconds = 0;
      guideLastFrame = performance.now();
      audio.stop();
      audio.setLoop(undefined);
      audio.metronome = false;
      audio.speed = 1;
      follow = true;
      roll = true;
      piano?.showRoll(true);
      await audio.play();
      break;
    case "demo-stop":
      guideActive = false;
      audio.pause();
      updatePlay();
      break;
    case "demo-follow":
      follow = true;
      roll = true;
      piano?.showRoll(true);
      guideStep = 0;
      break;
    case "demo-loop":
      loopStart = 1;
      loopEnd = Math.min(4, timeline?.measures.length || 1);
      applyLoop(true);
      guideStep = 1;
      break;
    case "demo-metronome":
      audio.metronome = !audio.metronome;
      syncPracticeUI();
      guideStep = 2;
      break;
    case "demo-keyboard": {
      const help = document.querySelector<HTMLDetailsElement>("#typing-help");
      if (help) {
        help.open = true;
        help.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "nearest",
        });
      }
      guideStep = 3;
      break;
    }
    case "octave-down":
      live.changeOctave(-1);
      break;
    case "octave-up":
      live.changeOctave(1);
      break;
    case "pick-loop":
      loopPicking = !loopPicking;
      loopPickAnchor = undefined;
      syncPracticeUI();
      toast(
        loopPicking
          ? language === "tr"
            ? "İlk ve son ölçüyü seçin."
            : "Select the first and last measure."
          : language === "tr"
            ? "Döngü seçimi kapalı."
            : "Loop selection finished.",
      );
      break;
    case "loop-current":
      if (timeline) {
        loopStart = loopEnd = lastMeasure + 1;
        applyLoop(true);
      }
      break;
    case "transcribe-audio":
      await transcribeSource();
      break;
    case "cancel-audio":
      audioAbort?.abort();
      break;
    case "enable-live":
      await audio.activate();
      await audio.instruments.prepare(audio.context!, []);
      toast(
        language === "tr"
          ? "Ses hazır. Klavye tuşlarını aşağıdaki panelden açabilirsiniz."
          : "Audio enabled. Open the keyboard panel for note keys.",
      );
      break;
    case "connect-midi":
      await live.connect();
      refreshHardware();
      break;
    case "panic":
      live.panic();
      audio.pause();
      updatePlay();
      break;
    case "test-audio": {
      const stop = await audio.touch(60);
      setTimeout(stop, 700);
      break;
    }
    case "audio-outputs": {
      await audio.activate();
      if (!(audio.context as any).setSinkId)
        throw Error(
          "Bu tarayıcı çıkış seçimini desteklemiyor. Ses kartını sistem ses ayarlarında seçin.",
        );
      const media = navigator.mediaDevices as any;
      const picked = media.selectAudioOutput
        ? await media.selectAudioOutput()
        : undefined;
      const devices = await media.enumerateDevices();
      const select = document.querySelector<HTMLSelectElement>("#audio-output");
      if (select)
        select.replaceChildren(
          new Option("Sistem varsayılanı", ""),
          ...devices
            .filter(
              (d: any) => d.kind === "audiooutput" && d.deviceId !== "default",
            )
            .map((d: any) => new Option(d.label || d.deviceId, d.deviceId)),
        );
      if (picked) {
        if (select) select.value = picked.deviceId;
        await (audio.context as any).setSinkId(picked.deviceId);
      }
      break;
    }
    case "home":
    case "library":
    case "settings":
    case "piano":
      await navigate(name);
      break;
    case "capture":
      document.querySelector<HTMLInputElement>("#camera")!.click();
      break;
    case "import":
    case "add-pages":
      document.querySelector<HTMLInputElement>("#files")!.click();
      break;
    case "study": {
      const xml = await (
        await fetch(assetPath("fixtures/grand-staff.musicxml"))
      ).text();
      const study: Project = {
        id: crypto.randomUUID(),
        title: "Recognition study · original CC0 test score",
        xml,
        pages: [],
        originals: [],
        created: Date.now(),
        updated: Date.now(),
        reviewed: true,
      };
      await saveScore(study);
      await openProject(study);
      toast(
        "Opened the original reference MusicXML. To test OMR, import an image of its printed notation.",
      );
      break;
    }
    case "recognize":
      await recognize();
      break;
    case "cancel-scan":
      if (importAbort) {
        cancelled = true;
        importAbort.abort();
        break;
      }
      cancelled = true;
      recognizer.cancel();
      status = "Cancelled; pages are preserved.";
      break;
    case "rotate":
      await editScanPage((page) => normalise(page, 90));
      break;
    case "remove-page":
      await editScanPage(() => undefined);
      break;
    case "apply-page": {
      if (busy || !pages[pageIndex]) break;
      const crop = [0, 1, 2, 3].map((i) => editNumber(`crop-${i}`));
      if (crop.some((n) => !Number.isFinite(n) || n < 0 || n > 100))
        throw Error("Crop percentages must be between 0 and 100.");
      const deskew = editNumber("deskew");
      if (!Number.isFinite(deskew) || Math.abs(deskew) > 15)
        throw Error("Choose a deskew angle from −15° to 15°.");
      const enhance = document.querySelector<HTMLInputElement>("#enhance")!.checked;
      await editScanPage((page) => normalise(page, deskew, crop, enhance));
      break;
    }
    case "play": {
      comparison.pause();
      const play = document.querySelector<HTMLButtonElement>("#play");
      if (play) play.disabled = true;
      try {
        if (audio.playing) audio.pause();
        else await audio.play();
      } finally {
        if (play) play.disabled = false;
        updatePlay();
      }
      break;
    }
    case "stop":
      comparison.pause();      audio.stop();
      updatePlay();
      break;
    case "restart":
      comparison.pause();comparison.anchor=0;audio.seek(0);
      break;
    case "toggle-roll":
      roll = !roll;
      piano?.showRoll(roll);
      document.querySelector('[data-action="toggle-roll"]')!.textContent = t(
        roll ? "Keyboard" : "Piano roll",
      );
      break;
    case "zoom":
      zoom = zoom >= 48 ? 24 : zoom + 8;
      piano?.zoom(zoom);
      break;
    case "fullscreen":
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen)
          await document.documentElement.requestFullscreen();
        else
          toast(
            "Use landscape or Add to Home Screen for the largest iPhone workspace.",
          );
      } else await document.exitFullscreen();
      break;
    case "export":
      document.querySelector<HTMLDialogElement>("#export-dialog")!.showModal();
      break;
    case "tie-next":
    case "untie": {
      const note = selectedScoreNote();
      if (!project || !note) break;
      await commitNoteEdit(name === "tie-next" ? tieNext(project.xml, note) : untie(project.xml, note),
        note.source[0]);
      break;
    }
    case "save-tempo":
      if (project) {
        const xml = setScoreTempo(project.xml, editNumber("score-tempo"), editValue("tempo-words"));
        await commitNoteEdit(xml, selectedScoreNote()?.source[0]);
      }
      break;
    case "toggle-score-edit": {
      editOnScore = !editOnScore;
      selectedHead = undefined;
      cancelPreview();
      sheet.setEditing(editOnScore);
      document.querySelector('[data-action="toggle-score-edit"]')?.setAttribute("aria-pressed", String(editOnScore));
      const inspector = document.getElementById("score-note-inspector")!;
      if (editOnScore) paintScoreNote();
      else inspector.replaceChildren();
      break;
    }
    case "hear-note":
    case "save-inline-note":
    case "delete-inline-note": {
      const note = selectedScoreNote();
      if (!project || !note || selectedHead === undefined) break;
      if (name === "hear-note") await auditionNote(note);
      if (name === "delete-inline-note") await commitNoteEdit(removeWrittenNote(project.xml, note));
      if (name === "save-inline-note") {
        const pitch = readWrittenPitch(xmlDocument(project.xml)
          .querySelectorAll("part > measure > note")[note.source[0]]);
        const choice = pitchChoice("inline", pitch);
        if (editValue("inline-accidental") === "keep" && choice.step === pitch.step && choice.octave === pitch.octave) break;
        await commitNoteEdit(replaceWrittenPitch(project.xml, note, choice), selectedHead);
      }
      break;
    }
    case "correct": {
      const note = selectedScoreNote();
      if (!project || !note) break;
      const duration = editNumber("edit-duration");
      const onset = editNumber("edit-onset");
      const original = readWrittenPitch(xmlDocument(project.xml)
        .querySelectorAll("part > measure > note")[note.source[0]]);
      const accidental = editValue("edit-accidental");
      const samePitch = !useMidiPitch && editValue("edit-step") === original.step &&
        editNumber("edit-octave") === original.octave &&
        (accidental === "keep" ||
          (accidental === String(original.alter) && original.accidental === accidentalNames[original.alter]));
      let corrected = amendOnset(project.xml, note, onset);
      if (Math.abs(duration - note.duration) > 0.000001 || !Number.isFinite(duration))
        corrected = amendNote(corrected, note, null, duration);
      if (!samePitch) {
        const choice = useMidiPitch
          ? pitchChoiceForMidi(project.xml, note, editNumber("edit-pitch"))
          : pitchChoice("edit", original);
        corrected = replaceWrittenPitch(corrected, note, choice);
      }
      await commitNoteEdit(corrected, note.source[0]);
      break;
    }
    case "delete-note": {
      const note = selectedScoreNote();
      if (project && note) await commitNoteEdit(removeWrittenNote(project.xml, note));
      break;
    }
    case "add-note": {
      if (!project) break;
      const index = editNumber("add-measure");
      const measure = writtenMeasures().find((m) => (m.sourceMeasure ?? m.index) === index);
      const target = editValue("add-target");
      if (!measure || !target)
        throw Error(editText("Choose a measure and voice.", "Ölçü ve ses seç."));
      const inserted = insertWrittenNote(project.xml, index, JSON.parse(target) as InsertionTarget,
        (editNumber("add-beat") - 1) * quarterBeatsPerPulse(measure),
        editNumber("add-duration"), measure.duration, pitchChoice("add"));
      await commitNoteEdit(inserted.xml, inserted.source);
      break;
    }
    case "undo-note":
    case "redo-note": {
      const move = name === "undo-note" ? "undo" : "redo";
      const target = historyTarget(project?.editHistory, move);
      if (target) await commitNoteEdit(target.xml, undefined, move);
      break;
    }
    case "reviewed":
      if (project) {
        await persist({ reviewed: true });
        render();
      }
      break;
    case "export-progress":
      for (let i = 0; i < scanXml.length; i++)
        download(
          new Blob([scanXml[i]], {
            type: "application/vnd.recordare.musicxml+xml",
          }),
          `${scanName}-page-${i + 1}.musicxml`,
        );
      break;
    case "offline":
      await prepareOffline();
      break;
    case "models":
      busy = true;
      try {
        recognizer.onProgress = (msg) => {
          const node = document.querySelector("#asset-status");
          if (node) node.textContent = msg;
        };
        await recognizer.init();
        toast("Recognition models stored on this device.");
      } finally {
        busy = false;
        recognizer.dispose();
        void updateReadiness();
      }
      break;
    case "persist":
      toast(
        (await navigator.storage?.persist?.())
          ? "Persistent storage granted."
          : "The browser did not grant persistent storage. Keep exported backups.",
      );
      void updateReadiness();
      break;
    case "clear-models":
      recognizer.dispose();
      await caches.delete("partscanner-models-v1");
      toast("Recognition model cache cleared.");
      void updateReadiness();
      break;
  }
}
function onAudioTitle() {
  document
    .querySelector<HTMLInputElement>("#audio-title")
    ?.addEventListener("input", (event) => {
      audioTitle = (event.target as HTMLInputElement).value;
    });
}
function bind() {
  if (view === "audio" && audioFile) {
    const preview = document.querySelector<HTMLAudioElement>("#audio-preview");
    if (preview) {
      const url = URL.createObjectURL(audioFile);
      urls.push(url);
      preview.src = url;
      preview.hidden = false;
    }
    const name = document.querySelector("#audio-file-name");
    if (name) name.textContent = audioFile.name;
  }
  onAudioTitle();

  if(project&&timeline) comparison.bind(document.querySelector<HTMLAudioElement>("#original-audio")||undefined,project,timeline);

  document
    .querySelector<HTMLInputElement>("#typing-enable")
    ?.addEventListener("change", (e) => {
      live.enabled = (e.target as HTMLInputElement).checked;
      localStorage.setItem("modscore-typing", live.enabled ? "on" : "off");
      live.panic();
    });
  document
    .querySelector<HTMLSelectElement>("#midi-input")
    ?.addEventListener("change", (e) =>
      live.select((e.target as HTMLSelectElement).value),
    );
  document
    .querySelector<HTMLSelectElement>("#audio-output")
    ?.addEventListener("change", (e) => {
      void audio
        .activate()
        .then(() =>
          (audio.context as any).setSinkId(
            (e.target as HTMLSelectElement).value,
          ),
        )
        .catch((e) => toast(e.message, true));
    });
  app.querySelectorAll<HTMLElement>("[data-action]").forEach(
    (n) =>
      (n.onclick = safe(async () => {
        await action(n.dataset.action!);
      })),
  );
  const on = (id: string, event: string, fn: (ev: Event) => unknown) =>
    document
      .getElementById(id)
      ?.addEventListener(event, (ev) => safe(() => fn(ev))());
  on("score-note-inspector", "click", (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>("button[data-action]");
    if (btn) return action(btn.dataset.action!);
  });
  on("files", "change", async (ev) => {
    const input = ev.target as HTMLInputElement;
    try {
      await importFiles([...(input.files || [])]);
    } finally {
      input.value = "";
    }
  });
  on("camera", "change", async (ev) => {
    const input = ev.target as HTMLInputElement;
    try {
      await importFiles([...(input.files || [])]);
    } finally {
      input.value = "";
    }
  });
  app
    .querySelectorAll<HTMLElement>("[data-open]")
    .forEach(
      (n) =>
        (n.onclick = safe(() =>
          openProject(library.find((p) => p.id === n.dataset.open)!),
        )),
    );
  app.querySelectorAll<HTMLElement>("[data-export]").forEach(
    (n) =>
      (n.onclick = safe(async () => {
        await openProject(library.find((p) => p.id === n.dataset.export)!);
        document
          .querySelector<HTMLDialogElement>("#export-dialog")!
          .showModal();
      })),
  );
  on("search", "input", (ev) => {
    const query = (ev.target as HTMLInputElement).value.toLocaleLowerCase(
      language,
    );
    document.querySelector("#library-list")!.innerHTML = rows(
      library.filter((p) =>
        p.title.toLocaleLowerCase(language).includes(query),
      ),
    );
    document
      .querySelectorAll<HTMLElement>("[data-open]")
      .forEach(
        (n) =>
          (n.onclick = safe(() =>
            openProject(library.find((p) => p.id === n.dataset.open)!),
          )),
      );
    document.querySelectorAll<HTMLElement>("[data-export]").forEach(
      (n) =>
        (n.onclick = safe(async () => {
          await openProject(library.find((p) => p.id === n.dataset.export)!);
          document
            .querySelector<HTMLDialogElement>("#export-dialog")!
            .showModal();
        })),
    );
  });
  app.querySelectorAll<HTMLElement>("[data-mode]").forEach(
    (n) =>
      (n.onclick = () => {
        mode = n.dataset.mode!;
        if (mode === "editor" && timeline) {
          const current = [...timeline.measures].reverse().find((m) => m.beat <= audio.now());
          if (current && current.index > 0) selectEditorMeasure(current.index);
        }
        render();
      }),
  );
  app.querySelectorAll<HTMLElement>("[data-page]").forEach(
    (n) =>
      (n.onclick = () => {
        pageIndex = Number(n.dataset.page);
        render();
      }),
  );
  on(
    "scan-title",
    "input",
    (ev) => (scanName = (ev.target as HTMLInputElement).value),
  );
  app.querySelectorAll<HTMLElement>("[data-measure]").forEach(
    (n) =>
      (n.onclick = () => {
        const index = Number(n.dataset.measure);
        if (loopPicking) {
          if (loopPickAnchor === undefined) {
            loopPickAnchor = index;
            loopStart = loopEnd = index + 1;
            syncPracticeUI();
          } else {
            loopStart = Math.min(loopPickAnchor, index) + 1;
            loopEnd = Math.max(loopPickAnchor, index) + 1;
            loopPicking = false;
            loopPickAnchor = undefined;
            applyLoop(true);
          }
        } else {
          comparison.pause();
          comparison.anchor = timeline!.measures[index].beat;
          audio.seek(comparison.anchor);
          if (mode === "editor") {
            selectEditorMeasure(index);
            render();
          }
        }
      }),
  );
  on("instrument", "change", async (ev) => {
    live.panic();
    const n = ev.target as HTMLSelectElement;
    const old = audio.instruments.program;
    n.disabled = true;
    toast("Loading instrument samples…");
    try {
      await audio.loadInstrument(Number(n.value));
      toast("Instrument ready.");
    } catch (err) {
      n.value = String(old);
      throw err;
    } finally {
      n.disabled = false;
      void updateReadiness();
    }
  });
  on("volume", "input", (ev) =>
    audio.setVolume(Number((ev.target as HTMLInputElement).value)),
  );
  on("tempo", "change", (ev) => {
    const value = Number((ev.target as HTMLInputElement).value);
    if (value < 20 || value > 300 || !Number.isFinite(value))
      throw Error("Tempo must be 20–300 BPM");
    audio.setSpeed(value / (timeline?.tempos[0].bpm || 120));
  });
  on("transpose", "change", async (ev) => {
    const value = Number((ev.target as HTMLInputElement).value);
    if (!Number.isInteger(value) || Math.abs(value) > 24)
      throw Error("Transpose must be an integer from −24 to 24");
    audio.pause();
    audio.transpose = value;
    if (audio.context) await audio.prepare();
    toast("Transposition applied; notes outside MIDI range will be omitted.");
  });
  on("seek", "input", (ev) => { comparison.pause();comparison.anchor=Number((ev.target as HTMLInputElement).value);audio.seek(comparison.anchor); });
  on("follow", "change", (ev) => {
    follow = (ev.target as HTMLInputElement).checked;
    localStorage.setItem("modscore-follow", follow ? "on" : "off");
    if (follow) sheet.resumeFollow();
  });
  on("auto-keys", "change", (ev) => {
    auto = (ev.target as HTMLInputElement).checked;
    localStorage.setItem("modscore-auto-keys", auto ? "on" : "off");
    if (auto) piano?.resumeAuto();
  });
  on("metronome", "change", (ev) => {
    audio.metronome = (ev.target as HTMLInputElement).checked;
    syncPracticeUI();
  });
  on("metronome-volume", "input", (ev) => {
    audio.setMetronomeVolume(Number((ev.target as HTMLInputElement).value));
    localStorage.setItem(
      "modscore-metronome-volume",
      String(audio.metronomeVolume),
    );
    syncPracticeUI();
  });
  const setLoop = () => {
    if (!timeline) return;
    const first = document.querySelector<HTMLInputElement>("#loop-start")!,
      last = document.querySelector<HTMLInputElement>("#loop-end")!;
    const a = Number(first.value),
      b = Number(last.value);
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 1 ||
      b < a ||
      b > timeline.measures.length
    )
      throw Error("Choose a valid first and last measure.");
    loopStart = a;
    loopEnd = b;
    applyLoop(document.querySelector<HTMLInputElement>("#loop-on")!.checked);
  };
  for (const id of ["loop-on", "loop-start", "loop-end"])
    on(id, "change", setLoop);
  on("comparison-file", "change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file || !project || editSaving) return;
    if (file.size > 40 * 1024 * 1024) throw Error("Recording must be under 40 MB.");
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name))
      throw Error("Choose an audio recording.");
    const current = project;
    comparison.pause();
    audio.pause();
    Object.assign(current, await updateScore(current, {
      originals: [
        ...current.originals.filter((item) => !item.type.startsWith("audio/")),
        file.type.startsWith("audio/") ? file : new Blob([file], {
          type: file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
        }),
      ],
      sourceAlignment: { offset: 0, bpm: timeline?.tempos.length === 1 ? timeline.tempos[0].bpm : undefined },
    }));
    if (project === current && view === "player") render();
  });
  const alignSource = async () => {
    if (!project) return;
    comparison.pause();
    const points = project.sourceAlignment?.points;
    await updateAlignment({ ...alignmentSettings(), ...(points ? {points} : {}) });
  };
  on("source-offset", "change", alignSource);
  on("source-bpm", "change", alignSource);
  on("alignment-details", "toggle", (ev) => {
    showAlignment = (ev.target as HTMLDetailsElement).open;
  });
  app.querySelectorAll<HTMLButtonElement>("[data-remove-mark]").forEach((btn) => {
    btn.onclick = safe(async () => {
      if (!project?.sourceAlignment) return;
      const points = project.sourceAlignment.points?.filter((point) => point.measure !== Number(btn.dataset.removeMark));
      comparison.pause();
      await updateAlignment({ ...project.sourceAlignment, points }, true);
    });
  });
  const expression=async()=>{const style=(document.querySelector("#expression-style") as HTMLSelectElement).value as ExpressionOptions["style"],fermata=Number((document.querySelector("#fermata-stretch") as HTMLInputElement).value);if(!["auto","baroque","classical","literal"].includes(style)||!Number.isFinite(fermata)||fermata<1||fermata>2.5)throw Error("Choose a valid expression style and fermata stretch.");const was=audio.playing;comparison.pause();audio.pause();Object.assign(expressionSettings,{style,fermata});localStorage.setItem("modscore-expression",style);localStorage.setItem("modscore-fermata",String(fermata));if(timeline)timeline.expression={...expressionSettings};if(was)await audio.play();};
  on("expression-style","change",expression);on("fermata-stretch","change",expression);
  on("audio-auto-tempo", "change", (ev) => {
    const enabled = (ev.target as HTMLInputElement).checked;
    audioSettings.autoTempo = enabled;
    const input = document.querySelector<HTMLInputElement>("#audio-bpm");
    if (input) input.disabled = enabled;
  });
  on("audio-file", "change", (ev) => {
    audioFile = (ev.target as HTMLInputElement).files?.[0];
    if (audioFile) {
      audioSourceUrl = "";
      const url = document.querySelector<HTMLInputElement>("#youtube-url");
      if (url) url.value = "";
      const preview =
        document.querySelector<HTMLAudioElement>("#audio-preview");
      if (preview) {
        const src = URL.createObjectURL(audioFile);
        urls.push(src);
        preview.src = src;
        preview.hidden = false;
      }
      const name = document.querySelector("#audio-file-name");
      if (name) name.textContent = audioFile.name;
      const title = document.querySelector<HTMLInputElement>("#audio-title");
      if (title && !title.value)
        title.value = audioFile.name.replace(/\.[^.]+$/, "");
    }
  });
  on("youtube-url", "input", (ev) => {
    audioSourceUrl = (ev.target as HTMLInputElement).value;
    if (audioSourceUrl) {
      audioFile = undefined;
      const preview =
        document.querySelector<HTMLAudioElement>("#audio-preview");
      if (preview) {
        preview.pause();
        preview.removeAttribute("src");
        preview.hidden = true;
      }
      const input = document.querySelector<HTMLInputElement>("#audio-file");
      if (input) input.value = "";
    }
  });
  const demoSelect = app.querySelector<HTMLSelectElement>("#demo-select");
  if (demoSelect) demoSelect.onchange = safe(async () => openProject(await demoProject(demoSelect.value)));
  app
    .querySelectorAll<HTMLElement>("[data-demo]")
    .forEach(
      (node) =>
        (node.onclick = safe(async () =>
          openProject(await demoProject(node.dataset.demo!)),
        )),
    );
  const voices = (el: HTMLInputElement, field: "mute" | "solo") => {
    const key = field === "mute" ? el.dataset.mute! : el.dataset.solo!;
    const state = audio.voices.get(key) || { mute: false, solo: false };
    state[field] = el.checked;
    audio.voices.set(key, state);
    audio.seek(audio.now());
  };
  app
    .querySelectorAll<HTMLInputElement>("[data-mute]")
    .forEach((n) => (n.onchange = () => voices(n, "mute")));
  app
    .querySelectorAll<HTMLInputElement>("[data-solo]")
    .forEach((n) => (n.onchange = () => voices(n, "solo")));
  app.querySelectorAll<HTMLInputElement>("[data-color]").forEach(
    (n) =>
      (n.oninput = () => {
        const keys = [
          ...new Set(timeline?.notes.map((n) => audio.voiceKey(n))),
        ];
        colors[keys.indexOf(n.dataset.color!) % colors.length] = n.value;
      }),
  );
  app.querySelectorAll<HTMLElement>("[data-review-measure]").forEach((node) => {
    node.onclick = () => {
      selectEditorMeasure(Number(node.dataset.reviewMeasure));
      selectedHead = undefined;
      mode = "editor";
      render();
    };
  });
  on("add-measure", "change", () => {
    if (!project) return;
    document.querySelector<HTMLSelectElement>("#add-target")!.innerHTML =
      addNoteFields(xmlDocument(project.xml), editNumber("add-measure"), selectedScoreNote());
    document.querySelector<HTMLInputElement>("#add-beat")!.value = "1";
  });
  on("edit-pitch", "change", () => { useMidiPitch = true; });
  for (const id of ["edit-step", "edit-octave", "edit-accidental"])
    on(id, "change", () => { useMidiPitch = false; });
  on("edit-rhythm", "change", (ev) => {
    const value = (ev.target as HTMLSelectElement).value;
    if (value)
      (document.querySelector("#edit-duration") as HTMLInputElement).value =
        value;
  });
  on("edit-select", "change", (ev) => {
    selectedNote = Number((ev.target as HTMLSelectElement).value);
    editorMeasure = undefined;
    render();
  });
  on("theme", "change", (ev) => {
    theme = (ev.target as HTMLSelectElement).value;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("modscore-theme", theme);
  });
  on("language", "change", (ev) => {
    setLanguage((ev.target as HTMLSelectElement).value);
    reviewCache = undefined;
    render();
  });
  app
    .querySelectorAll<HTMLElement>("[data-export-type]")
    .forEach(
      (n) => (n.onclick = safe(() => doExport(Number(n.dataset.exportType)))),
    );
  if (project && view === "player") {
    const menu = document.createElement("details");
    menu.className = "score-actions";
    menu.innerHTML = `<summary>Score actions</summary><div class="row"><label>Title<input id="rename-title" value="${e(project.title)}"></label>${button("Rename", "rename")}${button("Save", "save")}${project.pages.length ? button(language === "tr" ? "Yeniden tanı (kopya)" : "Recognize again (copy)", "rescan") : ""}${button("Delete", "delete", "danger")}</div>`;
    document.querySelector(".player-heading")!.after(menu);
    menu.querySelector('[data-action="rescan"]')?.addEventListener(
      "click",
      safe(async () => {
        if (busy || !project?.pages.length) return;
        audio.stop();
        live.panic();
        pages = [...project.pages];
        originals = [...project.originals];
        scanId = crypto.randomUUID();
        scanName = project.title + " · Re-scan";
        scanXml = [];
        pageIndex = 0;
        status =
          language === "tr"
            ? "Yeni motorla tanımaya hazır. Önceki kayıt korunuyor."
            : "Ready to recognize with the current engine. The previous score is kept.";
        project = undefined;
        timeline = undefined;
        audio.timeline = undefined;
        await saveImportDraft();
        view = "scan";
        render();
      }),
    );
    menu.querySelector('[data-action="rename"]')!.addEventListener(
      "click",
      safe(async () => {
        const title = (
          menu.querySelector("#rename-title") as HTMLInputElement
        ).value.trim();
        if (!title) throw Error("Enter a title");
        await persist({ title });
        render();
      }),
    );
    menu
      .querySelector('[data-action="save"]')!
      .addEventListener("click", safe(() => persist()));
    menu.querySelector('[data-action="delete"]')!.addEventListener(
      "click",
      safe(async () => {
        if (
          !confirm(
            `Delete “${project!.title}” from this device? Export a backup first if needed.`,
          )
        )
          return;
        await deleteScore(project!.id);
        audio.stop();
        project = undefined;
        timeline = undefined;
        audio.timeline = undefined;
        await navigate("library");
      }),
    );
  }
}
async function doExport(type: number) {
  if (type === 5) {
    await refreshLibrary();
    const exports = [];
    for (const p of library)
      exports.push(JSON.parse(await (await exportProject(p)).text()));
    download(
      new Blob(
        [
          JSON.stringify({
            format: "modscore-library",
            version: 1,
            scores: exports,
          }),
        ],
        { type: "application/json" },
      ),
      "modScore-library-backup.json",
    );
    return;
  }
  if (!project) throw Error("Open a score first.");
  const name = project.title.replace(/[\\/:*?"<>|]/g, "-");
  if (type === 0)
    download(await exportProject(project), name + ".modscore.json");
  if ([1, 2, 3, 6].includes(type) && !timeline)
    throw Error("Recognize or import a playable score before exporting notation or audio.");
  if (type === 1)
    download(
      new Blob([project.xml], {
        type: "application/vnd.recordare.musicxml+xml",
      }),
      name + ".musicxml",
    );
  if (type === 2 && timeline)
    download(exportMidi(timeline, audio.transpose, audio.speed), name + ".mid");
  if (type === 3) {
    comparison.pause();
    audio.pause();
    toast("Rendering WAV locally…");
    download(await audio.wav(), name + ".wav");
  }
  if (type === 6 && project.performance && timeline) {
    const perf = project.performance;
    const t: Timeline = {
      ...timeline,
      expression: {style:"literal",fermata:1},
      fermatas: [],
      tempos: [{ beat: 0, bpm: perf.bpm }],
      notes: perf.notes.map((n, i) => ({
        ...n,
        id: `performance-${i}`,
        track: timeline!.tracks[0].id,
        staff: n.pitch >= 60 ? 1 : 2,
        voice: "1",
        measure: 0,
        source: [],
        velocity: n.velocity ?? 0.7,
      })),
    };
    download(
      exportMidi(t, audio.transpose, audio.speed),
      name + "-performance.mid",
    );
  }
  if (type === 4) {
    if (!project.originals.length)
      throw Error("No original files for this score");
    project.originals.forEach((b, i) =>
      download(
        b,
        `${name}-original-${i + 1}.${b.type === "application/pdf" ? "pdf" : b.type.includes("png") ? "png" : b.type.includes("xml") ? "musicxml" : b.type.includes("wav") ? "wav" : b.type.includes("mpeg") ? "mp3" : b.type.includes("mp4") ? "m4a" : b.type.includes("webm") ? "webm" : b.type.includes("ogg") ? "ogg" : b.type.startsWith("image/") ? "jpg" : "bin"}`,
      ),
    );
  }
}
async function updateReadiness() {
  try {
    const sw = !!navigator.serviceWorker?.controller;
    const cached = await caches.open("partscanner-models-v1");
    const keys = await cached.keys();
    const names = [
      "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx",
      "encoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31.onnx",
      "decoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31.onnx",
    ];
    const modelSizes = [57311361, 52861122, 47356003];
    let bytes = 0;
    let models = true;
    names.forEach((name, mi) => {
      const base = new URL(
        assetPath("recognition/models/" + name),
        location.origin,
      ).href;
      if (keys.some((k) => k.url === base)) {
        bytes += modelSizes[mi];
        return;
      }
      const count = Math.ceil(modelSizes[mi] / 4194304);
      for (let i = 0; i < count; i++) {
        if (keys.some((k) => k.url === base + "?piece=" + i))
          bytes += Math.min(4194304, modelSizes[mi] - i * 4194304);
        else models = false;
      }
    });
    let shellReady = false;
    if (import.meta.env.PROD && sw) {
      try {
        const response = await fetch(assetPath("offline-assets.json"));
        if (response.ok) {
          const paths: string[] = await response.json();
          const matches = await Promise.all(
            paths.map((path) =>
              caches.match(new URL(assetPath(path), location.origin).href),
            ),
          );
          shellReady = matches.every(Boolean);
        }
      } catch {}
    }
    const ready = sw && shellReady;
    document
      .querySelector("#offline-status")
      ?.replaceChildren(
        document.createTextNode(
          ready
            ? "Offline assets stored"
            : !navigator.onLine
              ? "Offline · cached scores available"
              : "Local processing · models " +
                (models ? "stored" : "not stored"),
        ),
      );
    const detail = document.querySelector("#offline-detail");
    if (detail)
      detail.textContent = `App shell: ${shellReady ? "all required files cached" : sw ? "installed; some assets not cached" : "not ready yet"}. Models: ${(bytes / 1e6).toFixed(1)} / 157.5 MB cached. Selected instrument: ${audio.instruments.program === 0 ? "bundled piano" : instrumentNames[audio.instruments.program]}.`;
    const q = await storageStatus();
    const node = document.querySelector("#storage-detail");
    if (node)
      node.textContent = `Storage ${(q.usage / 1e6).toFixed(1)} MB / ${(q.quota / 1e6).toFixed(0)} MB. ${q.persisted ? "Persistence granted." : "May be evicted by browser."}`;
  } catch {
    const node = document.querySelector("#offline-status");
    if (node) node.textContent = "Storage unavailable · export backups";
  }
}
async function prepareOffline() {
  recognizer.onProgress = (message) => {
    const node = document.querySelector("#asset-status");
    if (node) node.textContent = message;
  };
  if (!("serviceWorker" in navigator))
    throw Error("A secure HTTPS origin is required for offline installation.");
  if (!import.meta.env.PROD)
    throw Error("Use the production build to prepare offline use.");
  let timeout = 0;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(Error(editText(
          "The offline worker is taking longer than expected. Stay online and try again.",
          "Çevrimdışı hazırlık beklenenden uzun sürdü. İnternet açıkken tekrar dene.",
        ))), 60_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const r = await fetch(assetPath("offline-assets.json"));
  if (!r.ok) throw Error("Build the production app to prepare offline assets.");
  const paths: string[] = await r.json();
  const cache = await caches.open(
    "modscore-offline-" + encodeURIComponent(import.meta.env.BASE_URL) + "-v1",
  );
  for (let i = 0; i < paths.length; i++) {
    const path = assetPath(paths[i]);
    if (!(await caches.match(new URL(path, location.origin).href))) {
      const res = await fetch(path);
      if (!res.ok) throw Error(`Could not store ${path}`);
      await cache.put(path, res);
    }
    const node = document.querySelector("#asset-status");
    if (node)
      node.textContent = `Stored ${i + 1} / ${paths.length} application assets`;
  }
  await updateReadiness();
  toast(editText(
    "The app and piano are ready to use offline. Download the recognition models separately if needed.",
    "Uygulama ve piyano çevrimdışı kullanıma hazır. Nota tanıma gerekiyorsa modelleri ayrıca indir.",
  ));
}
let pulseTimeline: Timeline | undefined,
  pulseCache: ReturnType<typeof metronomePulses> = [];
function practiceFrame(beat: number) {
  const now = performance.now(),
    dt = guideLastFrame ? Math.min(0.1, (now - guideLastFrame) / 1000) : 0;
  guideLastFrame = now;
  if (guideActive && audio.playing) {
    guideSeconds += dt;
    const next =
      guideSeconds < 8 ? 0 : guideSeconds < 28 ? 1 : guideSeconds < 40 ? 2 : 3;
    if (next !== guideStep) {
      guideStep = next;
      if (next === 1) {
        loopStart = 1;
        loopEnd = Math.min(4, timeline?.measures.length || 1);
        applyLoop(true);
      }
      if (next === 2) {
        audio.metronome = true;
        syncPracticeUI();
      }
      if (next === 3) {
        applyLoop(false);
        const help = document.querySelector<HTMLDetailsElement>("#typing-help");
        if (help) help.open = true;
      }
    }
    if (guideSeconds >= 56) guideActive = false;
  }
  const banner = document.querySelector<HTMLElement>("#demo-banner");
  if (banner) {
    banner.dataset.playing = String(audio.playing);
    banner
      .querySelectorAll<HTMLElement>("[data-guide-step]")
      .forEach((n) =>
        n.setAttribute(
          "aria-pressed",
          String(
            Number(n.dataset.guideStep) === guideStep &&
              (guideActive || audio.playing),
          ),
        ),
      );
    const start = banner.querySelector<HTMLElement>(
      '[data-action="demo-start"],[data-action="demo-stop"]',
    );
    if (start) {
      start.dataset.action = guideActive ? "demo-stop" : "demo-start";
      const text = t(guideActive ? "Stop tour" : "Start guided demo");
      if (start.textContent !== text) start.textContent = text;
    }
    const descriptions =
      language === "tr"
        ? [
            "Nota imleci, piyano tuşları ve piyano rulosu aynı çalmayı takip eder.",
            "1–4. ölçüler aralıksız tekrar eder. Farklı bir döngü için ilk ve son ölçüyü seçin.",
            "Metronom ölçü başını vurgular; kendi ses kaydırıcısından ayarlayın.",
            "Klavye paneli aşağıda: tuşlarla çalın, Z/X veya −/+ ile oktavı değiştirin.",
          ]
        : [
            "The score cursor, piano keys and falling notes follow the same playback.",
            "Measures 1–4 repeat without restarting audio. Select two measures to choose another loop.",
            "The metronome accents each bar. Adjust its own volume slider.",
            "Use the keyboard panel below: play note keys and change octave with Z/X or −/+.",
          ];
    const caption = banner.querySelector("#demo-caption");
    const text =
      guideSeconds >= 56
        ? language === "tr"
          ? "Tur tamamlandı. Dilediğiniz gibi çalışmaya devam edin."
          : "Tour complete. Keep exploring at your own pace."
        : descriptions[guideStep];
    if (caption && caption.textContent !== text) caption.textContent = text;
  }
  document
    .querySelector("#practice-loop")
    ?.classList.toggle("tour-focus", guideActive && guideStep === 1);
  document
    .querySelector("#practice-metronome")
    ?.classList.toggle("tour-focus", guideActive && guideStep === 2);
  document
    .querySelector(".keyboard-controls")
    ?.classList.toggle("tour-focus", guideActive && guideStep === 3);
  if (timeline !== pulseTimeline) {
    pulseTimeline = timeline;
    pulseCache = timeline ? metronomePulses(timeline) : [];
  }
  let pulse = pulseCache[0];
  for (const p of pulseCache) {
    if (p.beat > beat + 1e-6) break;
    pulse = p;
  }
  const dots = document.querySelector("#metro-pulses");
  if (dots && pulse) {
    const count = Math.min(16, pulse.count);
    if (dots.children.length !== count)
      dots.innerHTML = Array.from({ length: count }, () => "<i></i>").join("");
    Array.from(dots.children).forEach((dot, i) =>
      dot.classList.toggle(
        "current",
        audio.metronome && audio.playing && pulse.index === i,
      ),
    );
  }
  const counter = document.querySelector("#metro-count");
  if (counter && pulse) {
    const text = `${pulse.index + 1}/${pulse.count}`;
    if (counter.textContent !== text) counter.textContent = text;
  }
}

function frame() {
  comparison.syncRate();
  for(const [action,pressed] of [["ab-source",comparison.sourcePlaying],["ab-piano",audio.playing]] as const)document.querySelector(`[data-action="${action}"]`)?.setAttribute("aria-pressed",String(pressed));
  const anchor=document.querySelector("#ab-position");if(anchor&&timeline&&project){const m=[...timeline.measures].reverse().find(m=>m.beat<=comparison.anchor);const text=`${language==="tr"?"Ölçü":"Measure"} ${m?.number||1} · ${clock(Math.max(0,sourceSeconds(project,timeline,comparison.anchor)))}`;if(anchor.textContent!==text)anchor.textContent=text;}

  practiceFrame(audio.now());
  piano?.setLive(live.pitches());
  const beat = audio.now();
  if (piano) {
    const notes = timeline && audio.playing ? activeNotes(timeline, beat) : [];
    piano.update(notes, beat, timeline, auto);
    piano.setLive(live.pitches());
    const names = document.querySelector("#active-names");
    if (names)
      names.textContent = notes
        .filter((n) => audio.audible(n))
        .map((n) => noteName(n.pitch + audio.transpose))
        .join(" · ");
  }
  if (view === "player" && timeline) {
    const node = document.querySelector<HTMLOutputElement>("#clock");
    if (node)
      node.value = `${clock(beatToSeconds(beat, audio.performance!.tempos, audio.speed))} / ${clock(beatToSeconds(timeline.duration, audio.performance!.tempos, audio.speed))}`;
    const slider = document.querySelector<HTMLInputElement>("#seek");
    if (slider && document.activeElement !== slider)
      slider.value = String(beat);
    let measure = 0;
    for (let i = 0; i < timeline.measures.length; i++) {
      if (timeline.measures[i].beat <= beat) measure = i;
      else break;
    }
    if (measure !== lastMeasure) {
      lastMeasure = measure;
      document
        .querySelectorAll("[data-measure]")
        .forEach((n) =>
          n.classList.toggle(
            "playing",
            Number((n as HTMLElement).dataset.measure) === measure,
          ),
        );
    }
    if (mode === "score" || mode === "compare")
      sheet.update(writtenBeat(timeline, beat), follow && audio.playing);
    updatePlay();
  }
  requestAnimationFrame(frame);
}
function updatePlay() {
  const node = document.querySelector("#play");
  if (node) {
    const value = audio.playing ? "Pause" : "Play";
    if (node.getAttribute("aria-label") !== t(value)) {
      node.innerHTML = icon(audio.playing ? "pause" : "play");
      node.setAttribute("aria-label", t(value));
    }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    comparison.pause();
    audio.pause();
    updatePlay();
  }
});
window.addEventListener("pagehide", () => {comparison.pause();audio.pause();});
window.addEventListener("online", () => void updateReadiness());
window.addEventListener("offline", () => void updateReadiness());
if (import.meta.env.PROD && "serviceWorker" in navigator)
  void navigator.serviceWorker
    .register(assetPath("sw.js"), { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      updateCleanup?.();
      updateCleanup = watchUpdates(reg, navigator.serviceWorker, async () => {
        if (busy || editSaving)
          throw Error(editText("Finish the current operation before updating.",
            "Güncellemeden önce mevcut işlemi bitir."));
        comparison.pause();
        audio.pause();
        if (view === "scan") await saveImportDraft();
      });
    })
    .catch((err) => console.warn("Offline install:", err));
void refreshLibrary()
  .then(async () => {
    if (!localStorage.getItem(DEMO_SEEN)) {
      const empty = library.length === 0;
      if (empty) {
        const p = await demoProject("basic");
        localStorage.setItem(DEMO_SEEN, "seen");
        await refreshLibrary();
        await openProject(p);
        return;
      }
      localStorage.setItem(DEMO_SEEN, "seen");
    }
    render();
  })
  .catch((err) => {
    render();
    toast(`Library: ${err.message}`, true);
  });
requestAnimationFrame(frame);
