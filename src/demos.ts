import { assetPath } from "./paths";
import { listScores, saveScore, type Project } from "./storage";
export const DEMO_SEEN = "modscore-welcome-v1";
export const demos = [
  {
    key: "basic",
    id: "modscore-demo-basic-v3",
    title: "Basic Music",
    composer: "Baran Gulesen",
    subtitle: "35 bars · C minor · 3 flats · 110 BPM · repeat",
    bars: 35,
    description:
      "From the composer’s score and recording · C minor, three flats · revised ties and melodic lines.",
    descriptionTr:
      "Bestecinin nota ve kaydından · Do minör, üç bemol · düzeltilmiş bağlar ve melodik çizgiler.",
    path: "demos/basic-music.musicxml",
    reviewed: false,
    source: "https://www.youtube.com/watch?v=AN0wGBUxkIk",
    pdf: undefined,
  },
  {
    key: "beethoven",
    id: "modscore-demo-beethoven-v1",
    title: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    subtitle: "32-bar piano study · 96 BPM",
    bars: 32,
    description: "A 32-bar piano arrangement of Beethoven’s theme.",
    descriptionTr: "Beethoven’ın temasından 32 ölçülük piyano düzenlemesi.",
    path: "demos/beethoven-ode-to-joy-32.musicxml",
    reviewed: true,
    source: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=528",
    pdf: undefined,
  },
  {
    key: "bach-invention",
    id: "modscore-demo-bach-invention-v1",
    title: "Invention No. 1 · BWV 772",
    composer: "Johann Sebastian Bach",
    subtitle: "Complete · 22 bars · two-part counterpoint · 96 BPM",
    bars: 22,
    description:
      "Complete two-part invention · Mutopia / Bach-Gesellschaft source · practice tempo 96 BPM. Ornament symbols are shown; playback follows principal notes.",
    descriptionTr:
      "İki sesli invention’ın tamamı · Mutopia / Bach-Gesellschaft kaynağı · çalışma temposu 96 BPM. Süslemeler gösterilir; çalma ana notaları izler.",
    path: "demos/bach-invention-01.musicxml",
    reviewed: true,
    source: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40",
    pdf: "demos/sources/bach-invention-01-a4.pdf",
  },
  {
    key: "bach-prelude",
    id: "modscore-demo-bach-prelude-v1",
    title: "Prelude in C major · BWV 846",
    composer: "Johann Sebastian Bach",
    subtitle: "Complete · 35 bars · arpeggios & held voices · 60 BPM",
    bars: 35,
    description:
      "Complete prelude · original arpeggios and held bass voices · public-domain Mutopia edition.",
    descriptionTr:
      "Prelüdün tamamı · özgün arpejler ve tutulan bas sesleri · kamu malı Mutopia edisyonu.",
    path: "demos/bach-prelude-bwv846.musicxml",
    reviewed: true,
    source: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5",
    pdf: "demos/sources/wtk1-prelude1-a4.pdf",
  },
  {
    key: "mozart",
    id: "modscore-demo-mozart-k545-v1",
    title: "Piano Sonata K. 545 · Allegro",
    composer: "Wolfgang Amadeus Mozart",
    subtitle: "Original opening · bars 1–12 · fast scales · 132 BPM",
    bars: 12,
    description:
      "Original measures 1–12, not the complete movement · music21 MusicXML source; Mutopia PDF for comparison.",
    descriptionTr:
      "Özgün 1–12. ölçüler; bölümün tamamı değil · music21 MusicXML kaynağı; karşılaştırma için Mutopia PDF.",
    path: "demos/mozart-k545-opening.musicxml",
    reviewed: true,
    source:
      "https://github.com/cuthbertLab/music21/blob/master/music21/corpus/mozart/k545/movement1_exposition.mxl",
    pdf: "demos/sources/K545-1-a4.pdf",
  },
];
export async function demoProject(key: string): Promise<Project> {
  const demo = demos.find((d) => d.key === key);
  if (!demo) throw Error("Unknown demo");
  const existing = (await listScores()).find((p) => p.id === demo.id);
  if (existing) return existing;
  const response = await fetch(assetPath(demo.path));
  if (!response.ok) throw Error("Demo score could not be loaded.");
  const project: Project = {
    id: demo.id,
    title: demo.title,
    xml: await response.text(),
    pages: [],
    originals: [],
    created: Date.now(),
    updated: Date.now(),
    reviewed: demo.reviewed,
  };
  await saveScore(project);
  return project;
}
