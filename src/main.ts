import { assetPath } from "./paths";
import { LiveInput } from "./live-input";
import { planImport } from "./imports";
import { watchUpdates } from "./updates";
import { reviewEncoding, setScoreTempo, tieNext, untie } from "./review";
import "./style.css";
import { uprightPhoto } from "../vendor/partsong/orient.js";
import {
  parseMusicXML,
  activeNotes,
  amendNote,
  amendOnset,
  mergePages,
  noteName,
  beatToSeconds,
  type Timeline,
} from "./music";
import { AudioEngine } from "./audio";
import { Piano, colors } from "./piano";
import { Sheet } from "./sheet";
import { Recognizer, normalise, pdfImages } from "./omr";
import {
  listScores,
  saveScore,
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
const sheet = new Sheet();
sheet.onSeek = (measure) => {
  if (timeline?.measures[measure]) audio.seek(timeline.measures[measure].beat);
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
  follow = true,
  auto = true,
  roll = false,
  zoom = 32,
  selectedNote = 0,
  revision = 0,
  lastMeasure = -1,
  updateCleanup: (() => void) | undefined;
let importAbort: AbortController | undefined;
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
  return `<section class="panel"><h2>${tr ? "Klavye, MIDI ve ses çıkışı" : "Keyboard, MIDI & audio output"}</h2><label class="check-label"><input id="typing-enable" type="checkbox" ${live.enabled ? "checked" : ""}>${tr ? "Bilgisayar klavyesiyle çal" : "Play with computer keyboard"}</label><p>A W S E D F T G Y H U J K · Z / X: ${tr ? "oktav" : "octave"}</p><div class="row">${button("Connect MIDI", "connect-midi")}${button("Audio outputs", "audio-outputs")}${button("Test audio", "test-audio")}${button("All notes off", "panic")}</div><label>MIDI giriş<select id="midi-input"><option value="">${tr ? "Bağlı giriş yok" : "No input selected"}</option></select></label><label>${tr ? "Ses çıkışı" : "Audio output"}<select id="audio-output"><option value="">${tr ? "Sistem varsayılanı" : "System default"}</option></select></label><p id="hardware-status" role="status"></p><p class="fine">${tr ? "MIDI için tarayıcı izni gerekir. Ses kartı listede yoksa işletim sisteminin ses çıkışından seçin. MIDI ve ses kartı aynı bağlantı türü değildir." : "MIDI requires browser permission. If your audio interface is not listed, select it in system sound settings. MIDI input and audio output are separate connections."}</p></section>`;
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
  if (hint)
    hint.textContent = `A W S E D F T G Y H U J K · Z/X octave ${live.octave} · ${live.status}`;
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
function home() {
  return `<section class="intro"><p class="eyebrow">SCAN. LISTEN. LEARN.</p><h1>${label("Your music, in motion.")}</h1><p class="lede">${label("Turn printed music into something you can hear, see, and learn. All on your device.")}</p><div class="entry-cards"><button class="entry-card primary" data-action="capture"><span class="entry-icon">${icon("scan")}</span><strong>${label("Scan sheet music")}</strong><span>${label("Camera")}</span><span class="card-end">${icon("plus")}</span></button><button class="entry-card" data-action="import"><span class="entry-icon">${icon("import")}</span><strong>${label("Import score")}</strong><span>${label("Image, PDF, MusicXML or MIDI")}</span><span class="card-end">${icon("plus")}</span></button></div><p class="privacy-note">${icon("shield")}${label("No uploads. No accounts. Yours.")}</p></section><section class="library-section"><div class="section-heading"><h2>${label("Local library")}</h2>${button("My scores", "library", "text-button")}</div><div class="score-list">${rows(library.slice(0, 4))}</div><button class="text-button test-study" data-action="study">${label("Original test score (CC0)")}</button></section>`;
}
function libraryView() {
  return `<div class="page-heading"><div><p class="eyebrow">LOCAL / PRIVATE</p><h1>${label("My scores")}</h1></div>${button("Import score", "import", "primary", "plus")}</div><label class="search">${icon("search")}<input id="search" placeholder="${label("Search your scores")}" aria-label="${label("Search your scores")}"></label><div id="library-list" class="score-list">${rows(library)}</div><p class="muted">${label("Storage is not a backup. Export your projects regularly.")}</p>`;
}
function scanView() {
  const url = pages[pageIndex] ? URL.createObjectURL(pages[pageIndex]) : "";
  if (url) urls.push(url);
  return `<div class="page-heading"><div><p class="eyebrow">ON-DEVICE OMR / CPU WASM</p><h1>${label("Scan sheet music")}</h1></div>${button("Add pages", "add-pages", "", "plus")}</div><div class="scan-layout"><div class="scan-preview">${url ? `<img src="${url}" alt="Score page ${pageIndex + 1}">` : `<div class="empty">${icon("scan")}<p>${label("Select a page to review before recognition.")}</p>${button("Camera", "capture", "primary", "scan")}${button("Import score", "add-pages", "", "import")}</div>`}</div><div class="scan-tools panel"><label>Title<input id="scan-title" value="${e(scanName)}" placeholder="Untitled score" ${busy ? "disabled" : ""}></label><div class="page-strip">${pages.map((_, i) => `<button data-page="${i}" class="${i === pageIndex ? "selected" : ""}" ${busy ? "disabled" : ""}>${i + 1}${i < scanXml.length ? " ✓" : ""}</button>`).join("")}</div><p class="muted">${label("Select a page to review before recognition.")}</p><div class="row">${button("Rotate", "rotate")}${button("Delete", "remove-page", "danger")}</div><label>${label("Deskew (degrees)")}<input id="deskew" type="number" min="-15" max="15" value="0" step="0.5"></label><label>${label("Crop left / top / right / bottom (%)")}</label><div class="crop-inputs">${[0, 0, 100, 100].map((v, i) => `<input id="crop-${i}" aria-label="${["Left", "Top", "Right", "Bottom"][i]} percent" type="number" min="0" max="100" value="${v}">`).join("")}</div><label class="check-label"><input id="enhance" type="checkbox">${label("Enhance contrast")}</label>${button("Apply to page", "apply-page")}<hr><p class="fine">homr performs staff detection, contrast normalization and staff dewarping. Review difficult perspective manually.</p><p class="fine">${language === "tr" ? "İlk kullanımda yaklaşık 158 MB model indirilir. Tanıma yereldir." : "First use downloads about 158 MB of models. Recognition stays on this device."}</p><div id="scan-status" class="status-text" role="status" aria-live="polite">${e(status)}</div>${busy ? `<progress aria-label="Recognition in progress"></progress>${button("Cancel", "cancel-scan", "danger")}` : button("Recognize locally", "recognize", "primary wide", "scan")}<p class="fine">${scanXml.length} / ${pages.length} pages recognized. ${scanXml.length ? button("Export", "export-progress", "text-button") : ""}</p></div></div>`;
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
  return `<div class="player-heading"><div><p class="eyebrow">${pianoOnly ? "INSTRUMENT / A0–C8" : project?.pages.length ? "RECOGNIZED SCORE" : "MUSIC WORKSPACE"}</p><h1>${e(pianoOnly ? t("Virtual piano") : project?.title || t("Workspace"))}</h1><p class="score-meta">${timeline && !pianoOnly ? `${timeline.measures.length} measures · ${timeline.notes.length} notes · ${label(project?.reviewed ? "Saved on this device" : "Review required")}` : label("No uploads. No accounts. Yours.")}</p></div><div class="row">${project ? button("Export", "export", "", "download") : ""}${button("Fullscreen", "fullscreen", "text-button")}</div></div>${!pianoOnly && timeline ? `<div class="workspace-tabs" role="tablist">${["score", "compare", "original", "editor"].map((m) => `<button role="tab" aria-selected="${mode === m}" data-mode="${m}" class="${mode === m ? "selected" : ""}">${label(m === "score" ? "Score" : m === "compare" ? "Compare" : m === "original" ? "Original" : "Review notes")}</button>`).join("")}<span class="review-count">${timeline.warnings.length ? `${timeline.warnings.length} review notes` : "Review recognition before practice"}</span></div>${timeline.warnings.length ? `<details class="warnings"><summary>${timeline.warnings.length} playback / recognition notices</summary><ul>${timeline.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></details>` : ""}${reviewPanel()}<div class="score-workspace">${mode === "editor" ? editor() : mode === "original" ? originalView() : mode === "compare" ? `<div class="score-compare"><section><h3>${label("Original")}</h3>${originalView()}</section><section><h3>${label("Score")}</h3><div id="notation" class="notation"></div></section></div>` : `<div id="notation" class="notation" aria-label="Reconstructed sheet music"></div>`}</div><div class="measure-navigation"><span>${label("Select measures below to seek.")}</span><div class="measure-strip">${timeline.measures.map((m) => `<button data-measure="${m.index}" title="Seek to measure ${e(m.number)}">${e(m.number)}</button>`).join("")}</div></div>${voiceControls()}` : pianoOnly ? "" : `<div class="empty">${icon("music")}<p>${label("Open a score to start listening.")}</p>${button("Import score", "import", "primary")}</div>`}<div class="instrument-strip"><label>${label("Instrument")}<select id="instrument" aria-label="${label("Instrument")}">${instrumentNames.map((n, i) => `<option value="${i}" ${i === audio.instruments.program ? "selected" : ""}>${String(i + 1).padStart(3, "0")} · ${n.replaceAll("_", " ")}</option>`).join("")}</select></label><label>${label("Transpose")}<input id="transpose" type="number" value="${audio.transpose}" min="-24" max="24"></label><label>${label("Volume")}<input id="volume" type="range" value="${audio.volume}" min="0" max="1" step="0.01"></label><div class="piano-mode">${button(roll ? "Keyboard" : "Piano roll", "toggle-roll", "text-button")}${button("Zoom", "zoom", "text-button")}</div></div><div class="live-toolbar">${button("Enable audio", "enable-live")}${button("Connect MIDI", "connect-midi")}${button("All notes off", "panic")}<span id="live-status"></span></div><div id="piano" class="piano-scroll"></div><div class="keyboard-meta"><span>A0 — C8 · 88 keys</span><span id="active-names" aria-live="off"></span><label><input id="auto-keys" type="checkbox" ${auto ? "checked" : ""}>${label("Auto-position keys")}</label></div>${!pianoOnly ? transport() : ""}`;
}
function reviewPanel() {
  if (!project?.pages.length) return "";
  const rows = reviewEncoding(project.xml),
    issues = rows.filter((r) => r.issues.length);
  return `<details class="encoding-review"><summary>${language === "tr" ? "Tanıma incelemesi gerekli" : "Recognition needs review"} · ${issues.length} ${language === "tr" ? "yapısal zamanlama uyarısı (doğruluk puanı değil)" : "structural timing notices (not an accuracy score)"}</summary><p>${language === "tr" ? "Bu denetim doğruluk puanı değildir. Bağları, susları, akorları ve metinleri orijinalle karşılaştırın. Otomatik kirişleme yalnızca çizimi düzeltir." : "This is not an accuracy score. Compare ties, rests, chords and text against the original. Automatic beaming only changes engraving."}</p><div class="audit-scroll"><table><thead><tr><th>Part / measure</th><th>Quarter beats</th><th>Encoded ties</th><th>Review</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${e(r.part)} / ${e(r.measure)}</td><td>${r.encoded} / ${r.expected}</td><td>${r.ties}</td><td>${r.issues.map(e).join("<br>") || "No structural mismatch detected; image review required."}</td></tr>`).join("")}</tbody></table></div></details>`;
}
function originalView() {
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
function editor() {
  if (!timeline) return "";
  const n = timeline.notes[Math.min(selectedNote, timeline.notes.length - 1)];
  if (!n) return "<p>No playable notes to edit.</p>";
  return `<div class="editor"><div><h2>${label("Review notes")}</h2><p class="muted">Compare the original with reconstructed notation. Corrections update playback and MusicXML.</p><label>Note<select id="edit-select">${timeline.notes.map((n, i) => `<option value="${i}" ${i === selectedNote ? "selected" : ""}>Measure ${n.measure + 1} · ${noteName(n.pitch)} · staff ${n.staff} / voice ${e(n.voice)} · beat ${n.beat}</option>`).join("")}</select></label><div class="edit-fields"><label>Score tempo (BPM)<input id="score-tempo" type="number" min="20" max="300" value="${timeline.tempos[0].bpm}"></label><label>Tempo instruction (from original)<input id="tempo-words" placeholder="Slowly, steady tempo"></label>${button("Save score tempo", "save-tempo")}</div><div class="edit-fields"><label>${label("Pitch")}<select id="edit-pitch">${Array.from({ length: 128 }, (_, p) => `<option value="${p}" ${p === n.pitch ? "selected" : ""}>${noteName(p)} · MIDI ${p}</option>`).join("")}</select></label><label>${label("Duration (beats)")}<input id="edit-duration" type="number" min="0.03125" step="0.125" value="${n.duration}"></label><label>${label("Start (beats)")}<input id="edit-onset" type="number" min="0" step="0.125" value="${n.beat}"></label></div><p class="fine">Durations change subsequent timing in the same MusicXML voice. Tied durations/onsets require an external notation editor. Move a leading chord note to move its chord. Onset edits stay inside the original measure. Accidentals are encoded by the selected chromatic pitch.</p><div class="row">${button("Apply correction", "correct", "primary")}${button("Tie to next note", "tie-next")}${button("Remove tie", "untie")}${button("Mark reviewed", "reviewed")}</div></div><div class="review-original">${originalView()}</div></div>`;
}
function transport() {
  return `<div class="transport"><div class="transport-main"><div class="transport-buttons"><button data-action="restart" class="icon-button" aria-label="${label("Restart")}">${icon("restart")}</button><button data-action="play" id="play" class="play-button" aria-label="${label(audio.playing ? "Pause" : "Play")}">${icon(audio.playing ? "pause" : "play")}</button><button data-action="stop" class="icon-button" aria-label="${label("Stop")}">${icon("stop")}</button></div><output id="clock">0:00 / ${clock(timeline ? beatToSeconds(timeline.duration, timeline.tempos, audio.speed) : 0)}</output><input id="seek" type="range" min="0" max="${timeline?.duration || 1}" step="0.01" value="${audio.position}" aria-label="Seek playback"><label class="tempo-label">${label("Tempo")}<span><input id="tempo" type="number" min="20" max="300" value="${Math.round((timeline?.tempos[0]?.bpm || 120) * audio.speed)}"> BPM</span></label></div><div class="transport-options"><label><input id="follow" type="checkbox" ${follow ? "checked" : ""}>${label("Follow score")}</label><label><input id="metronome" type="checkbox" ${audio.metronome ? "checked" : ""}>${label("Metronome")}</label><label>${label("Loop measures")}<input id="loop-start" type="number" min="1" max="${timeline?.measures.length || 1}" value="1" aria-label="Loop first measure"><span>–</span><input id="loop-end" type="number" min="1" max="${timeline?.measures.length || 1}" value="${timeline?.measures.length || 1}" aria-label="Loop last measure"><input id="loop-on" type="checkbox" ${audio.loop ? "checked" : ""} aria-label="Enable measure loop"></label></div></div>`;
}
function settings() {
  return `<div class="page-heading"><div><p class="eyebrow">YOUR DEVICE / YOUR MUSIC</p><h1>${label("Settings")}</h1></div></div><div class="settings-grid">${hardwarePanel()}<section class="panel"><h2>Appearance</h2><label>${label("Theme")}<select id="theme"><option value="dark" ${theme === "dark" ? "selected" : ""}>${label("Dark")}</option><option value="light" ${theme === "light" ? "selected" : ""}>${label("Light")}</option></select></label><label>${label("Language")}<select id="language"><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="tr" ${language === "tr" ? "selected" : ""}>Türkçe</option></select></label></section><section class="panel"><h2>${label("Offline assets")}</h2><p id="offline-detail">Checking local assets…</p><p id="storage-detail" class="muted"></p><div class="stack">${button("Prepare offline use", "offline", "primary")}${button("Download recognition models", "models")}${button("Request persistent storage", "persist")}${button("Clear recognition models", "clear-models", "text-button danger")}</div><div id="asset-status" role="status"></div><p class="fine">The app shell, piano samples and recognition assets can be stored offline. Other GM instruments download on first selection. Only the piano and latest selected bank are retained. Browser storage can be evicted.</p></section><section class="panel"><h2>${label("Install on iPhone")}</h2><ol><li>Open the app’s HTTPS address in Safari.</li><li>Tap Share, then Add to Home Screen.</li><li>Open modScore from its icon and prepare offline use there.</li><li>Keep the app open until downloads complete; export a backup of your library.</li></ol><p class="fine">No App Store or Apple developer account. Safari and installed apps may have separate storage. Physical iPhone XS / iOS 18 testing is pending.</p></section><section class="panel"><h2>${label("Privacy")}</h2><p>Photographs, scores, recognition and playback stay on your device. No accounts, analytics, ads or cloud uploads.</p><p>Initial model/library assets come from this host. Optional instrument downloads request a pinned FluidR3 bank from GitHub; no score data is sent.</p><h3>${label("Source & licenses")}</h3><p><a href="${assetPath("about/")}" target="_blank" rel="noopener">About modScore · Setup guide</a> · <a href="https://github.com/WeAreTheArtMakers/modScore" target="_blank" rel="noopener">GitHub</a></p><p>modScore is free software under AGPL-3.0-only, without warranty. You may modify and redistribute under the license.</p><div class="row"><a href="${assetPath("source.tar.gz")}" download>Corresponding source</a><a href="${assetPath("LICENSE")}" target="_blank" rel="noopener">AGPL-3.0</a><a href="${assetPath("THIRD_PARTY_NOTICES.md")}" target="_blank" rel="noopener">Attributions</a></div><p class="fine">Recognition: Partsong / homr-rs / homr. Model training-data provenance caveats are documented in the notices. Samples: FluidR3, Frank Wen, CC BY 3.0.</p></section></div>`;
}
function render() {
  revision++;
  const rev = revision;
  piano?.dispose();
  piano = undefined;
  sheet.clear();
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
  };
  app.innerHTML = `<aside class="sidebar"><a href="#" class="brand" data-action="home"><span class="brand-mark">m<span>♮</span></span>mod<span>Score</span></a><p class="sidebar-caption">YOUR MUSIC STUDIO</p><nav aria-label="Main">${[
    ["home", "Workspace", "home"],
    ["library", "My scores", "library"],
    ["piano", "Virtual piano", "piano"],
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
    )}</nav><div class="sidebar-bottom"><span class="offline-status" id="offline-status">Checking offline assets…</span>${button("Settings", "settings", `nav-item ${view === "settings" ? "selected" : ""}`, "settings")}<span class="version">modScore 0.3 · Free & open source</span></div></aside><div class="shell"><header class="topbar"><span>${label(titles[view] || "Workspace")}</span><div class="topbar-right"><span class="local-badge">${icon("shield")}ON YOUR DEVICE</span>${button("Scan sheet music", "capture", "small-button", "plus")}</div></header><main class="view view-${view}">${view === "home" ? home() : view === "library" ? libraryView() : view === "scan" ? scanView() : view === "settings" ? settings() : playerView(view === "piano")}</main></div><input id="files" type="file" accept="image/*,application/pdf,.musicxml,.xml,.mid,.midi,.json" multiple hidden><input id="camera" type="file" accept="image/*" capture="environment" hidden><dialog id="export-dialog"><form method="dialog"><button class="dialog-close icon-button" aria-label="${label("Close")}">${icon("close")}</button></form><h2>${label("Export")}</h2><div class="stack">${["Project backup (.modscore.json)", "MusicXML (.musicxml)", "MIDI (.mid)", "Audio WAV (.wav)", "Original files", "All library projects"].map((s, i) => `<button data-export-type="${i}">${e(s)}</button>`).join("")}</div><p class="fine">Project backups preserve images and notation. MIDI and WAV reflect tempo and transpose. WAV reflects mute/solo; MIDI includes every track.</p></dialog>`;
  bind();
  if (view === "player" || view === "piano") {
    piano = new Piano(document.querySelector("#piano")!, audio);
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
            if (rev === revision) sheet.update(audio.position, false);
          })
          .catch((err) => toast(`Notation: ${err.message}`, true));
    }
  }
  refreshHardware();
  void updateReadiness();
}
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
async function navigate(next: string) {
  if (busy) {
    toast("Cancel the current recognition before leaving.", true);
    return;
  }
  audio.pause();
  live.panic();
  view = next;
  if (next === "home" || next === "library") await refreshLibrary();
  render();
}
async function openProject(p: Project) {
  audio.stop();
  project = p;
  if (!p.xml) {
    pages = [...p.pages];
    originals = [...p.originals];
    scanId = p.id;
    scanName = p.title;
    scanXml = (p as any).recognizedPages || [];
    view = "scan";
    render();
    return;
  }
  timeline = parseMusicXML(p.xml, p.title);
  audio.timeline = timeline;
  audio.speed = 1;
  audio.transpose = 0;
  selectedNote = 0;
  audio.loop = undefined;
  audio.voices.clear();
  mode = "score";
  view = "player";
  render();
}
async function saveImportDraft(source = originals) {
  if (!pages.length) return;
  await saveScore({
    id: scanId,
    title: scanName || "Imported score",
    xml: "",
    pages: [...pages],
    originals: [...source],
    recognizedPages: [...scanXml],
    created: Date.now(),
    updated: Date.now(),
    reviewed: false,
  });
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
    await saveScore({ ...draft, recognizedPages: scanXml } as Project);
    for (let i = scanXml.length; i < pages.length; i++) {
      if (cancelled) break;
      pageIndex = i;
      status = `Recognizing page ${i + 1} of ${pages.length}…`;
      render();
      scanXml.push(await recognizer.recognize(pages[i]));
      parseMusicXML(scanXml[i]);
      await saveScore({ ...draft, recognizedPages: scanXml } as Project);
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
  } finally {
    busy = false;
    recognizer.dispose();
    if (view === "scan") render();
  }
}
async function persist() {
  if (!project) return;
  await saveScore(project);
  toast(t("Saved on this device"));
}
async function action(name: string) {
  switch (name) {
    case "enable-live":
      await audio.activate();
      await audio.instruments.prepare(audio.context!, []);
      toast("Ses hazır. A W S E D F T G Y H U J K · Z/X oktav");
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
      const xml = await (await fetch(assetPath("fixtures/grand-staff.musicxml"))).text();
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
      busy = false;
      status = "Cancelled; pages are preserved.";
      render();
      break;
    case "rotate":
      if (pages[pageIndex]) {
        pages[pageIndex] = await normalise(pages[pageIndex], 90);
        scanXml = [];
        render();
      }
      break;
    case "remove-page":
      pages.splice(pageIndex, 1);
      pageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
      scanXml = [];
      render();
      break;
    case "apply-page": {
      if (!pages[pageIndex]) throw Error("Select a page first.");
      const crop = [0, 1, 2, 3].map((i) =>
        Number(
          (document.querySelector(`#crop-${i}`) as HTMLInputElement).value,
        ),
      );
      if (crop.some((n) => !Number.isFinite(n) || n < 0 || n > 100))
        throw Error("Crop percentages must be between 0 and 100.");
      pages[pageIndex] = await normalise(
        pages[pageIndex],
        Number((document.querySelector("#deskew") as HTMLInputElement).value),
        crop,
        (document.querySelector("#enhance") as HTMLInputElement).checked,
      );
      scanXml = [];
      render();
      break;
    }
    case "play": {
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
      audio.stop();
      updatePlay();
      break;
    case "restart":
      audio.seek(0);
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
    case "untie":
      if (project && timeline) {
        audio.stop();
        const selected = timeline.notes[selectedNote];
        project.xml =
          name === "tie-next"
            ? tieNext(project.xml, selected)
            : untie(project.xml, selected);
        timeline = parseMusicXML(project.xml, project.title);
        audio.timeline = timeline;
        selectedNote = Math.min(selectedNote, timeline.notes.length - 1);
        project.reviewed = false;
        await persist();
        render();
      }
      break;
    case "save-tempo":
      if (project) {
        audio.stop();
        project.xml = setScoreTempo(
          project.xml,
          Number(
            (document.querySelector("#score-tempo") as HTMLInputElement).value,
          ),
          (document.querySelector("#tempo-words") as HTMLInputElement).value,
        );
        timeline = parseMusicXML(project.xml, project.title);
        audio.timeline = timeline;
        audio.speed = 1;
        await persist();
        render();
      }
      break;
    case "correct":
      if (project && timeline) {
        const note = timeline.notes[selectedNote],
          pitch = Number(
            (document.querySelector("#edit-pitch") as HTMLSelectElement).value,
          ),
          duration = Number(
            (document.querySelector("#edit-duration") as HTMLInputElement)
              .value,
          );
        audio.stop();
        let corrected = amendOnset(
          project.xml,
          note,
          Number(
            (document.querySelector("#edit-onset") as HTMLInputElement).value,
          ),
        );
        project.xml = amendNote(corrected, note, pitch, duration);
        timeline = parseMusicXML(project.xml, project.title);
        audio.timeline = timeline;
        project.reviewed = false;
        await persist();
        render();
      }
      break;
    case "reviewed":
      if (project) {
        project.reviewed = true;
        await persist();
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
function bind() {
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
  app
    .querySelectorAll<HTMLElement>("[data-measure]")
    .forEach(
      (n) =>
        (n.onclick = () =>
          audio.seek(timeline!.measures[Number(n.dataset.measure)].beat)),
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
  on("seek", "input", (ev) =>
    audio.seek(Number((ev.target as HTMLInputElement).value)),
  );
  on(
    "follow",
    "change",
    (ev) => (follow = (ev.target as HTMLInputElement).checked),
  );
  on(
    "auto-keys",
    "change",
    (ev) => (auto = (ev.target as HTMLInputElement).checked),
  );
  on(
    "metronome",
    "change",
    (ev) => (audio.metronome = (ev.target as HTMLInputElement).checked),
  );
  const setLoop = () => {
    const checked = (document.querySelector("#loop-on") as HTMLInputElement)
      .checked;
    const a =
        Number(
          (document.querySelector("#loop-start") as HTMLInputElement).value,
        ) - 1,
      b =
        Number(
          (document.querySelector("#loop-end") as HTMLInputElement).value,
        ) - 1;
    if (checked) {
      if (
        !timeline ||
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < a ||
        b >= timeline.measures.length
      )
        throw Error("Choose a valid first and last measure.");
      audio.loop = [
        timeline.measures[a].beat,
        timeline.measures[b].beat + timeline.measures[b].duration,
      ];
    } else audio.loop = undefined;
    audio.seek(audio.now());
  };
  for (const id of ["loop-on", "loop-start", "loop-end"])
    on(id, "change", setLoop);
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
  on("edit-select", "change", (ev) => {
    selectedNote = Number((ev.target as HTMLSelectElement).value);
    render();
  });
  on("theme", "change", (ev) => {
    theme = (ev.target as HTMLSelectElement).value;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("modscore-theme", theme);
  });
  on("language", "change", (ev) => {
    setLanguage((ev.target as HTMLSelectElement).value);
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
    menu.innerHTML = `<summary>Score actions</summary><div class="row"><label>Title<input id="rename-title" value="${e(project.title)}"></label>${button("Rename", "rename")}${button("Save", "save")}${button("Delete", "delete", "danger")}</div>`;
    document.querySelector(".player-heading")!.after(menu);
    menu.querySelector('[data-action="rename"]')!.addEventListener(
      "click",
      safe(async () => {
        const title = (
          menu.querySelector("#rename-title") as HTMLInputElement
        ).value.trim();
        if (!title) throw Error("Enter a title");
        project!.title = title;
        await persist();
        render();
      }),
    );
    menu
      .querySelector('[data-action="save"]')!
      .addEventListener("click", safe(persist));
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
  if (!project || !timeline) throw Error("Open a score first.");
  const name = project.title.replace(/[\\/:*?"<>|]/g, "-");
  if (type === 0)
    download(await exportProject(project), name + ".modscore.json");
  if (type === 1)
    download(
      new Blob([project.xml], {
        type: "application/vnd.recordare.musicxml+xml",
      }),
      name + ".musicxml",
    );
  if (type === 2)
    download(exportMidi(timeline, audio.transpose, audio.speed), name + ".mid");
  if (type === 3) {
    audio.pause();
    await audio.activate();
    await audio.prepare();
    toast("Rendering WAV locally…");
    download(await audio.wav(), name + ".wav");
  }
  if (type === 4) {
    if (!project.originals.length)
      throw Error("No original files for this score");
    project.originals.forEach((b, i) =>
      download(
        b,
        `${name}-original-${i + 1}.${b.type === "application/pdf" ? "pdf" : b.type.includes("png") ? "png" : b.type.includes("xml") ? "musicxml" : b.type.startsWith("image/") ? "jpg" : "bin"}`,
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
      const base = new URL(assetPath("recognition/models/" + name), location.origin).href;
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
    const ready = sw && models && shellReady;
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
  await navigator.serviceWorker.ready;
  const r = await fetch(assetPath("offline-assets.json"));
  if (!r.ok) throw Error("Build the production app to prepare offline assets.");
  const paths: string[] = await r.json();
  const cache = await caches.open("modscore-offline-" + encodeURIComponent(import.meta.env.BASE_URL) + "-v1");
  for (let i = 0; i < paths.length; i++) {
    const path = assetPath(paths[i]);
    if (!(await cache.match(path))) {
      const res = await fetch(path);
      if (!res.ok) throw Error(`Could not store ${path}`);
      await cache.put(path, res);
    }
    const node = document.querySelector("#asset-status");
    if (node)
      node.textContent = `Stored ${i + 1} / ${paths.length} application assets`;
  }
  await recognizer.init();
  recognizer.dispose();
  await updateReadiness();
  toast(
    "Offline assets downloaded. Close and reopen the app once, then verify in airplane mode.",
  );
}
function frame() {
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
      node.value = `${clock(beatToSeconds(beat, timeline.tempos, audio.speed))} / ${clock(beatToSeconds(timeline.duration, timeline.tempos, audio.speed))}`;
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
      sheet.update(beat, follow && audio.playing);
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
    audio.pause();
    updatePlay();
  }
});
window.addEventListener("pagehide", () => audio.pause());
window.addEventListener("online", () => void updateReadiness());
window.addEventListener("offline", () => void updateReadiness());
if (import.meta.env.PROD && "serviceWorker" in navigator)
  void navigator.serviceWorker
    .register(assetPath("sw.js"), { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      updateCleanup?.();
      updateCleanup = watchUpdates(reg, navigator.serviceWorker, async () => {
        if (busy)
          throw Error(
            language === "tr"
              ? "Önce taramayı bitirin veya iptal edin."
              : "Finish or cancel recognition before updating.",
          );
        audio.pause();
        if (project) await saveScore(project);
      });
    })
    .catch((err) => console.warn("Offline install:", err));
void refreshLibrary()
  .then(render)
  .catch((err) => {
    render();
    toast(`Library: ${err.message}`, true);
  });
requestAnimationFrame(frame);
