import { assetPath } from "./paths";
import { xmlDocument } from "./music";
import { mapScoreHeads } from "./score-heads";
let script: Promise<void> | undefined;
function load() {
  return (script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = assetPath(
      "lib/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js",
    );
    s.onload = () => resolve();
    s.onerror = () => {
      script = undefined;
      reject(Error("Notation renderer failed to load"));
    };
    document.head.append(s);
  }));
}
export class Sheet {
  osmd: any;
  onSeek: (measure: number) => void = () => {};
  onSelect: (source: number) => void = () => {};
  private scoreDoc?: Document;
  private heads: ReturnType<typeof mapScoreHeads> = [];
  private editing = false;
  private selection?: number;

  setEditing(editing: boolean, selection?: number) {
    this.editing = editing;
    this.selection = selection;
    if (editing && !this.heads.length) this.prepareHeads();
    this.element?.classList.toggle("editing-score", editing);
    this.updateHeadSelection();
  }

  private updateHeadSelection() {
    const first = this.heads.find((entry) => entry.source === this.selection) ?? this.heads[0];
    for (const entry of this.heads) {
      const { head, source, name } = entry;
      if (this.editing) {
        head.setAttribute("role", "button");
        head.setAttribute("aria-label", name);
        head.setAttribute("aria-pressed", String(source === this.selection));
        head.setAttribute("tabindex", entry === first ? "0" : "-1");
        head.dataset.scoreNoteSource = String(source);
      } else {
        head.removeAttribute("role");
        head.removeAttribute("aria-label");
        head.removeAttribute("aria-pressed");
        head.removeAttribute("tabindex");
        delete head.dataset.scoreNoteSource;
      }
    }
  }

  private prepareHeads() {
    this.heads = this.editing && this.scoreDoc
      ? mapScoreHeads(this.scoreDoc, this.osmd?.GraphicSheet?.MeasureList ?? [])
      : [];
    this.updateHeadSelection();
  }
  onManualBrowse: () => void = () => {};
  private browseCleanup: (() => void)[] = [];
  resumeFollow() {
    this.last = -1;
  }
  private generation = 0;
  private last = -1;
  private wasFollowing = false;
  private index = 0;
  private positions: number[] = [];
  private observer?: ResizeObserver;
  private resizeTimer?: number;
  private width = 0;
  private targets: { measure: number; x: number; y: number; height: number }[] =
    [];
  private element?: HTMLElement;
  async render(element: HTMLElement, xml: string, title?: string) {
    const generation = ++this.generation;
    await load();
    if (generation !== this.generation) return;
    if (!element.isConnected) return;
    this.element = element;
    const pane = element.closest<HTMLElement>(".score-workspace") || element;
    const manual = () => {
      pane.scrollTo({
        top: pane.scrollTop,
        left: pane.scrollLeft,
        behavior: "instant",
      });
      this.onManualBrowse();
    };
    const keys = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          event.key,
        )
      )
        manual();
    };
    pane.addEventListener("wheel", manual, { passive: true });
    pane.addEventListener("touchmove", manual, { passive: true });
    pane.addEventListener("keydown", keys);
    const scrollbar = (event: PointerEvent) => {
      const rect = pane.getBoundingClientRect();
      if (
        event.clientX >= rect.left + pane.clientWidth ||
        event.clientY >= rect.top + pane.clientHeight
      )
        manual();
    };
    pane.addEventListener("pointerdown", scrollbar);
    this.browseCleanup.push(() => {
      pane.removeEventListener("wheel", manual);
      pane.removeEventListener("touchmove", manual);
      pane.removeEventListener("keydown", keys);
      pane.removeEventListener("pointerdown", scrollbar);
    });
    this.osmd = new (window as any).opensheetmusicdisplay.OpenSheetMusicDisplay(
      element,
      {
        autoResize: false,
        backend: "svg",
        drawTitle: false,
        drawComposer: false,
        drawPartNames: false,
        drawingParameters: "default",
        autoBeam: true,
        drawMeasureNumbers: true,
        drawMeasureNumbersOnlyAtSystemStart: false,
        newSystemFromXML: true,
        stretchLastSystemLine: false,
        followCursor: false,
      },
    );
    this.scoreDoc = xmlDocument(xml);
    await this.osmd.load(this.scoreDoc);
    if (generation !== this.generation) return;
    if (!element.isConnected) return;
    if (title) this.osmd.Sheet.Title.text = title;
    this.osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem =
      element.clientWidth < 600 ? 2 : 3;
    this.width = element.clientWidth;
    this.osmd.render();
    this.prepareCursor();
    this.prepareHeads();
    element.onkeydown = (event) => {
      const source = (event.target as Element).closest?.("[data-score-note-source]");
      if (!this.editing || !source) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.onSelect(Number(source.getAttribute("data-score-note-source")));
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const i = this.heads.findIndex(({ head }) => head === source);
        this.heads[i + (event.key === "ArrowRight" ? 1 : -1)]?.head.focus();
      }
    };
    element.onclick = (event) => {
      const head = (event.target as Element).closest?.("[data-score-note-source]");
      if (this.editing && head) {
        this.onSelect(Number(head.getAttribute("data-score-note-source")));
        return;
      }
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left + element.scrollLeft,
        y = event.clientY - rect.top + element.scrollTop;
      const rows = this.targets.filter(
        (p) => y >= p.y - 25 && y <= p.y + p.height + 25,
      );
      if (!rows.length) return;
      const row = rows.reduce((a, b) =>
        Math.abs(a.y - y) < Math.abs(b.y - y) ? a : b,
      );
      const same = rows
        .filter((p) => Math.abs(p.y - row.y) < 15)
        .sort((a, b) => a.x - b.x);
      const target = [...same].reverse().find((p) => p.x <= x + 10) || same[0];
      if (target) this.onSeek(target.measure);
    };
    this.observer = new ResizeObserver(() => {
      if (Math.abs(element.clientWidth - this.width) < 2) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (!element.isConnected || !this.osmd) return;
        this.osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem =
          element.clientWidth < 600 ? 2 : 3;
        this.width = element.clientWidth;
        this.osmd.render();
        this.prepareCursor();
        this.prepareHeads();
      }, 150);
    });
    this.observer.observe(element);
  }
  private prepareCursor() {
    const c = this.osmd.cursor;
    c.reset();
    this.positions = [];
    this.targets = [];
    const seen = new Set<number>();
    let guard = 0;
    while (!c.Iterator.EndReached && guard++ < 100000) {
      const beat = c.Iterator.CurrentSourceTimestamp.RealValue * 4;
      this.positions.push(beat);
      const measure = c.Iterator.CurrentMeasureIndex;
      if (!seen.has(measure)) {
        seen.add(measure);
        c.show();
        const rect = c.cursorElement.getBoundingClientRect(),
          root = this.element!.getBoundingClientRect();
        this.targets.push({
          measure,
          x: rect.left - root.left + this.element!.scrollLeft,
          y: rect.top - root.top + this.element!.scrollTop,
          height: rect.height,
        });
      }
      c.next();
    }
    c.reset();
    c.show();
    this.index = 0;
    this.last = -1;
  }
  update(beat: number, follow: boolean) {
    const c = this.osmd?.cursor;
    if (!c || !this.positions.length) return;
    const beganFollowing = follow && !this.wasFollowing;
    this.wasFollowing = follow;
    let lo = 0,
      hi = this.positions.length;
    while (lo < hi) {
      const middle = (lo + hi) >> 1;
      if (this.positions[middle] <= beat + 0.0001) lo = middle + 1;
      else hi = middle;
    }
    const target = Math.max(0, lo - 1);
    if (target < this.index) {
      c.reset();
      this.index = 0;
      this.last = -1;
    }
    if (target === this.index && this.last >= 0 && !beganFollowing) return;
    while (this.index < target && !c.Iterator.EndReached) {
      c.next();
      this.index++;
    }
    c.show();
    const measure = c.Iterator.CurrentMeasureIndex;
    if (
      follow &&
      (measure !== this.last || beganFollowing) &&
      c.cursorElement &&
      this.element
    ) {
      const pane =
        this.element.closest<HTMLElement>(".score-workspace") || this.element;
      const cursor = c.cursorElement.getBoundingClientRect(),
        box = pane.getBoundingClientRect();
      const top =
        cursor.top < box.top + 20 || cursor.bottom > box.bottom - 20
          ? Math.max(0, pane.scrollTop + cursor.top - box.top - 24)
          : pane.scrollTop;
      const left =
        cursor.left < box.left || cursor.right > box.right
          ? Math.max(0, pane.scrollLeft + cursor.left - box.left - 24)
          : pane.scrollLeft;
      if (top !== pane.scrollTop || left !== pane.scrollLeft)
        pane.scrollTo({
          top,
          left,
          behavior: "instant",
        });
    }
    this.last = measure;
  }
  clear() {
    this.generation++;
    this.wasFollowing = false;
    this.browseCleanup.splice(0).forEach((clean) => clean());
    if (this.element) {
      this.element.onclick = null;
      this.element.onkeydown = null;
    }
    this.scoreDoc = undefined;
    this.heads = [];
    this.editing = false;
    this.selection = undefined;
    this.observer?.disconnect();
    clearTimeout(this.resizeTimer);
    this.osmd?.clear();
    this.osmd = undefined;
    this.element = undefined;
    this.positions = [];
    this.targets = [];
  }
}
