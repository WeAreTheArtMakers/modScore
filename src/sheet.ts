import { assetPath } from "./paths";
import { xmlDocument } from "./music";
let script: Promise<void> | undefined;
function load() {
  return (script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      assetPath("lib/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js");
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
  private generation = 0;
  private last = -1;
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
    await this.osmd.load(xmlDocument(xml));
    if (generation !== this.generation) return;
    if (!element.isConnected) return;
    if (title) this.osmd.Sheet.Title.text = title;
    this.osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem =
      element.clientWidth < 600 ? 2 : 3;
    this.width = element.clientWidth;
    this.osmd.render();
    this.prepareCursor();
    element.onclick = (event) => {
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
    if (target === this.index && this.last >= 0) return;
    while (this.index < target && !c.Iterator.EndReached) {
      c.next();
      this.index++;
    }
    c.show();
    const measure = c.Iterator.CurrentMeasureIndex;
    if (follow && measure !== this.last)
      c.cursorElement?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    this.last = measure;
  }
  clear() {
    this.generation++;
    if (this.element) this.element.onclick = null;
    this.observer?.disconnect();
    clearTimeout(this.resizeTimer);
    this.osmd?.clear();
    this.osmd = undefined;
    this.element = undefined;
    this.positions = [];
    this.targets = [];
  }
}
