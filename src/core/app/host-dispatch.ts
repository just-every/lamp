import { isImportAliasPath } from "../features/statuspage-import/public-addresses";
export type LampSurface = "page" | "app";

export interface HostDispatchBindings {
  LAMP_PAGE_HOST: string;
  LAMP_APP_HOST: string;
}

const pageExactPaths = new Set([
  "/history",
  "/feed.atom",
  "/feed.rss", "/history.atom", "/history.rss", "/badge.svg", "/badge.json", "/embed/script.js", "/api/public/v1",
  "/widget.js",
  "/api/public/status",
  "/subscribe",
  "/unsubscribe",
]);
const pagePathPrefixes = ["/history/", "/incidents/", "/maintenance/", "/components/", "/api/v2/", "/api/public/v1/", "/assets/", "/manage/", "/unsubscribe/", "/confirm-subscription/", "/api/intake/"];
// `/lamp` is the landing page's former address; server.ts redirects it to `/` for one release.
// `/docs` and `/docs/` are the product's own docs, public and on the app host only: the page host's paths are the status
// snapshot's. `/setup/state` and `/brand/` serve the Lobby, the app host's home page.
const appExactPaths = new Set(["/setup/status", "/setup/state", "/setup", "/health", "/signin", "/lamp", "/docs", "/app", "/api/app", "/rer-theme.css"]);
const appPathPrefixes = ["/auth/", "/docs/", "/.well-known/rer-", "/app/", "/app-assets/", "/brand/", "/api/app/", "/api/rer/import/", "/api/operator/import/", "/_serverFn/"];
// Vite and TanStack Start request these modules only from `vite dev`. They are
// never enabled by the emitted Worker, which continues to expose only the
// declared app paths above. `/package.json` is the module the landing page reads
// its repository link from; the build inlines it.
const developmentAppPathPrefixes = ["/@id/", "/@tanstack-start/", "/@vite/", "/@fs/", "/@react-refresh", "/node_modules/", "/src/", "/package.json"];
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function configuredHostname(value: unknown, variableName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${variableName} is required.`);
  }
  const hostname = value.trim().toLowerCase();
  if (!hostnamePattern.test(hostname)) {
    throw new Error(`${variableName} must be a hostname without a protocol or port.`);
  }
  return hostname;
}

function matches(pathname: string, exactPaths: Set<string>, prefixes: string[]) {
  return exactPaths.has(pathname) || prefixes.some((prefix) => pathname.startsWith(prefix));
}

export function isDevelopmentAppPath(pathname: string) {
  return developmentAppPathPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Keeps the public status surface and the operator surface on their own
 * hostnames. Each host has its own home page at `/`: the page host's is the
 * public status page, the app host's is the Lobby. One hostname for
 * both would leave `/` ambiguous, so equal hosts fail at startup.
 */
export function createHostDispatch(bindings: HostDispatchBindings) {
  const pageHost = configuredHostname(bindings.LAMP_PAGE_HOST, "LAMP_PAGE_HOST");
  const appHost = configuredHostname(bindings.LAMP_APP_HOST, "LAMP_APP_HOST");
  if (pageHost === appHost) {
    throw new Error("LAMP_PAGE_HOST and LAMP_APP_HOST must be different hostnames: each serves its own home page at /.");
  }

  return {
    surfaceFor(request: Request, { allowDevelopmentAssets = false }: { allowDevelopmentAssets?: boolean } = {}): LampSurface | null {
      const requestHost = new URL(request.url).hostname.toLowerCase();
      const pathname = new URL(request.url).pathname;

      if (pathname === "/") {
        if (requestHost === pageHost) return "page";
        if (requestHost === appHost) return "app";
        return null;
      }
      if (matches(pathname, pageExactPaths, pagePathPrefixes)) {
        return requestHost === pageHost ? "page" : null;
      }
      if (matches(pathname, appExactPaths, appPathPrefixes) || (allowDevelopmentAssets && isDevelopmentAppPath(pathname))) {
        return requestHost === appHost ? "app" : null;
      }
      return requestHost === pageHost && (request.method === "GET" || request.method === "HEAD") && isImportAliasPath(pathname) ? "page" : null;
    },
  };
}
