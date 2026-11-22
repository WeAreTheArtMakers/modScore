export function youtubeId(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Enter a complete YouTube URL.");
  }
  if (url.protocol !== "https:") throw Error("Use an HTTPS YouTube link.");
  const host = url.hostname.toLowerCase();
  let id = "";
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
    ].includes(host)
  )
    id =
      url.searchParams.get("v") ||
      /^\/(?:shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1] ||
      "";
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id))
    throw Error("This is not a supported YouTube video link.");
  return id;
}
