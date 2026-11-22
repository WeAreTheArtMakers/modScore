/** Local page/password dialog. No document bytes or passwords leave the browser. */
export async function choosePdfPages(
  doc: any,
  signal?: AbortSignal,
): Promise<number[]> {
  const dialog = document.createElement("dialog");
  dialog.className = "pdf-picker";
  const tr = document.documentElement.lang === "tr";
  const heading = document.createElement("h2");
  heading.textContent = tr ? "PDF sayfalarını seç" : "Choose PDF pages";
  const range = document.createElement("input");
  range.type = "text";
  range.value = `1-${doc.numPages}`;
  range.setAttribute("aria-label", "Page range");
  const hint = document.createElement("p");
  hint.textContent = `${doc.numPages} ${tr ? "sayfa. Örnek: 1, 3-5. Yalnızca seçilen sayfalar çizilir." : "pages. Example: 1, 3-5. Only selected pages are rasterized."}`;
  const previews = document.createElement("div");
  previews.className = "pdf-thumbnails";
  const status = document.createElement("p");
  status.role = "status";
  const importButton = document.createElement("button");
  importButton.textContent = tr
    ? "Seçilen sayfaları aktar"
    : "Import selected pages";
  const cancel = document.createElement("button");
  cancel.textContent = tr ? "İptal" : "Cancel";
  dialog.append(heading, hint, range, previews, status, importButton, cancel);
  document.body.append(dialog);
  dialog.showModal();
  let closed = false,
    rendering: any;
  let resolve!: (pages: number[]) => void, reject!: (error: Error) => void;
  const result = new Promise<number[]>((r, j) => {
    resolve = r;
    reject = j;
  });
  const close = () => {
    closed = true;
    rendering?.cancel();
    dialog.close();
    dialog.remove();
    signal?.removeEventListener("abort", abort);
  };
  const abort = () => {
    close();
    reject(new DOMException("PDF selection cancelled.", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  cancel.onclick = abort;
  dialog.oncancel = (e) => {
    e.preventDefault();
    abort();
  };
  importButton.onclick = () => {
    try {
      const pages = parsePageRange(range.value, doc.numPages);
      close();
      resolve(pages);
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };
  // Bounded preview work: first six pages only; all pages remain available via range.
  void (async () => {
    for (let n = 1; n <= Math.min(6, doc.numPages) && !closed; n++) {
      const page = await doc.getPage(n);
      if (closed) {
        page.cleanup();
        break;
      }
      const canvas = document.createElement("canvas");
      try {
        const base = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({ scale: 140 / base.width });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        rendering = page.render({ canvas, viewport, background: "#fff" });
        await rendering.promise;
        if (closed) break;
        const img = document.createElement("img");
        img.src = canvas.toDataURL("image/png");
        img.alt = `Page ${n}`;
        const label = document.createElement("span");
        label.textContent = String(n);
        const figure = document.createElement("figure");
        figure.append(img, label);
        previews.append(figure);
      } finally {
        rendering = undefined;
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
  })().catch((e) => {
    if (!closed) status.textContent = "Preview unavailable: " + e.message;
  });
  if (signal?.aborted) abort();
  return result;
}
export function parsePageRange(text: string, total: number) {
  const pages = new Set<number>();
  for (const entry of text.split(",")) {
    const m = entry.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("Use page numbers/ranges, e.g. 1, 3-5");
    const a = Number(m[1]),
      b = Number(m[2] || m[1]);
    if (a < 1 || b < a || b > total)
      throw Error(`Choose pages from 1 to ${total}`);
    for (let n = a; n <= b; n++) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}
export function askPdfPassword(
  reason: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tr = document.documentElement.lang === "tr",
      dialog = document.createElement("dialog");
    const form = document.createElement("form"),
      title = document.createElement("h2");
    title.textContent =
      reason === 2
        ? tr
          ? "Parola yanlış; tekrar deneyin"
          : "Incorrect password; try again"
        : tr
          ? "PDF parolası"
          : "PDF password";
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.required = true;
    input.setAttribute("aria-label", "PDF password");
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = tr ? "Aç" : "Unlock";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = tr ? "İptal" : "Cancel";
    form.append(title, input, ok, cancel);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    const cleanup = () => {
      input.value = "";
      dialog.close();
      dialog.remove();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Password entry cancelled.", "AbortError"));
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const password = input.value;
      cleanup();
      resolve(password);
    };
    cancel.onclick = abort;
    dialog.oncancel = (e) => {
      e.preventDefault();
      abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
