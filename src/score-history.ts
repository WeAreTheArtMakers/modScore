export interface ScoreSnapshot {
  xml: string;
  reviewed: boolean;
  selected: number;
  head?: number;
}

export interface ScoreHistory {
  revision: string;
  past: ScoreSnapshot[];
  future: ScoreSnapshot[];
}

const MAX_STEPS = 24;
const MAX_HISTORY_CHARS = 12_000_000;
const MAX_SNAPSHOT_CHARS = 25_000_000;
export type HistoryMove = "undo" | "redo";

export function historyTarget(history: ScoreHistory | undefined, move: HistoryMove) {
  return (move === "undo" ? history?.past : history?.future)?.at(-1);
}

/** Store each prior revision once, alongside the current XML in the project. */
export function advanceHistory(
  history: ScoreHistory | undefined,
  current: ScoreSnapshot,
  move?: HistoryMove,
): ScoreHistory {
  const past = [...(history?.past ?? [])], future = [...(history?.future ?? [])];
  if (move === "undo") {
    past.pop();
    future.push(current);
  } else {
    past.push(current);
    if (move === "redo") future.pop();
    else future.length = 0;
  }

  // Keep the immediately preceding revision even for a single large score.
  let size = [...past, ...future].reduce((sum, snapshot) => sum + snapshot.xml.length, 0);
  while (past.length + future.length > MAX_STEPS ||
    (past.length + future.length > 1 && size > MAX_HISTORY_CHARS)) {
    const dropped = (past.length >= future.length ? past : future).shift()!;
    size -= dropped.xml.length;
  }
  return { past, future, revision: crypto.randomUUID() };
}

export function readScoreHistory(value: unknown): ScoreHistory | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw Error("Invalid score edit history");
  const { past, future, revision } = value as Record<string, unknown>;
  if (typeof revision !== "string" || !/^[0-9a-f-]{36}$/.test(revision) ||
      !Array.isArray(past) || !Array.isArray(future) || past.length + future.length > MAX_STEPS)
    throw Error("Invalid score edit history");
  let size = 0;
  const read = (item: unknown): ScoreSnapshot => {
    if (!item || typeof item !== "object") throw Error("Invalid score revision");
    const { xml, reviewed, selected, head } = item as Partial<ScoreSnapshot>;
    if (typeof xml !== "string" || !xml || xml.length > MAX_SNAPSHOT_CHARS ||
        typeof reviewed !== "boolean" || typeof selected !== "number" ||
        !Number.isSafeInteger(selected) || selected < -1 ||
        (head !== undefined && (!Number.isSafeInteger(head) || head < 0)))
      throw Error("Invalid score revision");
    size += xml.length;
    return { xml, reviewed, selected, head };
  };
  const result = { revision, past: past.map(read), future: future.map(read) };
  if (past.length + future.length > 1 && size > MAX_HISTORY_CHARS)
    throw Error("Score edit history is too large");
  return result;
}
