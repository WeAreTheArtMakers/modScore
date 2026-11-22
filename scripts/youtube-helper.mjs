// Optional, user-run loopback helper. The hosted PWA itself needs no server.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
const port = 8790;
const allowed = new Set([
  "https://wearetheartmakers.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);
const clients = new Set();
let active = false;
function videoId(value) {
  const u = new URL(value);
  if (u.protocol !== "https:") throw Error("Use HTTPS");
  const id =
    u.hostname === "youtu.be"
      ? u.pathname.slice(1).split("/")[0]
      : [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
          ].includes(u.hostname)
        ? u.searchParams.get("v") ||
          /^\/(?:shorts|embed)\/([^/]+)/.exec(u.pathname)?.[1] ||
          ""
        : "";
  if (!/^[\w-]{11}$/.test(id)) throw Error("Invalid YouTube link");
  return id;
}
function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "",
      error = "";
    clients.add(child);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 2e6) child.kill();
    });
    child.stderr.on("data", (d) => {
      error = (error + d).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clients.delete(child);
      code === 0
        ? resolve(stdout)
        : reject(
            Error(
              "The downloader could not access this public video. Update yt-dlp or use a local audio file.",
            ),
          );
    });
  });
}
async function downloader(args, signal) {
  try {
    return await run("yt-dlp", args, signal);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    return await run(
      "uvx",
      ["--from", "yt-dlp==2026.10.26", "yt-dlp", ...args],
      signal,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  throw Error(
    "Install yt-dlp, or install uv so the helper can run its pinned downloader. See docs/AUDIO_YOUTUBE.md.",
  );
}
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin)) {
    res.writeHead(403).end("Origin not allowed");
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.writeHead(204).end();
    return;
  }
  if (req.url === "/health" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ app: "modscore-youtube", version: "1", local: true }),
    );
    return;
  }
  if (req.url !== "/youtube" || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  if (!String(req.headers["content-type"]).startsWith("application/json")) {
    res.writeHead(415).end();
    return;
  }
  if (active) {
    res
      .writeHead(409, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Another video is being prepared." }));
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  let directory,
    acquired = false;
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) throw Error("Request too large");
    }
    const id = videoId(JSON.parse(body).url);
    if (active) {
      res
        .writeHead(409, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Another video is being prepared." }));
      return;
    }
    active = true;
    acquired = true;
    directory = await realpath(
      await mkdtemp(join(tmpdir(), "modscore-youtube-")),
    );
    const report = await downloader(
      [
        "--no-playlist",
        "--no-cache-dir",
        "--max-filesize",
        "40M",
        "--match-filter",
        "duration <= 600",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-o",
        join(directory, "source.%(ext)s"),
        "--print",
        'after_move:{"title":%(title)j,"duration":%(duration)j,"filepath":%(filepath)j}',
        `https://www.youtube.com/watch?v=${id}`,
      ],
      controller.signal,
    );
    const item = JSON.parse(report.trim().split("\n").at(-1));
    const path = await realpath(item.filepath);
    if (!path.startsWith(directory + "/"))
      throw Error("Unexpected downloader path");
    const data = await readFile(path);
    if (data.length > 40 * 1024 * 1024) throw Error("Audio exceeds 40 MB.");
    const type =
      {
        ".m4a": "audio/mp4",
        ".webm": "audio/webm",
        ".mp3": "audio/mpeg",
        ".opus": "audio/ogg",
      }[extname(path)] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Access-Control-Expose-Headers", "X-Modscore-Title");
    res.setHeader("X-Modscore-Title", encodeURIComponent(item.title));
    res.end(data);
  } catch (e) {
    if (!res.destroyed) {
      res
        .writeHead(controller.signal.aborted ? 408 : 400, {
          "Content-Type": "application/json",
        })
        .end(
          JSON.stringify({
            error: controller.signal.aborted
              ? "Download cancelled or timed out."
              : e.message,
          }),
        );
    }
  } finally {
    clearTimeout(timer);
    if (acquired) active = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `modScore YouTube helper: http://127.0.0.1:${port}\nKeep this terminal open, then use Audio & YouTube in modScore. Audio stays on this computer. Ctrl+C stops the helper.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of clients) child.kill();
    server.close(() => process.exit(0));
  });
