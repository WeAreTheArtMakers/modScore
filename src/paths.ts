/** Resolve self-hosted assets within this deployment, including GitHub Pages. */
export function assetPath(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
