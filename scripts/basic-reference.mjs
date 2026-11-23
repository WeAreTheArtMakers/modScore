// Write the reviewed source events directly: do not re-partition tied chords
// through the audio notation writer, which changes voices and rhythmic spelling.
const escape = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[
        c
      ])
  );
export function basicReferenceXml(
  score,
  limit = score.measures.length,
  repeat = true
) {
  const clef = (c) =>
    `<clef number="${c.staff}"><sign>${c.sign}</sign><line>${c.line}</line>${
      c.octaveChange
        ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>`
        : ""
    }</clef>`;
  const shape = new Map([
    [16, ["whole", false]],
    [12, ["half", true]],
    [8, ["half", false]],
    [6, ["quarter", true]],
    [4, ["quarter", false]],
    [3, ["eighth", true]],
    [2, ["eighth", false]],
    [1.5, ["16th", true]],
    [1, ["16th", false]],
    [0.5, ["32nd", false]],
  ]);
  const pitches = (item, beat, staff) =>
    item.pitches
      .filter((p) => p !== "R")
      .map((name) => {
        const m = /^([A-G])(bb|b|##|#)?(\d)$/.exec(name);
        if (!m) throw Error("Invalid pitch " + name);
        const octave =
          Number(m[3]) +
          (staff === 1 &&
          ((beat >= 28 && beat < 46) || (beat >= 84 && beat < 104))
            ? 1
            : 0);
        const alter = m[2]?.includes("b") ? -m[2].length : m[2]?.length || 0;
        return { name, step: m[1], alter, octave };
      });
  let xml = `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(
    score.title
  )}</work-title></work><identification><creator type="composer">${escape(
    score.composer
  )}</creator><rights>${escape(
    score.rights
  )}</rights><encoding><software>modScore reference edition 3</software></encoding></identification><part-list><score-part id="Piano"><part-name>Piano</part-name><score-instrument id="Piano-I"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="Piano-I"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="Piano">`;
  let from = 0;
  for (let b = 0; b < limit; b++) {
    const bar = score.measures[b],
      length = score.barDurations[b],
      to = from + length;
    xml += `<measure number="${b + 1}"${length < 4 ? ' implicit="yes"' : ""}>${
      b && b % 3 === 0 ? '<print new-system="yes"/>' : ""
    }`;
    if (!b)
      xml += `<attributes><divisions>16</divisions><key><fifths>${
        score.key.fifths
      }</fifths><mode>${
        score.key.mode
      }</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${score.clefs
        .filter((c) => c.beat === 0)
        .map(clef)
        .join(
          ""
        )}</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${
        score.bpm
      }</per-minute></metronome></direction-type><sound tempo="${
        score.bpm
      }"/></direction>${
        repeat
          ? '<barline location="left"><repeat direction="forward"/></barline>'
          : ""
      }`;
    else {
      // Restate a mid-bar change at the following bar for OSMD's persistent
      // clef state. Do not repeat clef instructions in every unchanged bar.
      const previousStart = from - score.barDurations[b - 1];
      const changed = score.clefs.filter(c => c.beat > previousStart && c.beat <= from);
      const active = [1, 2].map(staff => changed.filter(c => c.staff === staff).at(-1)).filter(Boolean);
      if (active.length) xml += `<attributes>${active.map(clef).join("")}</attributes>`;
    }
    for (const [hand, staff] of [
      ["upper", 1],
      ["lower", 2],
    ]) {
      if (staff === 2)
        xml += `<backup><duration>${length * 16}</duration></backup>`;
      let at = from;
      const items = bar[hand];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const forms = shape.get(item.units);
        if (!forms) throw Error("Unsupported source rhythm " + item.units);
        const changes = score.clefs.filter(
          (c) =>
            c.staff === staff && c.beat > from && c.beat < to && c.beat === at
        );
        if (changes.length)
          xml += `<attributes>${changes.map(clef).join("")}</attributes>`;
        const ns = pitches(item, at, staff),
          prev = i ? items[i - 1] : score.measures[b - 1]?.[hand]?.at(-1),
          next = items[i + 1] || score.measures[b + 1]?.[hand]?.[0];
        for (const [j, n] of (ns.length ? ns : [null]).entries()) {
          const stop =
            !!n &&
            item.tie?.includes("stop") &&
            prev?.pitches.includes(n.name) &&
            prev.tie?.includes("start");
          const start =
            !!n &&
            item.tie?.includes("start") &&
            next?.pitches.includes(n.name) &&
            next.tie?.includes("stop");
          xml += `<note${n ? ` dynamics="${staff === 1 ? 76 : 60}"` : ""}>${
            j ? "<chord/>" : ""
          }${
            n
              ? `<pitch><step>${n.step}</step>${
                  n.alter ? `<alter>${n.alter}</alter>` : ""
                }<octave>${n.octave}</octave></pitch>`
              : "<rest/>"
          }<duration>${item.units * 4}</duration>${
            stop ? '<tie type="stop"/>' : ""
          }${start ? '<tie type="start"/>' : ""}<voice>${staff}</voice><type>${
            forms[0]
          }</type>${forms[1] ? "<dot/>" : ""}<staff>${staff}</staff>${
            stop || start
              ? `<notations>${stop ? '<tied type="stop"/>' : ""}${
                  start ? '<tied type="start"/>' : ""
                }</notations>`
              : ""
          }</note>`;
        }
        at += item.units / 4;
      }
      if (Math.abs(at - to) > 1e-7)
        throw Error(`Bar ${b + 1}/${hand} does not balance`);
    }
    if (b === limit - 1)
      xml += `<barline location="right"><bar-style>light-heavy</bar-style>${
        repeat ? '<repeat direction="backward" times="2"/>' : ""
      }</barline>`;
    xml += "</measure>";
    from = to;
  }
  return xml + "</part></score-partwise>";
}
