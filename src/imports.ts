export type ImportKind = "pdf" | "image" | "xml" | "midi" | "project";
export async function classifyImport(file: File): Promise<ImportKind> {
  if (!file.size) throw Error(`${file.name}: file is empty.`);
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
  const text = new TextDecoder()
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (text.includes("%PDF-")) return "pdf";
  if (
    (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78) ||
    ascii(0,4)==="GIF8" ||
    (ascii(0,4)==="RIFF" && ascii(8,12)==="WEBP") ||
    (bytes[0] === 0x49 && bytes[1] === 0x49) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d) ||
    (bytes[0] === 0x42 && bytes[1] === 0x4d) ||
    (ascii(4,8)==="ftyp" && ["heic","heix","hevc","hevx","mif1","msf1","avif","avis"].includes(ascii(8,12)))
  )
    return "image";
  if (text.startsWith("MThd")) return "midi";
  if (/\.mxl$/i.test(file.name) || (bytes[0] === 80 && bytes[1] === 75))
    throw Error(
      `${file.name}: compressed MusicXML/ZIP is not supported. Export uncompressed .musicxml.`,
    );
  if (text.startsWith("<?xml") || text.startsWith("<score-partwise"))
    return "xml";
  if (text.startsWith("{")) return "project";
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf")
    throw Error(
      `${file.name}: PDF header is missing; the file may be damaged.`,
    );
  if (/\.midi?$/i.test(file.name))
    throw Error(`${file.name}: MIDI header is missing.`);
  throw Error(
    `${file.name}: unsupported or unreadable file. Choose an image, PDF, uncompressed MusicXML, MIDI or modScore project.`,
  );
}
export async function planImport(files: File[]) {
  const entries = await Promise.all(
    files.map(async (file) => ({ file, kind: await classifyImport(file) })),
  );
  const raster = entries.every((e) => e.kind === "image" || e.kind === "pdf");
  if (!raster && entries.length !== 1)
    throw Error(
      "Import images/PDFs together, or one MusicXML, MIDI or project file at a time.",
    );
  return { entries, raster };
}
