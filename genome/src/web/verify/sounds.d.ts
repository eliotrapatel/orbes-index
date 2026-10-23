/**
 * The designed sounds of a LIVE RELEASE (lot Q1 §3.10, `sounds/*.mp3`): esbuild's file loader (scripts/build-web.ts)
 * publishes each under /assets/ with a content hash and gives the bundle its URL; vitest (Vite) gives its source path.
 */
declare module '*.mp3' {
  const url: string;
  export default url;
}
