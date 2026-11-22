export interface Project {
  id: string;
  title: string;
  xml: string;
  pages: Blob[];
  originals: Blob[];
  created: number;
  updated: number;
  reviewed: boolean;
  recognizedPages?: string[];
  performance?: {
    notes: {
      pitch: number;
      beat: number;
      duration: number;
      velocity?: number;
    }[];
    bpm: number;
    key: { fifths: number; mode: "major" | "minor" };
    sourceStart: number;
    grid: number;
    meter: { beats: number; beatType: number };
  };
  reference?: { url: string; title: string };
}
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("modscore-library", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("scores", { keyPath: "id" });
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        opening = undefined;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      opening = undefined;
      reject(r.error);
    };
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("scores", mode);
    const request = action(tx.objectStore("scores"));
    let result: T;
    request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || Error("Score transaction aborted"));
  });
}
export const listScores = () =>
  transaction("readonly", (s) => s.getAll()) as Promise<Project[]>;
export const saveScore = (p: Project) =>
  transaction("readwrite", (s) => s.put({ ...p, updated: Date.now() }));
export const deleteScore = (id: string) =>
  transaction("readwrite", (s) => s.delete(id));
const encode = async (b: Blob) => ({
  type: b.type,
  data: await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  }),
});
export async function exportProject(p: Project) {
  return new Blob(
    [
      JSON.stringify({
        format: "modscore",
        version: 1,
        ...p,
        pages: await Promise.all(p.pages.map(encode)),
        originals: await Promise.all(p.originals.map(encode)),
      }),
    ],
    { type: "application/json" },
  );
}
export function validateProject(value: unknown): Project {
  const v = value as Record<string, any>;
  if (
    !v ||
    v.format !== "modscore" ||
    v.version !== 1 ||
    typeof v.xml !== "string" ||
    typeof v.title !== "string" ||
    !Array.isArray(v.pages) ||
    !Array.isArray(v.originals)
  )
    throw Error("Invalid modScore project");
  if (
    v.recognizedPages !== undefined &&
    (!Array.isArray(v.recognizedPages) ||
      v.recognizedPages.length > v.pages.length ||
      !v.recognizedPages.every((xml: unknown) => typeof xml === "string"))
  )
    throw Error("Invalid recognized-page progress");
  if (v.performance) {
    const p = v.performance;
    if (
      !Array.isArray(p.notes) ||
      p.notes.length > 100000 ||
      !p.notes.every(
        (n: any) =>
          Number.isInteger(n.pitch) &&
          n.pitch >= 21 &&
          n.pitch <= 108 &&
          Number.isFinite(n.beat) &&
          n.beat >= 0 &&
          n.beat <= 100000 &&
          Number.isFinite(n.duration) &&
          n.duration > 0 &&
          n.duration <= 4096 &&
          (n.velocity === undefined ||
            (Number.isFinite(n.velocity) &&
              n.velocity >= 0 &&
              n.velocity <= 1)),
      ) ||
      !Number.isFinite(p.bpm) ||
      p.bpm < 40 ||
      p.bpm > 240 ||
      !Number.isFinite(p.sourceStart) ||
      p.sourceStart < 0 ||
      !p.key ||
      !Number.isInteger(p.key.fifths) ||
      Math.abs(p.key.fifths) > 7 ||
      !["major", "minor"].includes(p.key.mode) ||
      ![0.125, 0.25, 0.5].includes(p.grid) ||
      !p.meter ||
      !Number.isInteger(p.meter.beats) ||
      p.meter.beats < 1 ||
      p.meter.beats > 16 ||
      ![2, 4, 8, 16].includes(p.meter.beatType)
    )
      throw Error("Invalid audio performance");
  }
  const decode = (p: any) => {
    if (!p || typeof p.type !== "string" || typeof p.data !== "string")
      throw Error("Invalid project image");
    return new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], {
      type: p.type,
    });
  };
  return {
    id: crypto.randomUUID(),
    title: v.title,
    xml: v.xml,
    pages: v.pages.map(decode),
    originals: v.originals.map(decode),
    created: Date.now(),
    updated: Date.now(),
    reviewed: !!v.reviewed,
    recognizedPages: v.recognizedPages ? [...v.recognizedPages] : undefined,
    performance: v.performance
      ? {
          notes: v.performance.notes.map((n: any) => ({
            pitch: n.pitch,
            beat: n.beat,
            duration: n.duration,
            velocity: n.velocity,
          })),
          bpm: v.performance.bpm,
          key: { ...v.performance.key },
          sourceStart: v.performance.sourceStart,
          grid: v.performance.grid,
          meter: { ...v.performance.meter },
        }
      : undefined,
    reference:
      v.reference &&
      typeof v.reference.url === "string" &&
      /^https:\/\/(www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(
        v.reference.url,
      )
        ? {
            url: v.reference.url,
            title: String(v.reference.title || "YouTube source").slice(0, 200),
          }
        : undefined,
  };
}
export async function storageStatus() {
  const q = await navigator.storage?.estimate?.();
  return {
    usage: q?.usage || 0,
    quota: q?.quota || 0,
    persisted: (await navigator.storage?.persisted?.()) || false,
  };
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
