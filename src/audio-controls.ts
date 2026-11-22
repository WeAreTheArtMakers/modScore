import { keyChoices } from "./notation";
export interface AudioSettings {
  bpm: number;
  bars: number;
  key: string;
  meter: string;
  grid: number;
  profile: string;
  start: number;
  autoTempo: boolean;
  chords: boolean;
}
export function audioControls(s: AudioSettings, tr: boolean) {
  return `<div class="audio-fields"><label>BPM<input id="audio-bpm" type="number" min="40" max="240" value="${s.bpm}" ${s.autoTempo ? "disabled" : ""}></label><label>${tr ? "Ölçü sayısı" : "Measures"}<select id="audio-bars">${[8, 16, 32, 64].map((n) => `<option ${s.bars === n ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><label class="check-label"><input id="audio-auto-tempo" type="checkbox" ${s.autoTempo ? "checked" : ""}>${tr ? "BPM önerisini sesten bul" : "Suggest BPM from audio"}</label><div class="audio-fields"><label>${tr ? "Ton / donanım" : "Key signature"}<select id="audio-key"><option value="auto">${tr ? "Otomatik öneri" : "Automatic suggestion"}</option>${keyChoices.map((k) => `<option value="${k.fifths}:${k.mode}" ${s.key === `${k.fifths}:${k.mode}` ? "selected" : ""}>${k.label} · ${k.fifths < 0 ? "♭".repeat(-k.fifths) : k.fifths > 0 ? "♯".repeat(k.fifths) : "♮"}</option>`).join("")}</select></label><label>${tr ? "Ölçü işareti" : "Time signature"}<select id="audio-meter">${["4/4", "3/4", "6/8"].map((m) => `<option ${s.meter === m ? "selected" : ""}>${m}</option>`).join("")}</select></label></div><label>${tr ? "Algılama" : "Detection"}<select id="audio-profile"><option value="piano" ${s.profile === "piano" ? "selected" : ""}>${tr ? "Piyano · dengeli" : "Piano · balanced"}</option><option value="clean" ${s.profile === "clean" ? "selected" : ""}>${tr ? "Temiz · zayıf ve kısa sesleri azalt" : "Cleaner · fewer weak/short detections"}</option><option value="detailed" ${s.profile === "detailed" ? "selected" : ""}>${tr ? "Ayrıntılı · hızlı pasajlar" : "Detailed · fast passages"}</option></select></label><details class="audio-notation-options"><summary>${tr ? "Nota yazımı ve kayıt bölümü" : "Notation and recording excerpt"}</summary><div class="audio-fields"><label>${tr ? "Ritim ızgarası" : "Notation grid"}<select id="audio-grid">${[
    [0.5, "1/8"],
    [0.25, "1/16"],
    [0.125, "1/32"],
  ]
    .map(
      ([n, label]) =>
        `<option value="${n}" ${s.grid === n ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><label>${tr ? "Başlangıç (saniye)" : "Start at (seconds)"}<input id="audio-start" type="number" min="0" max="600" step="0.1" value="${s.start}"></label></div><label class="check-label"><input id="audio-chords" type="checkbox" ${s.chords ? "checked" : ""}>${tr ? "Akor önerilerini göster" : "Show chord suggestions"}</label><p class="fine">${tr ? "Donanım yazımı düzenler; kromatik notalar korunur. Akor etiketleri öneridir ve yeni ses eklemez." : "The key controls spelling; chromatic notes are preserved. Chord labels are suggestions and add no notes."}</p></details><div class="audio-output-note">${tr ? "Performans MIDI: algılanan zamanları korur. Nota MIDI / MusicXML: seçtiğiniz ritim ızgarasını kullanır." : "Performance MIDI keeps detected timing. Score MIDI / MusicXML use your selected notation grid."}</div>`;
}
