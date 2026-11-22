import { assetPath } from "./paths";
import { listScores, saveScore, type Project } from "./storage";
export const DEMO_SEEN = "modscore-welcome-v1";
export const demos = [
  {
    key: "basic",
    id: "modscore-demo-basic-v1",
    title: "Basic Music",
    composer: "Baran Gulesen",
    subtitle: "32 bars · 112 BPM · automatic transcription",
    path: "demos/basic-music-32.musicxml",
    reviewed: false,
    source: "https://www.youtube.com/watch?v=AN0wGBUxkIk",
  },
  {
    key: "beethoven",
    id: "modscore-demo-beethoven-v1",
    title: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    subtitle: "32-bar piano study · 96 BPM",
    path: "demos/beethoven-ode-to-joy-32.musicxml",
    reviewed: true,
    source: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=528",
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
