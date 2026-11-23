import { inspectScan, restoreScanContrast } from "./image-preflight";
import { verifyRecognition } from "./recognition-review";
import { assetPath } from "./paths";
import { choosePdfPages, askPdfPassword } from "./pdf-selection";
export class Recognizer {
  private worker?: Worker;
  private pending = new Map<
    number,
    { resolve: (data: any) => void; reject: (error: Error) => void }
  >();
  private ready?: Promise<void>;
  private rejectInit?: (e: Error) => void;
  private next = 0;
  onProgress: (message: string) => void = () => {};
  logs: string[] = [];
  init() {
    return (this.ready ??= new Promise<void>((resolve, reject) => {
      this.rejectInit = reject;
      this.worker = new Worker(assetPath("recognition/omr-worker.js"), {
        type: "module",
      });
      this.worker.onerror = (e) =>
        this.fail(Error(e.message || "Recognition worker could not start. Check the local recognition assets."));
      this.worker.onmessage = ({ data }) => {
        if (data.type === "ready") resolve();
        if (data.type === "log") {
          this.logs.push(data.msg);
          if (this.logs.length > 200) this.logs.shift();
          this.onProgress(data.msg);
        }
        if (data.type === "progress") {
          this.onProgress(
            data.stage === "download"
              ? `Downloading recognition models · ${Math.round(data.loaded / 1e6)} MB in this model`
              : `${data.stage} · ${data.name || ""}`,
          );
        }
        if (data.type === "error") {
          this.fail(new Error(data.msg));
        }
        if (data.type === "result") {
          this.pending.get(data.id)?.resolve(data);
          this.pending.delete(data.id);
        }
      };
      this.worker.postMessage({
        type: "init",
        noGpu: true,
        ios: true,
        threads: 1,
      });
    }));
  }
  private async request(type: string, image: Blob, classes?: Uint8Array) {
    const worker = this.worker;
    const bytes = await image.arrayBuffer();
    if (!worker || this.worker !== worker)
      throw new DOMException("Recognition cancelled.", "AbortError");
    return new Promise<any>((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      const transfers: Transferable[] = [bytes];
      if (classes) transfers.push(classes.buffer as ArrayBuffer);
      try {
        worker.postMessage({ type, id, image: bytes, classes }, transfers);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async recognize(image: Blob) {
    this.logs = [];
    await this.init();
    const worker = this.worker;
    this.onProgress("Checking page angle and contrast…");
    image = await normalise(image, "auto");
    if (this.worker !== worker) throw new DOMException("Recognition cancelled.", "AbortError");
    this.onProgress("Finding staffs and correcting their perspective…");
    const layout = await this.request("layout", image);
    this.onProgress("Reading musical symbols…");
    const result = await this.request("recognise", image, layout.classes);
    const xml = result.xml as string;
    // Recreate per page so the previous encoder cannot overlap the next segnet.
    this.dispose();
    return { xml: verifyRecognition(xml, layout, this.logs), image };
  }
  cancel() {
    this.fail(
      new DOMException("Recognition cancelled. Imported pages are still available.", "AbortError"),
    );
  }
  private fail(e: Error) {
    this.rejectInit?.(e);
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
  }
  dispose() {
    this.fail(new Error("Recognition worker closed."));
    this.rejectInit = undefined;
  }
}
export async function normalise(
  blob: Blob,
  rotation: number | "auto" = 0,
  crop = [0, 0, 100, 100],
  enhance = false,
) {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "from-image",
  });
  let correction: ReturnType<typeof inspectScan> | undefined;
  if (rotation === "auto") {
    try {
      correction = inspectScan(bitmap);
    } catch (error) {
      bitmap.close();
      throw error;
    }
  }
  if (correction && !correction.rotation && !correction.levels) {
    bitmap.close();
    return blob;
  }
  const [left, top, right, bottom] = crop;
  const sx = (bitmap.width * left) / 100,
    sy = (bitmap.height * top) / 100,
    sw = (bitmap.width * (right - left)) / 100,
    sh = (bitmap.height * (bottom - top)) / 100;
  if (sw <= 0 || sh <= 0) {
    bitmap.close();
    throw Error("Crop must have a positive width and height");
  }
  const scale = Math.min(1, 2600 / Math.max(sw, sh));
  const r = ((rotation === "auto" ? correction?.rotation ?? 0 : rotation) * Math.PI) / 180;
  const w = Math.ceil(
      (Math.abs(Math.cos(r)) * sw + Math.abs(Math.sin(r)) * sh) * scale,
    ),
    h = Math.ceil(
      (Math.abs(Math.sin(r)) * sw + Math.abs(Math.cos(r)) * sh) * scale,
    );
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(r);
  ctx.filter = enhance ? "grayscale(1) contrast(1.4)" : "none";
  ctx.drawImage(
    bitmap,
    sx,
    sy,
    sw,
    sh,
    (-sw * scale) / 2,
    (-sh * scale) / 2,
    sw * scale,
    sh * scale,
  );
  bitmap.close();
  if (correction?.levels) restoreScanContrast(ctx, w, h, correction.levels);
  const output = await new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              Error("Image allocation failed. Close other tabs and retry."),
            ),
      "image/png",
    ),
  );
  c.width = c.height = 0;
  return output;
}
export async function* pdfImages(
  file: File,
  signal?: AbortSignal,
  options: { selectPages?: boolean; password?: boolean } = {},
): AsyncGenerator<Blob> {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("PDF import cancelled.", "AbortError");
  };
  check();
  const root = assetPath("lib/pdfjs-dist@6.4.299/");
  const pdf: any = await import(
    /* @vite-ignore */ new URL(
      root + "legacy/build/pdf.min.mjs",
      location.origin,
    ).href
  );
  check();
  pdf.GlobalWorkerOptions.workerSrc = root + "legacy/build/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  check();
  const task = pdf.getDocument({
    data,
    isEvalSupported: false,
    isImageDecoderSupported: false,
    cMapUrl: root + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: root + "standard_fonts/",
    wasmUrl: root + "wasm/",
    stopAtErrors: true,
  });
  let passwordError: Error | undefined;
  if (options.password)
    task.onPassword = (update: (password: string) => void, reason: number) => {
      void askPdfPassword(reason, signal)
        .then(update)
        .catch((e) => {
          passwordError = e;
          void task.destroy().catch(() => {});
        });
    };
  let rendering: any;
  const abort = () => {
    rendering?.cancel();
    void task.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    check();
    const doc = await task.promise;
    const selected =
      options.selectPages && doc.numPages > 1
        ? await choosePdfPages(doc, signal)
        : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    for (const i of selected) {
      check();
      const page = await doc.getPage(i);
      const canvas = document.createElement("canvas");
      try {
        const base = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({
            scale: Math.min(
              2200 / base.width,
              3000 / Math.max(base.width, base.height),
            ),
          });
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        rendering = page.render({ canvas, viewport, background: "#ffffff" });
        await rendering.promise;
        rendering = undefined;
        check();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(Error(`Not enough memory for PDF page ${i}`)),
            "image/png",
          ),
        );
        check();
        yield blob;
      } finally {
        rendering = undefined;
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
  } catch (error) {
    if (passwordError) throw passwordError;
    if (signal?.aborted)
      throw new DOMException("PDF import cancelled.", "AbortError");
    const e = error as Error;
    if (e.name === "PasswordException")
      throw Error("Password-protected PDF: import an unlocked copy.");
    if (e.name === "InvalidPDFException")
      throw Error("Invalid or damaged PDF. Try exporting it again.");
    throw e;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
