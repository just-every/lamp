/** Shared public snapshot path policy, also used before Vite handles a request. */
export const sourceFeedPaths = { statuspage: ["/history.atom"] };
const reserved = new Set(["app", "api", "auth", "signin", "setup", "health", "docs", "lamp", "history", "assets", "app-assets", "brand", "subscribe", "unsubscribe", "manage", "confirm-subscription", "maintenance", "node_modules", "src", "cdn-cgi"]);
export function isImportAliasPath(path) {
  if (Object.values(sourceFeedPaths).some((paths) => paths.includes(path))) return true;
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/u.test(path)) return false;
  const first = path.split("/")[1].toLowerCase();
  if (first.startsWith("_") || first.startsWith("@") || reserved.has(first)) return false;
  if (first === "incidents") return /^\/incidents\/[A-Za-z0-9_-]+$/u.test(path) && !/^\/incidents\/INC-/iu.test(path);
  return true;
}
export const isLampPermalink = (path) => /^\/(?:incidents\/INC|maintenance\/SCH)-[1-9][0-9]*$/u.test(path);
