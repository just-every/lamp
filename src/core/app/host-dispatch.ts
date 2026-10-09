export type LampSurface = "page" | "app";

export interface HostDispatchBindings {
  LAMP_PAGE_HOST: string;
  LAMP_APP_HOST: string;
}

const pageExactPaths = new Set([
  "/",
  "/history",
  "/feed.atom",
  "/widget.js",
  "/api/public/status",
  "/subscribe",
  "/unsubscribe",
]);
const pagePathPrefixes = ["/incidents/", "/assets/", "/manage/", "/unsubscribe/", "/confirm-subscription/", "/api/intake/"];
const appExactPaths = new Set(["/setup/status", "/setup", "/health", "/signin", "/app", "/api/app"]);
const appPathPrefixes = ["/signin/", "/app/", "/app-assets/", "/api/app/", "/_serverFn/"];
// Vite and TanStack Start request these modules only from `vite dev`. They are
// never enabled by the emitted Worker, which continues to expose only the
// declared app paths above.
const developmentAppPathPrefixes = ["/@id/", "/@tanstack-start/", "/@vite/", "/@fs/", "/@react-refresh", "/node_modules/", "/src/"];
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
 * Keeps the public status surface and the operator surface separate when a
 * deployment assigns them different hostnames. A single localhost hostname is
 * intentionally allowed for development.
 */
export function createHostDispatch(bindings: HostDispatchBindings) {
  const pageHost = configuredHostname(bindings.LAMP_PAGE_HOST, "LAMP_PAGE_HOST");
  const appHost = configuredHostname(bindings.LAMP_APP_HOST, "LAMP_APP_HOST");

  return {
    surfaceFor(request: Request, { allowDevelopmentAssets = false }: { allowDevelopmentAssets?: boolean } = {}): LampSurface | null {
      const requestHost = new URL(request.url).hostname.toLowerCase();
      const pathname = new URL(request.url).pathname;

      if (matches(pathname, pageExactPaths, pagePathPrefixes)) {
        return requestHost === pageHost ? "page" : null;
      }
      if (matches(pathname, appExactPaths, appPathPrefixes) || (allowDevelopmentAssets && isDevelopmentAppPath(pathname))) {
        return requestHost === appHost ? "app" : null;
      }
      return null;
    },
  };
}
